import { Not, IsNull } from "typeorm";
import { AppDataSource } from "@/config/data-source";
import { Project, parseExpectedHeaders } from "@/entities/Project";
import { PageScan } from "@/entities/PageScan";
import { PageFinding } from "@/entities/PageFinding";
import { scanPage } from "@/modules/pci/services/pageScanner";
import { diffSnapshot } from "@/modules/pci/services/pageDiff";
import { renderPageScanFailed, renderCheckError } from "@/modules/pci/services/notifyTemplate";
import { notifyModule } from "@/shared/notify";
import logger from "@/config/logger";

/**
 * One payment-page scan for a project (PCI DSS 11.6.1): scan → compare headers → record the scan,
 * its findings and the project's status → alert. Shared by the manual check and the scheduled
 * batch so both behave identically.
 *
 * Every failed scan alerts (`failed` → "Payment Page Change Detected", `error` → "Check Could Not
 * Run"), whether started by the schedule, the "Run" batch or Check Now — all use this function, so
 * notification behaviour is identical. One scan per project at a time: a second request while one
 * is running gets `ScanBusyError` (each scan holds a whole Chromium).
 */

export class ScanBusyError extends Error {}

/** Projects with a scan in flight (manual or batch). */
const inFlight = new Set<number>();

export interface PageScanOutcome {
  project_id: number;
  project_name: string;
  result: "clean" | "failed" | "error";
  scan_id: number | null;
  findings_count: number;
  error?: string;
}

const projectRepo = () => AppDataSource.getRepository(Project);

export async function runPageScan(project: Project): Promise<PageScanOutcome> {
  if (inFlight.has(project.id)) throw new ScanBusyError("A check of this page is already running.");
  inFlight.add(project.id);
  try {
    return await scanOnce(project);
  } finally {
    inFlight.delete(project.id);
  }
}

async function scanOnce(project: Project): Promise<PageScanOutcome> {
  const base = { project_id: project.id, project_name: project.name, findings_count: 0 };
  if (!project.page_url)
    return { ...base, result: "error", scan_id: null, error: "No page URL configured." };

  const pageUrl = project.page_url;
  const scanTime = new Date();

  try {
    const snapshot = await scanPage(pageUrl);
    const expectedHeaders = parseExpectedHeaders(project.expected_headers);
    const diff = diffSnapshot(snapshot, expectedHeaders);

    // Scan row, its findings and the project's status land together or not at all.
    const scan = await AppDataSource.transaction(async (m) => {
      const saved = await m.save(
        m.create(PageScan, {
          project_id: project.id,
          scan_time: scanTime,
          result: diff.result,
          scripts_found: 0,
          scripts_expected: 0,
          findings_count: diff.findings.length,
          snapshot_json: JSON.stringify(snapshot),
          error_message: null,
        }),
      );
      if (diff.findings.length > 0)
        await m.insert(
          PageFinding,
          diff.findings.map((f) => ({ ...f, scan_id: saved.id, project_id: project.id })),
        );
      await m.update(
        Project,
        { id: project.id },
        { last_scan: scanTime, scan_status: diff.result },
      );
      return saved;
    });

    logger.info(
      `[PageScan] "${project.name}" → ${diff.result.toUpperCase()} · ` +
        `headers checked ${expectedHeaders.length} · findings ${diff.findings.length}`,
    );

    if (diff.result === "failed") {
      // Fire-and-forget; delivery failures must not fail the scan.
      notifyModule(
        "pci",
        renderPageScanFailed({
          project_id: project.id,
          project_name: project.name,
          page_url: pageUrl,
          scan_time: scanTime,
          findings: diff.findings,
        }),
      ).catch((err) => logger.error(`[PageScan] notify failed: ${(err as Error)?.message}`));
    }

    return { ...base, result: diff.result, scan_id: scan.id, findings_count: diff.findings.length };
  } catch (err: unknown) {
    const message = (err instanceof Error ? err.message : "Scan failed").slice(0, 2000);
    logger.error(`[PageScan] "${project.name}" → ERROR · ${message}`);

    const scan = await AppDataSource.transaction(async (m) => {
      const saved = await m.save(
        m.create(PageScan, {
          project_id: project.id,
          scan_time: scanTime,
          result: "error",
          snapshot_json: null,
          error_message: message,
        }),
      );
      await m.update(Project, { id: project.id }, { last_scan: scanTime, scan_status: "error" });
      return saved;
    });

    notifyModule(
      "pci",
      renderCheckError({
        kind: "page",
        subject: project.name,
        project_name: project.name,
        url: pageUrl,
        error: message,
        check_time: scanTime,
        path: `/pci/projects/${project.id}`,
      }),
    ).catch((e) => logger.error(`[PageScan] notify failed: ${(e as Error)?.message}`));

    return { ...base, result: "error", scan_id: scan.id, error: message };
  }
}

export interface PageScanBatch {
  scanned: number;
  clean: number;
  failed: number;
  errors: number;
}

/**
 * Scan every project with a page URL. Sequential on purpose: each scan launches a headless
 * Chromium, and running them in parallel would exhaust the server's memory.
 */
export async function runAllPageScans(): Promise<PageScanBatch> {
  const projects = await projectRepo().find({ where: { page_url: Not(IsNull()) } });
  const results: PageScanOutcome[] = [];
  for (const project of projects) {
    try {
      results.push(await runPageScan(project));
    } catch (err) {
      // A manual check of this page is already running — it records its own result.
      if (err instanceof ScanBusyError) continue;
      // runPageScan records its own failures; this only catches a DB error while recording one.
      results.push({
        project_id: project.id,
        project_name: project.name,
        result: "error",
        scan_id: null,
        findings_count: 0,
        error: err instanceof Error ? err.message : "Scan failed",
      });
    }
  }
  return {
    scanned: results.length,
    clean: results.filter((r) => r.result === "clean").length,
    failed: results.filter((r) => r.result === "failed").length,
    errors: results.filter((r) => r.result === "error").length,
  };
}
