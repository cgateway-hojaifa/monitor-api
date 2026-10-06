import { In, IsNull, And, MoreThanOrEqual, LessThan, type FindOperator } from "typeorm";
import { AppDataSource } from "@/config/data-source";
import { Project } from "@/entities/Project";
import { FileRecord } from "@/entities/FileRecord";
import { CheckHistory } from "@/entities/CheckHistory";
import { Email } from "@/entities/Email";
import { PageScan } from "@/entities/PageScan";
import { PageFinding } from "@/entities/PageFinding";
import { normalizeContent } from "@/modules/pci/services/extractor";
import { runFileCheck } from "@/modules/pci/services/checkRunner";
import { runPageScan, ScanBusyError } from "@/modules/pci/services/runPageScan";
import {
  normalizePageUrl,
  normalizeExpectedHeaders,
  normalizeFileUrl,
} from "@/modules/pci/services/pageConfig";
import { Category } from "@/entities/Category";
import { assertCategoryExists } from "@/modules/category/category.service";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";

const projectRepo = () => AppDataSource.getRepository(Project);
const fileRepo = () => AppDataSource.getRepository(FileRecord);
const historyRepo = () => AppDataSource.getRepository(CheckHistory);
const emailRepo = () => AppDataSource.getRepository(Email);
const scanRepo = () => AppDataSource.getRepository(PageScan);
const findingRepo = () => AppDataSource.getRepository(PageFinding);

interface ProjectBody {
  name?: string;
  description?: string;
  /** Category id; null/"" = uncategorized; absent = leave as is (update). */
  category_id?: unknown;
  page_url?: unknown;
  expected_headers?: unknown;
}

/** Validated payment-page settings, or a 400 with the user-facing reason. */
function pageSettings(body: ProjectBody) {
  const url = normalizePageUrl(body.page_url);
  if (!url.ok) throw new ApiError(httpStatus.BAD_REQUEST, url.message);
  const headers = normalizeExpectedHeaders(body.expected_headers);
  if (!headers.ok) throw new ApiError(httpStatus.BAD_REQUEST, headers.message);
  return { page_url: url.value, expected_headers: headers.value };
}

/** `category_id` from a request: undefined = not supplied, null = uncategorized, else must exist. */
async function categoryIdOf(raw: unknown): Promise<number | null | undefined> {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const id = Number(raw);
  await assertCategoryExists(id);
  return id;
}

/** `{ id, name, color }` per category id — attached to projects for the list and detail pills. */
async function categoryMap(ids: Array<number | null>) {
  const wanted = [...new Set(ids.filter((id): id is number => id != null))];
  const rows = wanted.length
    ? await AppDataSource.getRepository(Category).find({
        where: { id: In(wanted) },
        select: ["id", "name", "color"],
      })
    : [];
  return new Map(rows.map((c) => [c.id, c]));
}

// ── Projects ────────────────────────────────────────────────────────────────

/** Projects, optionally filtered by category (`"none"` = uncategorized), with file counts. */
export async function listProjects(categoryFilter?: unknown) {
  const where =
    categoryFilter === "none"
      ? { category_id: IsNull() }
      : Number(categoryFilter) > 0
        ? { category_id: Number(categoryFilter) }
        : {};
  const [projects, counts] = await Promise.all([
    projectRepo().find({ where, order: { created_at: "DESC" } }),
    // One grouped count instead of a query per project.
    fileRepo()
      .createQueryBuilder("f")
      .select("f.project_id", "project_id")
      .addSelect("COUNT(*)", "count")
      .groupBy("f.project_id")
      .getRawMany<{ project_id: number; count: string }>(),
  ]);
  const byProject = new Map(counts.map((c) => [Number(c.project_id), Number(c.count)]));
  const categories = await categoryMap(projects.map((p) => p.category_id));
  return projects.map((p) => ({
    ...p,
    file_count: byProject.get(p.id) ?? 0,
    category: (p.category_id && categories.get(p.category_id)) || null,
  }));
}

export async function createProject(body: ProjectBody) {
  if (!body.name) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");
  const project = projectRepo().create({
    name: body.name,
    description: body.description || null,
    category_id: (await categoryIdOf(body.category_id)) ?? null,
    ...pageSettings(body),
  });
  return projectRepo().save(project);
}

export async function getProject(id: number) {
  const project = await projectRepo().findOne({ where: { id } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");
  const [files, categories] = await Promise.all([
    fileRepo().find({ where: { project_id: project.id }, order: { created_at: "DESC" } }),
    categoryMap([project.category_id]),
  ]);
  const category = (project.category_id && categories.get(project.category_id)) || null;
  return { ...project, category, files };
}

export async function updateProject(id: number, body: ProjectBody) {
  const project = await projectRepo().findOne({ where: { id } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");
  if (!body.name) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");
  const settings = pageSettings(body);
  // A different page, or different expected headers, means the last result no longer applies.
  if (
    settings.page_url !== project.page_url ||
    settings.expected_headers !== project.expected_headers
  )
    project.scan_status = "unscanned";
  const categoryId = await categoryIdOf(body.category_id);
  if (categoryId !== undefined) project.category_id = categoryId;
  project.name = body.name;
  project.description = body.description || null;
  project.page_url = settings.page_url;
  project.expected_headers = settings.expected_headers;
  return projectRepo().save(project);
}

export async function deleteProject(id: number) {
  const project = await projectRepo().findOne({ where: { id } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");
  // No FK cascade (plain FK columns): remove the project's files' check history, the files, its
  // page scans + findings, then the project — in one transaction so a failure can't leave orphans.
  await AppDataSource.transaction(async (m) => {
    const files = await m.find(FileRecord, { where: { project_id: project.id }, select: ["id"] });
    if (files.length > 0) await m.delete(CheckHistory, { file_id: In(files.map((f) => f.id)) });
    await m.delete(FileRecord, { project_id: project.id });
    await m.delete(PageFinding, { project_id: project.id });
    await m.delete(PageScan, { project_id: project.id });
    await m.remove(project);
  });
}

// ── Payment page scans (PCI DSS 11.6.1) ─────────────────────────────────────

/** POST /projects/:id/scan — manual page check (same engine as the scheduled batch). */
export async function scanProject(id: number) {
  const project = await projectRepo().findOne({ where: { id } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");
  if (!project.page_url)
    throw new ApiError(httpStatus.BAD_REQUEST, "No payment page URL configured for this project.");

  const result = await runPageScan(project).catch((err) => {
    if (err instanceof ScanBusyError) throw new ApiError(httpStatus.CONFLICT, err.message);
    throw err;
  });
  if (result.result === "error")
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, result.error || "Scan failed.");

  const findings = result.scan_id
    ? await findingRepo().find({ where: { scan_id: result.scan_id }, order: { id: "ASC" } })
    : [];
  return { ...result, page_url: project.page_url, findings };
}

/**
 * Scans newest first with their findings attached. Findings are loaded only for the returned page
 * of scans (not the whole table); the snapshot JSON is left out to keep the list light.
 */
async function scansWithFindings(
  where: { project_id?: number; scan_time?: FindOperator<Date> },
  limit: number,
  skip = 0,
) {
  const scans = await scanRepo().find({
    where,
    order: { scan_time: "DESC", id: "DESC" },
    take: limit,
    skip,
  });
  const findings = scans.length
    ? await findingRepo().find({
        where: { scan_id: In(scans.map((s) => s.id)) },
        order: { id: "ASC" },
      })
    : [];
  const byScan = new Map<number, PageFinding[]>();
  for (const f of findings) byScan.set(f.scan_id, [...(byScan.get(f.scan_id) ?? []), f]);
  return scans.map(({ snapshot_json: _omit, ...s }) => ({
    ...s,
    findings: byScan.get(s.id) ?? [],
  }));
}

/** GET /projects/:id/scans — one project's check history. */
export async function listProjectScans(
  id: number,
  query: { page?: unknown; perPage?: unknown; limit?: unknown } = {},
) {
  const project = await projectRepo().findOne({ where: { id } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");
  const page = Math.max(Number(query.page) || 1, 1);
  const perPage = Math.min(Math.max(Number(query.perPage ?? query.limit) || 10, 1), 100);
  const where = { project_id: project.id };
  const [data, total] = await Promise.all([
    scansWithFindings(where, perPage, (page - 1) * perPage),
    scanRepo().count({ where }),
  ]);
  return {
    data,
    total,
    page,
    perPage,
    meta: {
      project_id: project.id,
      project_name: project.name,
      page_url: project.page_url,
      last_scan: project.last_scan,
      scan_status: project.scan_status,
    },
  };
}

/**
 * GET /page-scans — paged check history across projects (optionally one), for the Check History
 * page. `counts` are totals for the whole filter, not just the page.
 */
export async function listPageScans(query: {
  project_id?: unknown;
  page?: unknown;
  perPage?: unknown;
  from?: unknown;
  to?: unknown;
}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const perPage = Math.min(Math.max(Number(query.perPage) || 25, 1), 100);
  const projectId = query.project_id ? Number(query.project_id) : undefined;
  const range = dayRange(query.from, query.to);
  const time = rangeCondition(range);
  const where = {
    ...(projectId ? { project_id: projectId } : {}),
    ...(time ? { scan_time: time } : {}),
  };

  const [scans, total, grouped, projects] = await Promise.all([
    scansWithFindings(where, perPage, (page - 1) * perPage),
    scanRepo().count({ where }),
    resultCounts(
      scanRepo().createQueryBuilder("s"),
      "s.result",
      { col: "s.project_id", id: projectId },
      { col: "s.scan_time", range },
    ),
    projectRepo().find({ select: ["id", "name", "page_url"] }),
  ]);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return {
    data: scans.map((s) => ({
      ...s,
      project_name: names.get(s.project_id) ?? `Project #${s.project_id}`,
    })),
    total,
    page,
    perPage,
    counts: { clean: grouped.clean ?? 0, failed: grouped.failed ?? 0, error: grouped.error ?? 0 },
    meta: {
      // Projects that can be scanned — drives the Check History project filter.
      projects: projects.filter((p) => p.page_url).map((p) => ({ id: p.id, name: p.name })),
    },
  };
}

/** A history date filter: `from` / `to` are `YYYY-MM-DD` days (server-local), both inclusive. */
interface DayRange {
  start?: Date;
  /** Exclusive: midnight after the `to` day. */
  end?: Date;
}

function dayRange(from: unknown, to: unknown): DayRange {
  const day = (v: unknown) => (typeof v === "string" && v ? new Date(`${v}T00:00:00`) : undefined);
  const start = day(from);
  const toDay = day(to);
  const end = toDay
    ? new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1)
    : undefined;
  if (start && end && start >= end)
    throw new ApiError(httpStatus.BAD_REQUEST, "The 'from' date must not be after the 'to' date.");
  return { start, end };
}

/** The range as a TypeORM condition on a datetime column, or undefined when unbounded. */
function rangeCondition({ start, end }: DayRange): FindOperator<Date> | undefined {
  if (start && end) return And(MoreThanOrEqual(start), LessThan(end));
  if (start) return MoreThanOrEqual(start);
  if (end) return LessThan(end);
  return undefined;
}

/** `{ status: count }` over a table, restricted to one owner id and/or a time range. */
async function resultCounts(
  qb: import("typeorm").SelectQueryBuilder<object>,
  statusCol: string,
  owner: { col: string; id: number | number[] | undefined },
  time: { col: string; range: DayRange },
): Promise<Record<string, number>> {
  qb.select(statusCol, "status").addSelect("COUNT(*)", "count").groupBy(statusCol).where("1 = 1");
  if (Array.isArray(owner.id))
    qb.andWhere(`${owner.col} IN (:...ownerIds)`, { ownerIds: owner.id });
  else if (owner.id) qb.andWhere(`${owner.col} = :ownerId`, { ownerId: owner.id });
  if (time.range.start) qb.andWhere(`${time.col} >= :start`, { start: time.range.start });
  if (time.range.end) qb.andWhere(`${time.col} < :end`, { end: time.range.end });
  const rows = await qb.getRawMany<{ status: string; count: string }>();
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
}

// ── Files ──────────────────────────────────────────────────────────────────

/**
 * File list WITHOUT `file_content` — the baseline can be megabytes per file, and lists only need
 * names and statuses. The content is served by GET /files/:id (detail page, edit form).
 */
export async function listFiles(projectId?: unknown) {
  const where = Number(projectId) > 0 ? { project_id: Number(projectId) } : {};
  const [files, projects] = await Promise.all([
    fileRepo().find({
      where,
      select: [
        "id",
        "project_id",
        "file_name",
        "file_url",
        "last_check",
        "current_status",
        "created_at",
        "updated_at",
      ],
      order: { created_at: "DESC" },
    }),
    projectRepo().find({ select: ["id", "name"] }),
  ]);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return files.map((f) => ({ ...f, project_name: names.get(f.project_id) ?? "" }));
}

async function assertProject(id: number) {
  if (!(await projectRepo().exist({ where: { id } })))
    throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");
}

function fileUrlOrThrow(raw: unknown): string {
  const url = normalizeFileUrl(raw);
  if (!url.ok) throw new ApiError(httpStatus.BAD_REQUEST, url.message);
  return url.value as string;
}

export async function createFile(body: {
  project_id?: number;
  file_name?: string;
  file_content?: string;
  file_url?: string;
}) {
  const { project_id, file_name, file_content, file_url } = body;
  if (!project_id || !file_name || !file_content || !file_url)
    throw new ApiError(httpStatus.BAD_REQUEST, "All fields are required.");

  await assertProject(Number(project_id));

  const file = fileRepo().create({
    project_id: Number(project_id),
    file_name,
    file_content: normalizeContent(file_content),
    file_url: fileUrlOrThrow(file_url),
    last_check: null,
    current_status: "unchecked",
  });
  return fileRepo().save(file);
}

export async function getFile(id: number) {
  const file = await fileRepo().findOne({ where: { id } });
  if (!file) throw new ApiError(httpStatus.NOT_FOUND, "File not found.");
  const history = await historyRepo().find({
    where: { file_id: file.id },
    order: { check_time: "DESC" },
    take: 20,
  });
  return { ...file, history };
}

export async function updateFile(
  id: number,
  body: {
    project_id?: number;
    file_name?: string;
    file_content?: string;
    file_url?: string;
  },
) {
  const file = await fileRepo().findOne({ where: { id } });
  if (!file) throw new ApiError(httpStatus.NOT_FOUND, "File not found.");
  const { project_id, file_name, file_content, file_url } = body;
  if (!project_id || !file_name || !file_content || !file_url)
    throw new ApiError(httpStatus.BAD_REQUEST, "All fields are required.");
  if (Number(project_id) !== file.project_id) await assertProject(Number(project_id));

  const content = normalizeContent(file_content);
  const url = fileUrlOrThrow(file_url);
  // A new baseline or URL means the last result no longer describes this file.
  if (content !== file.file_content || url !== file.file_url) {
    file.current_status = "unchecked";
    file.last_check = null;
  }
  file.project_id = Number(project_id);
  file.file_name = file_name;
  file.file_content = content;
  file.file_url = url;
  return fileRepo().save(file);
}

export async function deleteFile(id: number) {
  const file = await fileRepo().findOne({ where: { id } });
  if (!file) throw new ApiError(httpStatus.NOT_FOUND, "File not found.");
  // No FK cascade (plain FK column): drop history + file together or not at all.
  await AppDataSource.transaction(async (m) => {
    await m.delete(CheckHistory, { file_id: file.id });
    await m.remove(file);
  });
}

/** POST /files/check — run a single file's check. Returns the runner outcome (422 on fetch error). */
export async function checkFile(id: unknown) {
  if (!id) throw new ApiError(httpStatus.BAD_REQUEST, "File ID required.");
  const file = await fileRepo().findOne({ where: { id: Number(id) } });
  if (!file) throw new ApiError(httpStatus.NOT_FOUND, "File not found.");

  const outcome = await runFileCheck(file);
  if (outcome.status === "error") {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, outcome.error || "Fetch failed");
  }
  return {
    status: outcome.status,
    file: {
      id: file.id,
      file_name: file.file_name,
      file_url: file.file_url,
      project_id: file.project_id,
    },
    rawComparison: outcome.rawComparison,
    report: outcome.report,
    meta: outcome.meta,
  };
}

// ── Emails ───────────────────────────────────────────────────────────────────

export async function listEmails() {
  return emailRepo().find({ order: { created_at: "DESC" } });
}

export async function createEmail(body: { name?: string; email?: string }) {
  if (!body.name?.trim()) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");
  if (!body.email?.trim()) throw new ApiError(httpStatus.BAD_REQUEST, "Email is required.");
  const exists = await emailRepo().findOne({ where: { email: body.email.trim() } });
  if (exists) throw new ApiError(httpStatus.CONFLICT, "Email already exists.");
  const record = emailRepo().create({ name: body.name.trim(), email: body.email.trim() });
  return emailRepo().save(record);
}

export async function getEmail(id: number) {
  const record = await emailRepo().findOne({ where: { id } });
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, "Email not found.");
  return record;
}

export async function updateEmail(id: number, body: { name?: string; email?: string }) {
  const record = await emailRepo().findOne({ where: { id } });
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, "Email not found.");
  if (!body.name?.trim()) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");
  if (!body.email?.trim()) throw new ApiError(httpStatus.BAD_REQUEST, "Email is required.");
  const exists = await emailRepo().findOne({ where: { email: body.email.trim() } });
  if (exists && exists.id !== record.id)
    throw new ApiError(httpStatus.CONFLICT, "Email already exists.");
  record.name = body.name.trim();
  record.email = body.email.trim();
  return emailRepo().save(record);
}

export async function deleteEmail(id: number) {
  const record = await emailRepo().findOne({ where: { id } });
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, "Email not found.");
  await emailRepo().remove(record);
}

// ── Check history ──────────────────────────────────────────────────────────

/**
 * GET /check-history — paged file-check history (optionally one project and/or one file), newest
 * first, with file and project names. `counts` are totals for the whole filter, not just the page.
 * `limit` is accepted as an alias of `perPage` (dashboard "recent checks").
 */
export async function listCheckHistory(query: {
  project_id?: unknown;
  file_id?: unknown;
  page?: unknown;
  perPage?: unknown;
  limit?: unknown;
  from?: unknown;
  to?: unknown;
}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const perPage = Math.min(Math.max(Number(query.perPage ?? query.limit) || 25, 1), 100);
  const range = dayRange(query.from, query.to);
  const time = rangeCondition(range);
  const projectId = Number(query.project_id) > 0 ? Number(query.project_id) : undefined;
  let fileIds: number | number[] | undefined =
    Number(query.file_id) > 0 ? Number(query.file_id) : undefined;
  if (projectId) {
    const ids = (await fileRepo().find({ where: { project_id: projectId }, select: ["id"] })).map(
      (f) => f.id,
    );
    // A file filter outside the chosen project matches nothing; [-1] keeps the IN () valid.
    if (fileIds !== undefined) fileIds = ids.includes(fileIds as number) ? fileIds : [-1];
    else fileIds = ids.length ? ids : [-1];
  }
  const where = {
    ...(fileIds === undefined ? {} : { file_id: Array.isArray(fileIds) ? In(fileIds) : fileIds }),
    ...(time ? { check_time: time } : {}),
  };

  const [history, total, grouped] = await Promise.all([
    historyRepo().find({
      where,
      order: { check_time: "DESC", id: "DESC" },
      take: perPage,
      skip: (page - 1) * perPage,
    }),
    historyRepo().count({ where }),
    resultCounts(
      historyRepo().createQueryBuilder("h"),
      "h.file_status",
      { col: "h.file_id", id: fileIds },
      { col: "h.check_time", range },
    ),
  ]);

  // Names for just this page's files (and their projects) — not the whole files table.
  const pageFileIds = [...new Set(history.map((h) => h.file_id))];
  const files = pageFileIds.length
    ? await fileRepo().find({
        where: { id: In(pageFileIds) },
        select: ["id", "file_name", "project_id"],
      })
    : [];
  const projectIds = [...new Set(files.map((f) => f.project_id))];
  const projects = projectIds.length
    ? await projectRepo().find({ where: { id: In(projectIds) }, select: ["id", "name"] })
    : [];
  const fMap = new Map(files.map((f) => [f.id, f]));
  const pMap = new Map(projects.map((p) => [p.id, p.name]));

  return {
    data: history.map((h) => {
      const f = fMap.get(h.file_id);
      return {
        ...h,
        file_name: f?.file_name ?? `File #${h.file_id}`,
        project_id: f?.project_id ?? null,
        project_name: (f && pMap.get(f.project_id)) || "—",
      };
    }),
    total,
    page,
    perPage,
    counts: { valid: grouped.valid ?? 0, invalid: grouped.invalid ?? 0, error: grouped.error ?? 0 },
  };
}

/** Lightweight id/name list of files (Check History filter), optionally one project's. */
export async function listFileOptions(projectId?: unknown) {
  return fileRepo().find({
    where: Number(projectId) > 0 ? { project_id: Number(projectId) } : {},
    select: ["id", "file_name", "project_id"],
    order: { file_name: "ASC" },
  });
}

/** GET /health — real DB round-trip. */
export async function health() {
  await AppDataSource.query("SELECT 1");
}
