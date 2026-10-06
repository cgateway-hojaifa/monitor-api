import type { NotifyPayload } from "@/shared/contracts/notification";

/**
 * PCI-owned notification content. The email HTML + Slack blocks are PCI domain content, so
 * they live inside the PCI module. The rendered `NotifyPayload` is handed to the generic
 * Central dispatcher via `@/lib/notify` — keeping Central content-agnostic.
 */

export interface ValidationFailedPayload {
  file_id: number;
  file_name: string;
  file_url: string;
  project_name: string;
  check_time: Date;
}

const fmtTime = (d: Date) =>
  new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function generateEmailHTML(p: ValidationFailedPayload): string {
  const { file_name, file_url, project_name, check_time } = p;
  const dashboardUrl = process.env.NEXT_PUBLIC_BASE_URL;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr><td style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:24px 28px;border-radius:12px 12px 0 0;">
          <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.65);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Script Discovery and Inventory</div>
          <div style="font-size:20px;font-weight:700;color:#fff;">Validation Failed</div>
        </td></tr>
        <tr><td style="background:#fff;padding:28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
            <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
              <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Project</div>
              <div style="font-size:14px;font-weight:600;color:#111827;">${esc(project_name)}</div>
            </td></tr>
            <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
              <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">File</div>
              <div style="font-size:14px;font-weight:600;color:#111827;font-family:monospace;">${esc(file_name)}</div>
            </td></tr>
            <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
              <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">URL</div>
              <a href="${esc(file_url)}" style="font-size:12px;color:#4f46e5;word-break:break-all;text-decoration:none;">${esc(file_url)}</a>
            </td></tr>
            <tr><td style="padding:13px 16px;">
              <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Checked At</div>
              <div style="font-size:13px;color:#374151;">${fmtTime(check_time)}</div>
            </td></tr>
          </table>
          <div style="text-align:center;">
            <a href="${dashboardUrl}/pci/files/${p.file_id}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:13px;font-weight:600;">
              View in Dashboard →
            </a>
          </div>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:14px 28px;border-radius:0 0 12px 12px;border-top:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:11px;color:#9ca3af;">Automated notification from Script Discovery and Inventory.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function generateSlackBlocks(p: ValidationFailedPayload): unknown[] {
  const dashboardUrl = process.env.NEXT_PUBLIC_BASE_URL;
  return [
    { type: "header", text: { type: "plain_text", text: "Validation Failed", emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Project:*\n${p.project_name}` },
        { type: "mrkdwn", text: `*File:*\n\`${p.file_name}\`` },
        { type: "mrkdwn", text: `*URL:*\n<${p.file_url}|${p.file_url}>` },
        { type: "mrkdwn", text: `*Checked At:*\n${fmtTime(p.check_time)}` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Dashboard →" },
          url: `${dashboardUrl}/pci/files/${p.file_id}`,
          style: "danger",
        },
      ],
    },
  ];
}

/** Render a PCI "validation failed" event into a content-agnostic NotifyPayload. */
export function renderValidationFailed(p: ValidationFailedPayload): NotifyPayload {
  return {
    subject: `Validation Failed — ${p.file_name}`,
    html: generateEmailHTML(p),
    slackBlocks: generateSlackBlocks(p),
    text: `*Validation Failed* — ${p.file_name}`,
  };
}

// ── PCI DSS 11.6.1 — payment page scan alert ─────────────────────────────────────

export interface PageScanFailedPayload {
  project_id: number;
  project_name: string;
  page_url: string;
  scan_time: Date;
  findings: Array<{
    type: string;
    subject: string;
    expected_value: string | null;
    observed_value: string | null;
  }>;
}

const FINDING_LABEL: Record<string, string> = {
  HEADER_REMOVED: "Security header removed",
  HEADER_CHANGED: "Security header changed",
};

/** Header values come from a remote server, so every interpolated value is escaped. */
function esc(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pageScanEmailHTML(p: PageScanFailedPayload): string {
  const dashboardUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const findingRows = p.findings
    .map(
      (f) => `
    <tr><td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;vertical-align:top;">
      <div style="font-size:12px;font-weight:600;color:#111827;margin-bottom:3px;">${esc(FINDING_LABEL[f.type] || f.type)}</div>
      <div style="font-size:11px;color:#4b5563;font-family:monospace;word-break:break-all;">${esc(f.subject)}</div>
      ${f.expected_value ? `<div style="font-size:10px;color:#6b7280;margin-top:4px;"><b>Expected:</b> ${esc(f.expected_value.slice(0, 300))}</div>` : ""}
      ${f.observed_value ? `<div style="font-size:10px;color:#6b7280;margin-top:2px;"><b>Found:</b> ${esc(f.observed_value.slice(0, 300))}</div>` : ""}
    </td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;"><tr><td align="center">
    <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:24px 28px;border-radius:12px 12px 0 0;">
        <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.65);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Security Header Check</div>
        <div style="font-size:20px;font-weight:700;color:#fff;">Security Headers Changed on Your Web Page</div>
      </td></tr>
      <tr><td style="background:#fff;padding:28px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:22px;">
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Project</div>
            <div style="font-size:14px;font-weight:600;color:#111827;">${esc(p.project_name)}</div></td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Web Page</div>
            <a href="${esc(p.page_url)}" style="font-size:12px;color:#4f46e5;word-break:break-all;text-decoration:none;">${esc(p.page_url)}</a></td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Headers Changed</div>
            <div style="font-size:14px;font-weight:600;color:#111827;">${p.findings.length}</div></td></tr>
          <tr><td style="padding:13px 16px;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Checked At</div>
            <div style="font-size:13px;color:#374151;">${fmtTime(p.scan_time)}</div></td></tr>
        </table>
        <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px;">Which Headers Changed</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">${findingRows}</table>
        <div style="text-align:center;">
          <a href="${dashboardUrl}/pci/projects/${p.project_id}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:13px;font-weight:600;">View in Dashboard &rarr;</a>
        </div>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:14px 28px;border-radius:0 0 12px 12px;border-top:1px solid #e5e7eb;text-align:center;">
        <div style="font-size:11px;color:#9ca3af;">Automated notification from Script Discovery and Inventory.</div></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function pageScanSlackBlocks(p: PageScanFailedPayload): unknown[] {
  const dashboardUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const lines = p.findings
    .slice(0, 15)
    .map((f) => `• *${FINDING_LABEL[f.type] || f.type}* — \`${f.subject}\``)
    .join("\n");
  const overflow = p.findings.length > 15 ? `\n_…and ${p.findings.length - 15} more._` : "";
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Security Headers Changed on Your Web Page", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Project:*\n${p.project_name}` },
        { type: "mrkdwn", text: `*Web Page:*\n<${p.page_url}|${p.page_url}>` },
        { type: "mrkdwn", text: `*Headers Changed:*\n${p.findings.length}` },
        { type: "mrkdwn", text: `*Checked At:*\n${fmtTime(p.scan_time)}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Which headers changed:*\n${lines}${overflow}` },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Dashboard →" },
          url: `${dashboardUrl}/pci/projects/${p.project_id}`,
          style: "danger",
        },
      ],
    },
  ];
}

/** Render a failed payment-page scan into a content-agnostic NotifyPayload. */
export function renderPageScanFailed(p: PageScanFailedPayload): NotifyPayload {
  return {
    subject: `Security headers changed on your web page — ${p.project_name}`,
    html: pageScanEmailHTML(p),
    slackBlocks: pageScanSlackBlocks(p),
    text: `*Security headers changed on your web page* — ${p.project_name}`,
  };
}

// ── Check could not run (file fetch failed / page scan errored) ──────────────────

export interface CheckErrorPayload {
  /** "file" = a file integrity check; "page" = a payment-page scan. */
  kind: "file" | "page";
  /** File name, or the project name for a page scan. */
  subject: string;
  project_name: string;
  url: string;
  error: string;
  check_time: Date;
  /** Dashboard path to open, e.g. "/pci/files/12". */
  path: string;
}

function checkErrorEmailHTML(p: CheckErrorPayload): string {
  const dashboardUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const what = p.kind === "file" ? "File" : "Web Page";
  const row = (label: string, value: string, mono = false) => `
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">${label}</div>
            <div style="font-size:13px;font-weight:600;color:#111827;word-break:break-all;${mono ? "font-family:monospace;" : ""}">${value}</div></td></tr>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;"><tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#d97706,#b45309);padding:24px 28px;border-radius:12px 12px 0 0;">
        <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.65);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Script Discovery and Inventory</div>
        <div style="font-size:20px;font-weight:700;color:#fff;">We Couldn't Check Your ${what}</div>
      </td></tr>
      <tr><td style="background:#fff;padding:28px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
          ${row("Project", esc(p.project_name))}
          ${p.kind === "file" ? row("File", esc(p.subject), true) : ""}
          ${row("URL", esc(p.url), true)}
          ${row("Error", esc(p.error))}
          ${row("Checked At", fmtTime(p.check_time))}
        </table>
        <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0 0 20px;">We couldn't open this ${what.toLowerCase()}, so we couldn't tell whether ${p.kind === "file" ? "its content" : "its security headers"} changed. This doesn't necessarily mean anything is wrong. We'll try again at the next scheduled check.</p>
        <div style="text-align:center;">
          <a href="${dashboardUrl}${p.path}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:13px;font-weight:600;">View in Dashboard &rarr;</a>
        </div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** Render "a check could not run" into a NotifyPayload (sent once when a target starts failing). */
export function renderCheckError(p: CheckErrorPayload): NotifyPayload {
  const what = p.kind === "file" ? "File" : "Web Page";
  const dashboardUrl = process.env.NEXT_PUBLIC_BASE_URL;
  return {
    subject: `We couldn't check your ${what.toLowerCase()} — ${p.subject}`,
    html: checkErrorEmailHTML(p),
    slackBlocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `We Couldn't Check Your ${what}`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Project:*\n${p.project_name}` },
          {
            type: "mrkdwn",
            text: `*${p.kind === "file" ? "File" : "Page"}:*\n${p.kind === "file" ? p.subject : p.url}`,
          },
          { type: "mrkdwn", text: `*Error:*\n${p.error}` },
          { type: "mrkdwn", text: `*Checked At:*\n${fmtTime(p.check_time)}` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View in Dashboard →" },
            url: `${dashboardUrl}${p.path}`,
          },
        ],
      },
    ],
    text: `*We couldn't check your ${what.toLowerCase()}* — ${p.subject}: ${p.error}`,
  };
}
