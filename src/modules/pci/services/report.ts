import { AppDataSource } from "@/config/data-source";
import { Project } from "@/entities/Project";
import { FileRecord } from "@/entities/FileRecord";
import { CheckHistory } from "@/entities/CheckHistory";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

/**
 * PCI report generation — single-project and all-projects reports, each renderable as PDF
 * (via puppeteer-core + @sparticuz/chromium) or CSV. HTML/CSV builders are pure; the service
 * functions gather data from repositories and return `{ contentType, filename, body }` so the
 * controller stays transport-only.
 */

const projectRepo = () => AppDataSource.getRepository(Project);
const fileRepo = () => AppDataSource.getRepository(FileRecord);
const historyRepo = () => AppDataSource.getRepository(CheckHistory);

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
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 800 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" as never });
  const pdfBuffer = await page.pdf({ format: "A4", printBackground: true, margin });
  await browser.close();
  return Buffer.from(pdfBuffer);
}

// ─── Single-project report ──────────────────────────────────────────────────

interface FileRow {
  id: number;
  file_name: string;
  file_url: string;
  last_check: string | null;
  current_status: "valid" | "invalid" | "unchecked";
}

interface ProjectType {
  id: number;
  name: string;
  description: string | null;
  files: FileRow[];
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
    return "color:#6b7280;background:#f9fafb;border:1px solid #e5e7eb;";
  };

  const statusLabel = (s: string) =>
    s === "valid" ? "✔ Valid" : s === "invalid" ? "✖ Invalid" : "? Unchecked";

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
    return "color:#6b7280;background:#f9fafb;border:1px solid #e5e7eb;";
  };
  const statusLabel = (s: string) =>
    s === "valid" ? "✔ Valid" : s === "invalid" ? "✖ Invalid" : "? Unchecked";

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

  const projectsWithFiles: ProjectWithFiles[] = await Promise.all(
    projects.map(async (project) => {
      const files = await fileRepo().find({
        where: { project_id: project.id },
        order: { file_name: "ASC" },
      });

      const filesWithHistory: FileWithHistory[] = await Promise.all(
        files.map(async (f) => {
          const last = await historyRepo().findOne({
            where: { file_id: f.id },
            order: { check_time: "DESC" },
          });
          return {
            id: f.id,
            file_name: f.file_name,
            file_url: f.file_url,
            last_check: f.last_check,
            current_status: f.current_status,
            lastHistory: last
              ? { check_time: last.check_time, file_status: last.file_status }
              : null,
          };
        }),
      );

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        files: filesWithHistory,
      };
    }),
  );

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
