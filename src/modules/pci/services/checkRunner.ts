import { AppDataSource } from "@/config/data-source";
import { FileRecord, type FileStatus } from "@/entities/FileRecord";
import { CheckHistory } from "@/entities/CheckHistory";
import { Project } from "@/entities/Project";
import {
  extractValues,
  compareValues,
  detectContentType,
  compareRaw,
} from "@/modules/pci/services/extractor";
import { buildFetchRequest } from "@/modules/pci/services/buildFetchRequest";
import { fetchChecked, mapLimit } from "@/modules/pci/services/targetGuard";
import { renderValidationFailed, renderCheckError } from "@/modules/pci/services/notifyTemplate";
import { notifyModule } from "@/shared/notify";
import logger from "@/config/logger";

/**
 * Shared file-check logic used by both the manual endpoint (files/check) and the batch.
 * Fetches the remote file, compares against the stored baseline, records history, updates
 * status, and notifies through `@/shared/notify`.
 *
 * Statuses: `valid` / `invalid` come from the comparison; `error` means the file could not be
 * fetched (host down, 404, timeout, refused target) — recorded with its reason, never as tampering.
 *
 * Every failed check alerts — `invalid` ("Validation Failed") and `error` ("Check Could Not Run")
 * — whether it ran from the schedule, the "Run" batch or a manual check: all three call this one
 * function, so notification behaviour is identical. A file that stays invalid alerts on each run.
 */

const fileRepo = () => AppDataSource.getRepository(FileRecord);
const historyRepo = () => AppDataSource.getRepository(CheckHistory);
const projectRepo = () => AppDataSource.getRepository(Project);

/** Largest remote file accepted (bytes). A bigger response is cut off and recorded as an error. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Files fetched at once by the batch — enough to be quick, few enough not to flood hosts. */
const FETCH_CONCURRENCY = 5;

export interface CheckOutcome {
  id: number;
  file_name: string;
  status: "valid" | "invalid" | "error";
  rawComparison?: ReturnType<typeof compareRaw>;
  report?: ReturnType<typeof compareValues>;
  meta?: { local_content_type: string; remote_content_type: string; detected_as: string };
  error?: string;
}

async function projectName(file: FileRecord, known?: string): Promise<string> {
  return (
    known ??
    (await projectRepo().findOne({ where: { id: file.project_id } }))?.name ??
    `Project #${file.project_id}`
  );
}

async function record(
  file: FileRecord,
  status: FileStatus & CheckHistory["file_status"],
  message: string | null,
) {
  const now = new Date();
  await historyRepo().save(
    historyRepo().create({ file_id: file.id, check_time: now, file_status: status, message }),
  );
  file.last_check = now;
  file.current_status = status;
  await fileRepo().save(file);
}

/** Run a single file check. `knownProjectName` may be supplied by the caller; else resolved. */
export async function runFileCheck(
  file: FileRecord,
  knownProjectName?: string,
): Promise<CheckOutcome> {
  let remoteContent: string;

  try {
    const { url: fetchUrl, options } = buildFetchRequest(file.file_url);
    const res = await fetchChecked(fetchUrl, options, MAX_FILE_BYTES);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    remoteContent = res.body;
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    const message = (
      name === "TimeoutError" || name === "AbortError"
        ? "Timeout"
        : err instanceof Error
          ? err.message
          : "Fetch failed"
    ).slice(0, 500);

    await record(file, "error", message);
    notifyModule(
      "pci",
      renderCheckError({
        kind: "file",
        subject: file.file_name,
        project_name: await projectName(file, knownProjectName),
        url: file.file_url,
        error: message,
        check_time: new Date(),
        path: `/pci/files/${file.id}`,
      }),
    ).catch((e) => logger.error(`[PCI] notify failed: ${(e as Error)?.message}`));
    return { id: file.id, file_name: file.file_name, status: "error", error: message };
  }

  // Raw comparison is the ground truth for valid/invalid; the extracted-value report explains it.
  const rawComparison = compareRaw(file.file_content, remoteContent);
  const report = compareValues(extractValues(file.file_content), extractValues(remoteContent));
  const status: "valid" | "invalid" = rawComparison.isIdentical ? "valid" : "invalid";

  await record(file, status, null);

  if (status === "invalid") {
    // Fire-and-forget; delivery failures must not fail the check.
    notifyModule(
      "pci",
      renderValidationFailed({
        file_id: file.id,
        file_name: file.file_name,
        file_url: file.file_url,
        project_name: await projectName(file, knownProjectName),
        check_time: new Date(),
      }),
    ).catch((e) => logger.error(`[PCI] notify failed: ${(e as Error)?.message}`));
  }

  return {
    id: file.id,
    file_name: file.file_name,
    status,
    rawComparison,
    report,
    meta: {
      local_content_type: detectContentType(file.file_content),
      remote_content_type: detectContentType(remoteContent),
      detected_as: report.contentType,
    },
  };
}

export interface FileBatchSummary {
  processed: number;
  valid: number;
  invalid: number;
  errors: number;
}

/** Check every file once (at most FETCH_CONCURRENCY at a time). Counts only — no per-file detail. */
export async function runAllFileChecks(): Promise<FileBatchSummary> {
  const [files, projects] = await Promise.all([fileRepo().find(), projectRepo().find()]);
  const names = new Map(projects.map((p) => [p.id, p.name]));

  const settled = await mapLimit(files, FETCH_CONCURRENCY, (file) =>
    runFileCheck(file, names.get(file.project_id) ?? `Project #${file.project_id}`),
  );

  const summary: FileBatchSummary = { processed: files.length, valid: 0, invalid: 0, errors: 0 };
  for (const r of settled) {
    if (r.status === "rejected") {
      // runFileCheck records its own failures; this is a DB error while recording one.
      summary.errors++;
      logger.error(`[PCI] file check failed to record: ${String(r.reason)}`);
    } else if (r.value.status === "valid") summary.valid++;
    else if (r.value.status === "invalid") summary.invalid++;
    else summary.errors++;
  }
  return summary;
}
