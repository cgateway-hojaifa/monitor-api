import { AppDataSource } from "@/config/data-source";
import { Project } from "@/entities/Project";
import { FileRecord } from "@/entities/FileRecord";
import { CheckHistory } from "@/entities/CheckHistory";
import { Email } from "@/entities/Email";
import { normalizeContent } from "@/modules/pci/services/extractor";
import { runFileCheck, runAllFileChecks } from "@/modules/pci/services/checkRunner";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";

const projectRepo = () => AppDataSource.getRepository(Project);
const fileRepo = () => AppDataSource.getRepository(FileRecord);
const historyRepo = () => AppDataSource.getRepository(CheckHistory);
const emailRepo = () => AppDataSource.getRepository(Email);

// ── Projects ────────────────────────────────────────────────────────────────

export async function listProjects() {
  const projects = await projectRepo().find({ order: { created_at: "DESC" } });
  return Promise.all(
    projects.map(async (p) => ({
      ...p,
      file_count: await fileRepo().count({ where: { project_id: p.id } }),
    })),
  );
}

export async function createProject(body: { name?: string; description?: string }) {
  if (!body.name) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");
  const project = projectRepo().create({ name: body.name, description: body.description || null });
  return projectRepo().save(project);
}

export async function getProject(id: number) {
  const project = await projectRepo().findOne({ where: { id } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");
  const files = await fileRepo().find({
    where: { project_id: project.id },
    order: { created_at: "DESC" },
  });
  return { ...project, files };
}

export async function updateProject(id: number, body: { name?: string; description?: string }) {
  const project = await projectRepo().findOne({ where: { id } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");
  if (!body.name) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");
  project.name = body.name;
  project.description = body.description || null;
  return projectRepo().save(project);
}

export async function deleteProject(id: number) {
  const project = await projectRepo().findOne({ where: { id } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");
  await fileRepo().delete({ project_id: project.id });
  await projectRepo().remove(project);
}

// ── Files ──────────────────────────────────────────────────────────────────

export async function listFiles(projectId?: string) {
  const where = projectId ? { project_id: Number(projectId) } : {};
  const files = await fileRepo().find({ where, order: { created_at: "DESC" } });
  const projects = await projectRepo().find();
  const pMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  return files.map((f) => ({ ...f, project_name: pMap[f.project_id] || "" }));
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

  const project = await projectRepo().findOne({ where: { id: Number(project_id) } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");

  const file = fileRepo().create({
    project_id: Number(project_id),
    file_name,
    file_content: normalizeContent(file_content),
    file_url,
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
  file.project_id = Number(project_id);
  file.file_name = file_name;
  file.file_content = normalizeContent(file_content);
  file.file_url = file_url;
  return fileRepo().save(file);
}

export async function deleteFile(id: number) {
  const file = await fileRepo().findOne({ where: { id } });
  if (!file) throw new ApiError(httpStatus.NOT_FOUND, "File not found.");
  await historyRepo().delete({ file_id: file.id });
  await fileRepo().remove(file);
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

export async function listCheckHistory(fileId?: string, limitRaw?: unknown) {
  const limit = Math.min(Number(limitRaw ?? "50"), 200);
  const where = fileId ? { file_id: Number(fileId) } : {};
  const history = await historyRepo().find({ where, order: { check_time: "DESC" }, take: limit });

  const files = await fileRepo().find();
  const projects = await projectRepo().find();
  const pMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const fMap = Object.fromEntries(
    files.map((f) => [f.id, { name: f.file_name, project_id: f.project_id }]),
  );

  return history.map((h) => ({
    ...h,
    file_name: fMap[h.file_id]?.name || `File #${h.file_id}`,
    project_name: pMap[fMap[h.file_id]?.project_id as number] || "—",
  }));
}

// ── Cron batch (shared runner) ───────────────────────────────────────────────
export { runAllFileChecks };
