import { LessThan } from "typeorm";
import { AppDataSource } from "@/config/data-source";
import { CheckHistory } from "@/entities/CheckHistory";
import { runAllFileChecks, type FileBatchSummary } from "@/modules/pci/services/checkRunner";
import { runAllPageScans, type PageScanBatch } from "@/modules/pci/services/runPageScan";
import { runWithLog } from "@/shared/cron";
import logger from "@/config/logger";

/**
 * The PCI batch — every file check, then every payment-page scan, then history retention.
 *
 * Exactly one batch runs at a time, whoever starts it (scheduler or the "Run" button): a run takes
 * minutes and holds Chromium, so overlapping runs would double the load, the history rows and the
 * alerts. The slot is claimed synchronously, so two requests arriving together cannot both start.
 *
 * A manual run is started in the background (`startManualBatch` returns at once); the UI polls
 * `batchStatus()` instead of holding one HTTP request open past proxy timeouts.
 */

export type BatchTrigger = "schedule" | "manual";

export interface PurgeSummary {
  retentionDays: number;
  checkHistory: number;
  pageScans: number;
}

export interface BatchSummary {
  files: FileBatchSummary;
  pageScans: PageScanBatch;
  purged: PurgeSummary | null;
}

export interface BatchStatus {
  running: { trigger: BatchTrigger; startedAt: string } | null;
  last: {
    trigger: BatchTrigger;
    startedAt: string;
    finishedAt: string;
    ok: boolean;
    summary: BatchSummary | null;
    error: string | null;
  } | null;
}

export class BatchBusyError extends Error {}

let running: { trigger: BatchTrigger; startedAt: Date } | null = null;
let last: BatchStatus["last"] = null;

/**
 * Days of check history / page-scan evidence kept (`PCI_HISTORY_RETENTION_DAYS`, default 365 —
 * PCI DSS 10.5.1 asks for twelve months of history). 0 or negative keeps everything.
 */
function retentionDays(): number {
  const raw = process.env.PCI_HISTORY_RETENTION_DAYS;
  const n = raw === undefined || raw.trim() === "" ? 365 : Number(raw);
  return Number.isFinite(n) ? n : 365;
}

/** Delete check history and page scans (+ their findings) older than the retention window. */
export async function purgeOldHistory(): Promise<PurgeSummary | null> {
  const days = retentionDays();
  if (days <= 0) return null;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return AppDataSource.transaction(async (m) => {
    const history = await m.delete(CheckHistory, { check_time: LessThan(cutoff) });
    await m.query(
      "DELETE FROM page_findings WHERE scan_id IN (SELECT id FROM page_scans WHERE scan_time < ?)",
      [cutoff],
    );
    const scans: { affectedRows?: number } = await m.query(
      "DELETE FROM page_scans WHERE scan_time < ?",
      [cutoff],
    );
    return {
      retentionDays: days,
      checkHistory: history.affected ?? 0,
      pageScans: scans.affectedRows ?? 0,
    };
  });
}

function claim(trigger: BatchTrigger) {
  if (running) throw new BatchBusyError("A PCI check run is already in progress.");
  running = { trigger, startedAt: new Date() };
}

/** Run the batch in the already-claimed slot; always releases it and records the outcome. */
async function runClaimed(): Promise<BatchSummary> {
  const { trigger, startedAt } = running!;
  try {
    const files = await runAllFileChecks();
    const pageScans = await runAllPageScans();
    const purged = await purgeOldHistory().catch((err) => {
      logger.error(`[PCI] retention purge failed: ${(err as Error)?.message}`);
      return null;
    });
    const summary = { files, pageScans, purged };
    last = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ok: true,
      summary,
      error: null,
    };
    return summary;
  } catch (err) {
    last = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ok: false,
      summary: null,
      error: err instanceof Error ? err.message : String(err),
    };
    throw err;
  } finally {
    running = null;
  }
}

/** Scheduled task body. A run already in progress (e.g. a manual one) means this tick is skipped. */
export async function runScheduledBatch(): Promise<void> {
  if (running) {
    logger.info("[PCI] scheduled run skipped — a run is already in progress.");
    return;
  }
  claim("schedule");
  await runClaimed();
}

/** "Run" button: start in the background (logged as a manual cron run) and return the status. */
export function startManualBatch(): BatchStatus {
  claim("manual");
  runWithLog("pci", "manual", runClaimed).catch(() => {
    /* outcome recorded in `last` and in the cron log */
  });
  return batchStatus();
}

export function batchStatus(): BatchStatus {
  return {
    running: running
      ? { trigger: running.trigger, startedAt: running.startedAt.toISOString() }
      : null,
    last,
  };
}
