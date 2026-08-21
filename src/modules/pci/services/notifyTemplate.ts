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
              <div style="font-size:14px;font-weight:600;color:#111827;">${project_name}</div>
            </td></tr>
            <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
              <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">File</div>
              <div style="font-size:14px;font-weight:600;color:#111827;font-family:monospace;">${file_name}</div>
            </td></tr>
            <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
              <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">URL</div>
              <a href="${file_url}" style="font-size:12px;color:#4f46e5;word-break:break-all;text-decoration:none;">${file_url}</a>
            </td></tr>
            <tr><td style="padding:13px 16px;">
              <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Checked At</div>
              <div style="font-size:13px;color:#374151;">${fmtTime(check_time)}</div>
            </td></tr>
          </table>
          <div style="text-align:center;">
            <a href="${dashboardUrl}/pci/files" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:13px;font-weight:600;">
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
          url: `${dashboardUrl}/pci/files`,
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
