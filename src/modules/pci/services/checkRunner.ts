import { AppDataSource } from "@/config/data-source";
import { FileRecord } from "@/entities/FileRecord";
import { CheckHistory } from "@/entities/CheckHistory";
import { Project } from "@/entities/Project";
import {
  extractValues,
  compareValues,
  detectContentType,
  compareRaw,
} from "@/modules/pci/services/extractor";
import { buildFetchRequest } from "@/modules/pci/services/buildFetchRequest";
import { renderValidationFailed } from "@/modules/pci/services/notifyTemplate";
import { notifyModule } from "@/shared/notify";

/**
 * Shared file-check logic used by both the manual endpoint (files/check) and the cron batch.
 * Fetches the remote file, compares against the stored baseline, records history, updates
 * status, and fires a PCI notification on failure. Notifications go through `@/shared/notify`
 * → the Central dispatcher; PCI never imports Central.
 */

const fileRepo = () => AppDataSource.getRepository(FileRecord);
const historyRepo = () => AppDataSource.getRepository(CheckHistory);
const projectRepo = () => AppDataSource.getRepository(Project);

export interface CheckOutcome {
  id: number;
  file_name: string;
  status: "valid" | "invalid" | "error";
  rawComparison?: ReturnType<typeof compareRaw>;
  report?: ReturnType<typeof compareValues>;
  meta?: { local_content_type: string; remote_content_type: string; detected_as: string };
  error?: string;
}

/** Run a single file check. `projectName` may be supplied by the caller; else resolved from DB. */
export async function runFileCheck(file: FileRecord, projectName?: string): Promise<CheckOutcome> {
  try {
    const { url: fetchUrl, options } = buildFetchRequest(file.file_url);
    const res = await fetch(fetchUrl, options);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const remoteContent = await res.text();

    // Raw comparison is the ground truth for valid/invalid.
    const rawComparison = compareRaw(file.file_content, remoteContent);
    const localValues = extractValues(file.file_content);
    const remoteValues = extractValues(remoteContent);
    const report = compareValues(localValues, remoteValues);

    const status: "valid" | "invalid" = rawComparison.isIdentical ? "valid" : "invalid";

    await historyRepo().save(
      historyRepo().create({ file_id: file.id, check_time: new Date(), file_status: status }),
    );
    file.last_check = new Date();
    file.current_status = status;
    await fileRepo().save(file);

    if (status === "invalid") {
      const name =
        projectName ??
        (await projectRepo().findOne({ where: { id: file.project_id } }))?.name ??
        `Project #${file.project_id}`;

      // Fire-and-forget; delivery failures must not fail the check.
      notifyModule(
        "pci",
        renderValidationFailed({
          file_id: file.id,
          file_name: file.file_name,
          file_url: file.file_url,
          project_name: name,
          check_time: new Date(),
        }),
      ).catch((err) => console.error("[Notify] Failed:", err?.message));
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
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed";
    await historyRepo().save(
      historyRepo().create({ file_id: file.id, check_time: new Date(), file_status: "error" }),
    );
    file.last_check = new Date();
    file.current_status = "invalid";
    await fileRepo().save(file);
    return { id: file.id, file_name: file.file_name, status: "error", error: errorMsg };
  }
}

export interface BatchResult {
  processed: number;
  valid: number;
  invalid: number;
  errors: number;
  results: Array<CheckOutcome | { error: true; reason: string }>;
}

/** Check every file once — PCI's scheduled task and the body of the manual cron trigger. */
export async function runAllFileChecks(): Promise<BatchResult> {
  const [files, projects] = await Promise.all([fileRepo().find(), projectRepo().find()]);
  if (files.length === 0) {
    return { processed: 0, valid: 0, invalid: 0, errors: 0, results: [] };
  }

  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const settled = await Promise.allSettled(
    files.map((file) =>
      runFileCheck(file, projectMap[file.project_id] || `Project #${file.project_id}`),
    ),
  );

  const results = settled.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { error: true as const, reason: String((r as PromiseRejectedResult).reason) },
  );

  return {
    processed: files.length,
    valid: results.filter((r) => "status" in r && r.status === "valid").length,
    invalid: results.filter((r) => "status" in r && r.status === "invalid").length,
    errors: results.filter((r) => "status" in r && r.status === "error").length,
    results,
  };
}
