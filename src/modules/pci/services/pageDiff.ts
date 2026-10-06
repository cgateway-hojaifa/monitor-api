import type { FindingType } from "@/entities/PageFinding";
import type { ExpectedHeader } from "@/entities/Project";
import type { PageSnapshot } from "@/modules/pci/services/pageScanner";

/** Compare a page snapshot against the project's expected headers (exact value match). */

export interface DiffFinding {
  type: FindingType;
  subject: string;
  expected_value: string | null;
  observed_value: string | null;
}

export interface DiffResult {
  findings: DiffFinding[];
  result: "clean" | "failed";
}

function truncate(value: string, max = 2000): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function diffSnapshot(
  snapshot: PageSnapshot,
  expectedHeaders: ExpectedHeader[],
): DiffResult {
  const findings: DiffFinding[] = [];

  for (const expected of expectedHeaders) {
    const name = expected.name.toLowerCase();
    const observed = snapshot.headers[name];

    if (observed === undefined) {
      findings.push({
        type: "HEADER_REMOVED",
        subject: name,
        expected_value: truncate(expected.value),
        observed_value: null,
      });
    } else if (observed !== expected.value) {
      findings.push({
        type: "HEADER_CHANGED",
        subject: name,
        expected_value: truncate(expected.value),
        observed_value: truncate(observed),
      });
    }
  }

  return { findings, result: findings.length > 0 ? "failed" : "clean" };
}
