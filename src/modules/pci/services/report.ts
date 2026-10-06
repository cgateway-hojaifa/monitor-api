import { In } from "typeorm";
import { AppDataSource } from "@/config/data-source";
import { Project } from "@/entities/Project";
import { FileRecord } from "@/entities/FileRecord";
import { CheckHistory } from "@/entities/CheckHistory";
import { PageScan } from "@/entities/PageScan";
import { PageFinding } from "@/entities/PageFinding";
import { parseExpectedHeaders } from "@/entities/Project";
import type { FileStatus } from "@/entities/FileRecord";
import { launchBrowser } from "@/modules/pci/services/browser";

/**
 * PCI report generation — single-project and all-projects reports, each renderable as PDF
 * (via puppeteer-core + @sparticuz/chromium) or CSV. HTML/CSV builders are pure; the service
 * functions gather data from repositories and return `{ contentType, filename, body }` so the
 * controller stays transport-only.
 */

const projectRepo = () => AppDataSource.getRepository(Project);
const fileRepo = () => AppDataSource.getRepository(FileRecord);
const historyRepo = () => AppDataSource.getRepository(CheckHistory);
const scanRepo = () => AppDataSource.getRepository(PageScan);
const findingRepo = () => AppDataSource.getRepository(PageFinding);

export interface ReportOutput {
  contentType: string;
  filename: string;
  body: Buffer | string;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Render HTML to a PDF buffer using headless chromium. */
async function htmlToPdf(
  html: string,
  margin: { top: string; bottom: string; left: string; right: string },
): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" as never });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true, margin });
    return Buffer.from(pdfBuffer);
  } finally {
    // Always close, or a failed render leaves a Chromium process running.
    await browser.close().catch(() => {});
  }
}

// ─── Single-project report ──────────────────────────────────────────────────

interface FileRow {
  id: number;
  file_name: string;
  file_url: string;
  last_check: string | null;
  current_status: FileStatus;
}

interface ScanFindingRow {
  type: string;
  subject: string;
}

interface ScanRow {
  scan_time: string;
  result: string;
  findings_count: number;
  error_message: string | null;
  findings: ScanFindingRow[];
}

/** PCI DSS 11.6.1 evidence for a project with a monitored payment page. */
interface PageMonitoring {
  page_url: string;
  scan_status: string;
  last_scan: string | null;
  expectedHeaders: Array<{ name: string; value: string }>;
  scans: ScanRow[];
}

interface ProjectType {
  id: number;
  name: string;
  description: string | null;
  files: FileRow[];
  monitoring: PageMonitoring | null;
}

function buildCSV(project: ProjectType): string {
  const header = ["#", "File Name", "Status", "Last Check", "URL"];
  const rows = project.files.map((f, i) => [
    String(i + 1),
    `"${f.file_name.replace(/"/g, '""')}"`,
    f.current_status,
    fmtDate(f.last_check),
    `"${f.file_url.replace(/"/g, '""')}"`,
  ]);
  return [header.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

// ─── PCI DSS 11.6.1 evidence section ──────────────────────────────────────────

const FINDING_LABEL: Record<string, string> = {
  HEADER_REMOVED: "Header missing",
  HEADER_CHANGED: "Header value changed",
};

function fmtDateTime(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The PCI check cadence as configured (PCI_INTERVAL_SEC), for the evidence text. */
function checkFrequency(): string {
  const sec = Number(process.env.PCI_INTERVAL_SEC);
  if (!(sec > 0)) return "manual checks only (no schedule configured)";
  const hours = sec / 3600;
  return Number.isInteger(hours)
    ? `every ${hours} hour${hours === 1 ? "" : "s"}`
    : `every ${sec} seconds`;
}

function buildMonitoringHTML(project: ProjectType): string {
  const m = project.monitoring;
  if (!m) return "";

  const headerRows =
    m.expectedHeaders.length === 0
      ? `<tr><td colspan="2" class="empty">No HTTP headers are configured for checking on this project.</td></tr>`
      : m.expectedHeaders
          .map(
            (h) => `
        <tr>
          <td class="mono" style="width:230px;">${escapeHtml(h.name)}</td>
          <td class="url">${escapeHtml(h.value)}</td>
        </tr>`,
          )
          .join("");

  const scanRows =
    m.scans.length === 0
      ? `<tr><td colspan="4" class="empty">No scans recorded yet.</td></tr>`
      : m.scans
          .map((s) => {
            const style =
              s.result === "clean"
                ? "color:#15803d;background:#f0fdf4;border:1px solid #86efac;"
                : s.result === "failed"
                  ? "color:#b91c1c;background:#fef2f2;border:1px solid #fca5a5;"
                  : "color:#b45309;background:#fffbeb;border:1px solid #fcd34d;";
            const label =
              s.result === "clean" ? "✔ Clean" : s.result === "failed" ? "✖ Failed" : "! Error";
            return `
        <tr>
          <td class="muted">${fmtDateTime(s.scan_time)}</td>
          <td class="center"><span class="badge" style="${style}">${label}</span></td>
          <td class="center muted">${s.result === "error" ? "—" : String(m.expectedHeaders.length)}</td>
          <td class="center muted">${s.result === "error" ? escapeHtml(s.error_message || "Error") : String(s.findings_count)}</td>
        </tr>`;
          })
          .join("");

  const allFindings = m.scans.flatMap((s) =>
    s.findings.map((f) => ({ scan_time: s.scan_time, ...f })),
  );
  const findingRows =
    allFindings.length === 0
      ? `<tr><td colspan="3" class="empty">No change or tamper findings recorded.</td></tr>`
      : allFindings
          .map(
            (f) => `
        <tr>
          <td class="muted" style="width:120px;">${fmtDateTime(f.scan_time)}</td>
          <td>${escapeHtml(FINDING_LABEL[f.type] || f.type)}</td>
          <td class="url">${escapeHtml(f.subject)}</td>
        </tr>`,
          )
          .join("");

  const frequency = checkFrequency();

  return `
<div style="page-break-before:always;"></div>

<div style="margin:0 0 14px;">
  <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;">PCI DSS Requirement 11.6.1</div>
  <div style="font-size:17px;font-weight:700;color:#111827;margin-top:2px;">Payment Page Change &amp; Tamper Detection</div>
  <p style="font-size:12px;color:#6b7280;margin-top:6px;line-height:1.5;">
    The monitored payment page is loaded in a browser engine so that the HTTP response headers
    are evaluated exactly as received by the consumer browser. The headers listed below are
    compared against their expected values on every check. The mechanism runs automatically
    ${frequency}. Detected changes generate an alert to designated personnel and are recorded
    in the check history below.
  </p>
</div>

<table style="margin-bottom:18px;">
  <thead><tr><th colspan="2">Monitoring Configuration</th></tr></thead>
  <tbody>
    <tr><td class="mono" style="width:230px;">Monitored page URL</td><td class="url">${escapeHtml(m.page_url)}</td></tr>
    <tr><td class="mono">Last checked</td><td class="muted">${fmtDateTime(m.last_scan)}</td></tr>
    <tr><td class="mono">Current status</td><td class="muted">${escapeHtml(m.scan_status)}</td></tr>
    <tr><td class="mono">Check frequency</td><td class="muted">${frequency}</td></tr>
  </tbody>
</table>

<table style="margin-bottom:18px;">
  <thead><tr><th>Checked HTTP Header</th><th>Expected Value</th></tr></thead>
  <tbody>${headerRows}</tbody>
</table>

<table style="margin-bottom:18px;">
  <thead>
    <tr>
      <th>Scan Time</th>
      <th class="center" style="width:90px;">Result</th>
      <th class="center" style="width:110px;">Headers Checked</th>
      <th class="center" style="width:80px;">Findings</th>
    </tr>
  </thead>
  <tbody>${scanRows}</tbody>
</table>

<table>
  <thead><tr><th>Detected At</th><th>Finding</th><th>Subject</th></tr></thead>
  <tbody>${findingRows}</tbody>
</table>
`;
}

/** The last 30 scans of a monitored project + their findings, or null when no page is set. */
async function loadMonitoring(project: {
  id: number;
  page_url: string | null;
  scan_status: string;
  last_scan: Date | null;
  expected_headers: string | null;
}): Promise<PageMonitoring | null> {
  if (!project.page_url) return null;
  const scans = await scanRepo().find({
    where: { project_id: project.id },
    order: { scan_time: "DESC" },
    take: 30,
  });
  const findings = scans.length
    ? await findingRepo().find({
        where: { scan_id: In(scans.map((s) => s.id)) },
        order: { id: "ASC" },
      })
    : [];
  const byScan = new Map<number, ScanFindingRow[]>();
  for (const f of findings)
    byScan.set(f.scan_id, [...(byScan.get(f.scan_id) ?? []), { type: f.type, subject: f.subject }]);

  return {
    page_url: project.page_url,
    scan_status: project.scan_status,
    last_scan: project.last_scan ? new Date(project.last_scan).toISOString() : null,
    expectedHeaders: parseExpectedHeaders(project.expected_headers),
    scans: scans.map((s) => ({
      scan_time: new Date(s.scan_time).toISOString(),
      result: s.result,
      findings_count: s.findings_count,
      error_message: s.error_message,
      findings: byScan.get(s.id) ?? [],
    })),
  };
}

function buildReportHTML(project: ProjectType): string {
  const counts = {
    total: project.files.length,
    valid: project.files.filter((f) => f.current_status === "valid").length,
    invalid: project.files.filter((f) => f.current_status === "invalid").length,
    unchecked: project.files.filter((f) => f.current_status === "unchecked").length,
  };

  const statusStyle = (s: string) => {
    if (s === "valid") return "color:#15803d;background:#f0fdf4;border:1px solid #86efac;";
    if (s === "invalid") return "color:#b91c1c;background:#fef2f2;border:1px solid #fca5a5;";
    if (s === "error") return "color:#b45309;background:#fffbeb;border:1px solid #fcd34d;";
    return "color:#6b7280;background:#f9fafb;border:1px solid #e5e7eb;";
  };

  const statusLabel = (s: string) =>
    s === "valid"
      ? "✔ Valid"
      : s === "invalid"
        ? "✖ Invalid"
        : s === "error"
          ? "! Error"
          : "? Unchecked";

  const rows = project.files
    .map(
      (f, i) => `
    <tr>
      <td class="center muted">${i + 1}</td>
      <td class="mono">${escapeHtml(f.file_name)}</td>
      <td class="center">
        <span class="badge" style="${statusStyle(f.current_status)}">${statusLabel(f.current_status)}</span>
      </td>
      <td class="muted">${fmtDate(f.last_check)}</td>
      <td class="url">${escapeHtml(f.file_url)}</td>
    </tr>`,
    )
    .join("");

  const emptyRow =
    project.files.length === 0
      ? `<tr><td colspan="5" class="empty">No files found in this project.</td></tr>`
      : "";

  const uncheckedBadge =
    counts.unchecked > 0
      ? `<span class="bdg bdg-other">
        <span class="bdg-dot bdg-dot-other"></span>
        ${counts.unchecked} Unchecked
       </span>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Report – ${escapeHtml(project.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 14px;
    color: #1f2937;
    background: #fff;
    padding: 32px 36px;
  }

  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 16px;
    border-bottom: 1.5px solid #e5e7eb;
    margin-bottom: 20px;
    gap: 16px;
  }
  .header-left h1 {
    font-size: 20px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 3px;
  }
  .header-left p {
    font-size: 13px;
    color: #6b7280;
  }

  /* ── Summary Badges ── */
  .badge-row {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
    align-items: center;
  }
  .bdg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid;
    white-space: nowrap;
  }
  .bdg-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .bdg-valid       { background: #f0fdf4; border-color: #86efac; color: #15803d; }
  .bdg-dot-valid   { background: #16a34a; }
  .bdg-invalid     { background: #fef2f2; border-color: #fca5a5; color: #b91c1c; }
  .bdg-dot-invalid { background: #dc2626; }
  .bdg-other       { background: #f9fafb; border-color: #e5e7eb; color: #6b7280; }
  .bdg-dot-other   { background: #9ca3af; }

  /* ── Table ── */
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead tr { background: #f9fafb; }
  th {
    padding: 8px 10px;
    text-align: left;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9ca3af;
    border-bottom: 1.5px solid #e5e7eb;
    white-space: nowrap;
  }
  td {
    padding: 7px 10px;
    font-size: 13px;
    border-bottom: 1px solid #f3f4f6;
    color: #374151;
    vertical-align: middle;
  }
  tr:last-child td { border-bottom: none; }
  .center { text-align: center; }
  .muted  { color: #6b7280; }
  .mono   { font-family: 'Courier New', monospace; font-size: 13px; color: #111827; font-weight: 600; letter-spacing: 0.01em; }

  /* URL — full wrap, no truncation */
  .url {
    font-size: 12px;
    color: #6b7280;
    word-break: break-all;
    overflow-wrap: anywhere;
  }

  /* ── Status Badge ── */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }

  .empty {
    text-align: center;
    padding: 28px;
    color: #9ca3af;
    font-style: italic;
  }

  /* ── Footer ── */
  .footer {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    font-size: 12px;
    color: #9ca3af;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <h1>${escapeHtml(project.name)}</h1>
    ${project.description ? `<p>${escapeHtml(project.description)}</p>` : ""}
  </div>
  <div class="badge-row">
    <span class="bdg bdg-valid">
      <span class="bdg-dot bdg-dot-valid"></span>
      ${counts.valid} Valid
    </span>
    <span class="bdg bdg-invalid">
      <span class="bdg-dot bdg-dot-invalid"></span>
      ${counts.invalid} Invalid
    </span>
    ${uncheckedBadge}
  </div>
</div>

<table>
  <thead>
    <tr>
      <th class="center" style="width:36px">#</th>
      <th>File Name</th>
      <th class="center" style="width:88px">Status</th>
      <th style="width:110px">Last Check</th>
      <th>URL</th>
    </tr>
  </thead>
  <tbody>${rows || emptyRow}</tbody>
</table>

${buildMonitoringHTML(project)}

<div class="footer">
  <span>Generated: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
  <span>${counts.total} files total</span>
</div>

</body>
</html>`;
}

/** GET /projects/:id/report — single-project PDF (default) or CSV. Throws for not-found. */
export async function reportOne(projectId: number, format: string): Promise<ReportOutput | null> {
  const projectRecord = await projectRepo().findOne({ where: { id: projectId } });
  if (!projectRecord) return null;

  const fileRecords = await fileRepo().find({
    where: { project_id: projectRecord.id },
    order: { file_name: "ASC" },
  });

  const files: FileRow[] = fileRecords.map((f) => ({
    id: f.id,
    file_name: f.file_name,
    file_url: f.file_url,
    last_check: f.last_check ? new Date(f.last_check).toISOString() : null,
    current_status: f.current_status,
  }));

  const project: ProjectType = {
    id: projectRecord.id,
    name: projectRecord.name,
    description: projectRecord.description ?? null,
    files,
    monitoring: await loadMonitoring(projectRecord),
  };

  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, "_");

  if (format === "csv") {
    return {
      contentType: "text/csv; charset=utf-8",
      filename: `${safeName}.csv`,
      body: buildCSV(project),
    };
  }

  const html = buildReportHTML(project);
  const pdf = await htmlToPdf(html, { top: "12mm", bottom: "12mm", left: "0mm", right: "0mm" });
  return { contentType: "application/pdf", filename: `${safeName}.pdf`, body: pdf };
}

// ─── All-projects report ─────────────────────────────────────────────────────

interface FileWithHistory {
  id: number;
  file_name: string;
  file_url: string;
  last_check: Date | null;
  current_status: string;
  lastHistory: { check_time: Date; file_status: string } | null;
}

interface ProjectWithFiles {
  id: number;
  name: string;
  description: string | null;
  files: FileWithHistory[];
}

function generateAllCSV(projects: ProjectWithFiles[], generatedAt: Date): string {
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const totalFiles = projects.reduce((a, p) => a + p.files.length, 0);
  const totalValid = projects.reduce(
    (a, p) => a + p.files.filter((f) => f.current_status === "valid").length,
    0,
  );
  const totalInvalid = projects.reduce(
    (a, p) => a + p.files.filter((f) => f.current_status === "invalid").length,
    0,
  );
  const totalUnchecked = projects.reduce(
    (a, p) => a + p.files.filter((f) => f.current_status === "unchecked").length,
    0,
  );

  const rows: string[] = [];
  rows.push(`# All Projects Validation Report`);
  rows.push(
    `# Generated: ${generatedAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "medium" })}`,
  );
  rows.push(`# Total Projects: ${projects.length}`);
  rows.push(`# Total Files: ${totalFiles}`);
  rows.push(``);
  rows.push(`# Overall Summary`);
  rows.push(`Status,Count`);
  rows.push(`Valid,${totalValid}`);
  rows.push(`Invalid,${totalInvalid}`);
  rows.push(`Unchecked,${totalUnchecked}`);
  rows.push(``);

  for (const project of projects) {
    const valid = project.files.filter((f) => f.current_status === "valid").length;
    const invalid = project.files.filter((f) => f.current_status === "invalid").length;
    const unchecked = project.files.filter((f) => f.current_status === "unchecked").length;
    rows.push(`# Project: ${escape(project.name)}`);
    if (project.description) rows.push(`# Description: ${escape(project.description)}`);
    rows.push(
      `# Files: ${project.files.length}  |  Valid: ${valid}  |  Invalid: ${invalid}  |  Unchecked: ${unchecked}`,
    );
    rows.push(``);
    if (project.files.length === 0) {
      rows.push(`# (No files in this project)`);
      rows.push(``);
      continue;
    }
    rows.push(["No.", "File Name", "Status", "Last Checked", "File URL"].map(escape).join(","));
    project.files.forEach((f, i) => {
      rows.push(
        [
          i + 1,
          f.file_name,
          f.current_status.charAt(0).toUpperCase() + f.current_status.slice(1),
          f.last_check ? new Date(f.last_check).toLocaleString("en-US") : "Never",
          f.file_url,
        ]
          .map(escape)
          .join(","),
      );
    });
    rows.push(``);
  }
  return rows.join("\r\n");
}

function buildAllProjectsHTML(projects: ProjectWithFiles[], generatedAt: Date): string {
  const totalFiles = projects.reduce((a, p) => a + p.files.length, 0);
  const totalValid = projects.reduce(
    (a, p) => a + p.files.filter((f) => f.current_status === "valid").length,
    0,
  );
  const totalInvalid = projects.reduce(
    (a, p) => a + p.files.filter((f) => f.current_status === "invalid").length,
    0,
  );
  const totalUnchecked = projects.reduce(
    (a, p) => a + p.files.filter((f) => f.current_status === "unchecked").length,
    0,
  );
  const dateStr = generatedAt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const statusStyle = (s: string) => {
    if (s === "valid") return "color:#15803d;background:#f0fdf4;border:1px solid #86efac;";
    if (s === "invalid") return "color:#b91c1c;background:#fef2f2;border:1px solid #fca5a5;";
    if (s === "error") return "color:#b45309;background:#fffbeb;border:1px solid #fcd34d;";
    return "color:#6b7280;background:#f9fafb;border:1px solid #e5e7eb;";
  };
  const statusLabel = (s: string) =>
    s === "valid"
      ? "✔ Valid"
      : s === "invalid"
        ? "✖ Invalid"
        : s === "error"
          ? "! Error"
          : "? Unchecked";

  const summaryRows = projects
    .map((p) => {
      const v = p.files.filter((f) => f.current_status === "valid").length;
      const inv = p.files.filter((f) => f.current_status === "invalid").length;
      const u = p.files.filter((f) => f.current_status === "unchecked").length;
      return `
      <tr>
        <td class="mono">${escapeHtml(p.name)}</td>
        <td class="desc muted">${p.description ? escapeHtml(p.description) : "—"}</td>
        <td class="center">${p.files.length}</td>
        <td class="center" style="color:#15803d;font-weight:600">${v}</td>
        <td class="center" style="color:#b91c1c;font-weight:600">${inv}</td>
        <td class="center" style="color:#6b7280">${u}</td>
      </tr>`;
    })
    .join("");

  const projectPages = projects
    .map((p, pi) => {
      const v = p.files.filter((f) => f.current_status === "valid").length;
      const inv = p.files.filter((f) => f.current_status === "invalid").length;
      const u = p.files.filter((f) => f.current_status === "unchecked").length;

      const fileRows =
        p.files.length === 0
          ? `<tr><td colspan="5" class="empty">No files in this project.</td></tr>`
          : p.files
              .map(
                (f, i) => `
          <tr>
            <td class="center muted">${i + 1}</td>
            <td class="mono">${escapeHtml(f.file_name)}</td>
            <td class="center">
              <span class="badge" style="${statusStyle(f.current_status)}">${statusLabel(f.current_status)}</span>
            </td>
            <td class="muted">${fmtDate(f.last_check)}</td>
            <td class="url">${escapeHtml(f.file_url)}</td>
          </tr>`,
              )
              .join("");

      const uncheckedBadge =
        u > 0
          ? `<span class="bdg bdg-other"><span class="bdg-dot bdg-dot-other"></span>${u} Unchecked</span>`
          : "";

      const pageBreak = `style="page-break-before: always;"`;

      return `
      <div class="project-page" ${pageBreak}>
        <!-- Project header -->
        <div class="header">
          <div class="header-left">
            <h1>${escapeHtml(p.name)}</h1>
            ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ""}
            <span class="pg-num">Project ${pi + 1} of ${projects.length}</span>
          </div>
          <div class="badge-row">
            <span class="bdg bdg-valid"><span class="bdg-dot bdg-dot-valid"></span>${v} Valid</span>
            <span class="bdg bdg-invalid"><span class="bdg-dot bdg-dot-invalid"></span>${inv} Invalid</span>
            ${uncheckedBadge}
          </div>
        </div>

        <!-- Stat cards -->
        <div class="stats-row">
          ${[
            { val: p.files.length, lbl: "Total Files", cls: "val-blue" },
            { val: v, lbl: "Valid", cls: "val-green" },
            { val: inv, lbl: "Invalid", cls: "val-red" },
            { val: u, lbl: "Unchecked", cls: "val-gray" },
          ]
            .map(
              (s) => `
            <div class="stat-card">
              <div class="stat-val ${s.cls}">${s.val}</div>
              <div class="stat-lbl">${s.lbl}</div>
            </div>`,
            )
            .join("")}
        </div>

        <!-- Files table -->
        <table>
          <thead>
            <tr>
              <th class="center" style="width:36px">#</th>
              <th>File Name</th>
              <th class="center" style="width:90px">Status</th>
              <th style="width:112px">Last Check</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>${fileRows}</tbody>
        </table>

        <!-- Page footer -->
        <div class="footer">
          <span>Generated: ${dateStr}</span>
          <span>${p.files.length} file${p.files.length !== 1 ? "s" : ""} in this project</span>
        </div>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>All Projects Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
    color: #1f2937;
    background: #fff;
  }

  /* ══ COVER PAGE ══════════════════════════════════════════════════════════ */
  .cover-page {
    padding: 40px 36px 32px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .cover-top {
    border-bottom: 2px solid #e5e7eb;
    padding-bottom: 18px;
    margin-bottom: 22px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
  }
  .cover-top h1 { font-size: 22px; font-weight: 800; color: #111827; margin-bottom: 4px; }
  .cover-top p  { font-size: 13px; color: #6b7280; }

  /* Global stat cards on cover */
  .global-stats {
    display: flex;
    gap: 10px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .g-stat {
    flex: 1; min-width: 90px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px 16px;
    text-align: center;
  }
  .g-stat .val { font-size: 22px; font-weight: 800; }
  .g-stat .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin-top: 3px; }

  .cover-section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: #6b7280;
    margin-bottom: 8px;
  }

  /* ══ PROJECT PAGES ════════════════════════════════════════════════════════ */
  .project-page { padding: 32px 36px 28px; }

  /* Header — same style as single-project report */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 14px;
    border-bottom: 1.5px solid #e5e7eb;
    margin-bottom: 18px;
    gap: 16px;
  }
  .header-left h1  { font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 2px; }
  .header-left p   { font-size: 13px; color: #6b7280; }
  .pg-num          { font-size: 11px; color: #9ca3af; margin-top: 4px; display: block; }

  /* Stat cards row */
  .stats-row {
    display: flex;
    gap: 10px;
    margin-bottom: 18px;
    flex-wrap: wrap;
  }
  .stat-card {
    flex: 1; min-width: 80px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 10px 14px;
    text-align: center;
  }
  .stat-val  { font-size: 20px; font-weight: 700; line-height: 1.1; }
  .stat-lbl  { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; margin-top: 2px; }
  .val-blue  { color: #2563eb; }
  .val-green { color: #15803d; }
  .val-red   { color: #b91c1c; }
  .val-gray  { color: #6b7280; }

  /* ══ SHARED TABLE STYLES ══════════════════════════════════════════════════ */
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead tr { background: #f9fafb; }
  th {
    padding: 8px 10px;
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: #9ca3af;
    border-bottom: 1.5px solid #e5e7eb;
    white-space: nowrap;
  }
  td {
    padding: 7px 10px;
    font-size: 12px;
    border-bottom: 1px solid #f3f4f6;
    color: #374151;
    vertical-align: middle;
  }
  tr:last-child td { border-bottom: none; }
  .center { text-align: center; }
  .muted  { color: #6b7280; }
  .mono   { font-family: 'Courier New', monospace; font-size: 12px; color: #111827; font-weight: 600; letter-spacing: .01em; }
  .desc   { font-size: 11px; max-width: 180px; }
  .url    { font-size: 11px; color: #6b7280; word-break: break-all; overflow-wrap: anywhere; }
  .empty  { text-align: center; padding: 24px; color: #9ca3af; font-style: italic; }

  /* ══ BADGE STYLES ════════════════════════════════════════════════════════ */
  .badge {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 500; white-space: nowrap;
  }
  .badge-row { display: flex; gap: 5px; flex-shrink: 0; align-items: center; }
  .bdg {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 9px; border-radius: 999px;
    font-size: 12px; font-weight: 500; border: 1px solid; white-space: nowrap;
  }
  .bdg-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .bdg-valid       { background:#f0fdf4; border-color:#86efac; color:#15803d; }
  .bdg-dot-valid   { background:#16a34a; }
  .bdg-invalid     { background:#fef2f2; border-color:#fca5a5; color:#b91c1c; }
  .bdg-dot-invalid { background:#dc2626; }
  .bdg-other       { background:#f9fafb; border-color:#e5e7eb; color:#6b7280; }
  .bdg-dot-other   { background:#9ca3af; }

  /* ══ FOOTER ══════════════════════════════════════════════════════════════ */
  .footer {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    font-size: 11px;
    color: #9ca3af;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>

<!-- ══ PAGE 1: COVER / SUMMARY ══════════════════════════════════════════════ -->
<div class="cover-page">

  <div class="cover-top">
    <div>
      <h1>All Projects — Validation Report</h1>
      <p>Generated: ${dateStr} &nbsp;·&nbsp; ${projects.length} project${projects.length !== 1 ? "s" : ""}</p>
    </div>
    <div class="badge-row">
      <span class="bdg bdg-valid"><span class="bdg-dot bdg-dot-valid"></span>${totalValid} Valid</span>
      <span class="bdg bdg-invalid"><span class="bdg-dot bdg-dot-invalid"></span>${totalInvalid} Invalid</span>
      ${totalUnchecked > 0 ? `<span class="bdg bdg-other"><span class="bdg-dot bdg-dot-other"></span>${totalUnchecked} Unchecked</span>` : ""}
    </div>
  </div>

  <!-- Global stat cards -->
  <div class="global-stats">
    <div class="g-stat"><div class="val" style="color:#2563eb">${projects.length}</div><div class="lbl">Projects</div></div>
    <div class="g-stat"><div class="val" style="color:#2563eb">${totalFiles}</div><div class="lbl">Total Files</div></div>
    <div class="g-stat"><div class="val" style="color:#15803d">${totalValid}</div><div class="lbl">Valid</div></div>
    <div class="g-stat"><div class="val" style="color:#b91c1c">${totalInvalid}</div><div class="lbl">Invalid</div></div>
    <div class="g-stat"><div class="val" style="color:#6b7280">${totalUnchecked}</div><div class="lbl">Unchecked</div></div>
  </div>

  <!-- Summary table -->
  <div class="cover-section-title">Project Overview</div>
  <table>
    <thead>
      <tr>
        <th>Project Name</th>
        <th>Description</th>
        <th class="center">Total</th>
        <th class="center">Valid</th>
        <th class="center">Invalid</th>
        <th class="center">Unchecked</th>
      </tr>
    </thead>
    <tbody>${summaryRows}</tbody>
  </table>

  <div class="footer">
    <span>Generated: ${dateStr}</span>
    <span>${projects.length} projects · ${totalFiles} files total</span>
  </div>

</div>

<!-- ══ PAGE 2+: PER-PROJECT PAGES ═══════════════════════════════════════════ -->
${projectPages}

</body>
</html>`;
}

/** GET /projects/report — all-projects PDF (default) or CSV. */
export async function reportAll(format: string): Promise<ReportOutput> {
  const projects = await projectRepo().find({ order: { name: "ASC" } });

  // Three queries total (projects, files, each file's latest history row) instead of one per file.
  const files = await fileRepo().find({
    select: ["id", "project_id", "file_name", "file_url", "last_check", "current_status"],
    order: { file_name: "ASC" },
  });
  const latest: Array<{ file_id: number; check_time: Date; file_status: string }> =
    files.length === 0
      ? []
      : await historyRepo()
          .createQueryBuilder("h")
          .select([
            "h.file_id AS file_id",
            "h.check_time AS check_time",
            "h.file_status AS file_status",
          ])
          .innerJoin(
            (qb) =>
              qb
                .select("x.file_id", "fid")
                .addSelect("MAX(x.check_time)", "mt")
                .from(CheckHistory, "x")
                .groupBy("x.file_id"),
            "last",
            "last.fid = h.file_id AND last.mt = h.check_time",
          )
          .getRawMany();
  const lastByFile = new Map(latest.map((h) => [Number(h.file_id), h]));

  const projectsWithFiles: ProjectWithFiles[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    files: files
      .filter((f) => f.project_id === project.id)
      .map((f): FileWithHistory => {
        const last = lastByFile.get(f.id);
        return {
          id: f.id,
          file_name: f.file_name,
          file_url: f.file_url,
          last_check: f.last_check,
          current_status: f.current_status,
          lastHistory: last ? { check_time: last.check_time, file_status: last.file_status } : null,
        };
      }),
  }));

  const generatedAt = new Date();
  const timestamp = generatedAt.toISOString().slice(0, 10);

  if (format === "csv") {
    return {
      contentType: "text/csv; charset=utf-8",
      filename: `Projects_${timestamp}.csv`,
      body: generateAllCSV(projectsWithFiles, generatedAt),
    };
  }

  const html = buildAllProjectsHTML(projectsWithFiles, generatedAt);
  const pdf = await htmlToPdf(html, { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" });
  return { contentType: "application/pdf", filename: `Projects_${timestamp}.pdf`, body: pdf };
}
