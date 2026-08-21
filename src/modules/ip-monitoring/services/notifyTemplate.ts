import type { NotifyPayload } from "@/shared/contracts/notification";

/**
 * ip-monitoring notification content. Rendered here (module owns its content) and handed to the
 * generic Central dispatcher via `@/shared/notify`.
 *
 * Mirrors the health-monitoring template, minus the HTTP status code — a TCP probe has no
 * response code, so the failure reason (refused / timeout / unreachable) carries the detail.
 */

export interface IpMonitorDownPayload {
  monitor_id: number;
  monitor_name: string;
  ip_address: string;
  port: number;
  message: string;
  checked_at: Date;
  fail_count: number;
}

const fmtTime = (d: Date) =>
  new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function emailHTML(p: IpMonitorDownPayload): string {
  const dashboardUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const target = `${p.ip_address}:${p.port}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;"><tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:24px 28px;border-radius:12px 12px 0 0;">
        <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.65);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">IP Monitoring</div>
        <div style="font-size:20px;font-weight:700;color:#fff;">Target Unreachable</div>
      </td></tr>
      <tr><td style="background:#fff;padding:28px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Monitor</div>
            <div style="font-size:14px;font-weight:600;color:#111827;">${p.monitor_name}</div></td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Target</div>
            <div style="font-size:13px;font-family:monospace;color:#111827;">${target}</div></td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Reason</div>
            <div style="font-size:14px;font-weight:600;color:#b91c1c;">${p.message}</div></td></tr>
          <tr><td style="padding:13px 16px;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Down Since</div>
            <div style="font-size:13px;color:#374151;">${fmtTime(p.checked_at)} · ${p.fail_count} consecutive failures</div></td></tr>
        </table>
        <div style="text-align:center;">
          <a href="${dashboardUrl}/ip-monitoring/monitors" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:13px;font-weight:600;">View Monitors →</a>
        </div>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:14px 28px;border-radius:0 0 12px 12px;border-top:1px solid #e5e7eb;text-align:center;">
        <div style="font-size:11px;color:#9ca3af;">Automated notification from IP Monitoring.</div></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function slackBlocks(p: IpMonitorDownPayload): unknown[] {
  const dashboardUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const target = `${p.ip_address}:${p.port}`;
  return [
    { type: "header", text: { type: "plain_text", text: "🔴 IP Target Unreachable", emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Monitor:*\n${p.monitor_name}` },
        { type: "mrkdwn", text: `*Target:*\n\`${target}\`` },
        { type: "mrkdwn", text: `*Reason:*\n${p.message}` },
        { type: "mrkdwn", text: `*Down Since:*\n${fmtTime(p.checked_at)}` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Monitors →" },
          url: `${dashboardUrl}/ip-monitoring/monitors`,
          style: "danger",
        },
      ],
    },
  ];
}

export function renderIpMonitorDown(p: IpMonitorDownPayload): NotifyPayload {
  return {
    subject: `IP Target Unreachable — ${p.monitor_name}`,
    html: emailHTML(p),
    slackBlocks: slackBlocks(p),
    text: `*IP Target Unreachable* — ${p.monitor_name} (${p.ip_address}:${p.port} — ${p.message})`,
  };
}
