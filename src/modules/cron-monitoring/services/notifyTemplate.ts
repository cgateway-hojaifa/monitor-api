import type { NotifyPayload } from "@/shared/contracts/notification";

/**
 * cron-monitoring notification content. Rendered here (module owns its content) and handed to the
 * generic Central dispatcher via `@/shared/notify`.
 *
 * Fires from the daily check when a monitored cron job under-ran — it reported fewer complete runs
 * than its `expected_per_day`.
 */

export interface CronUnderranPayload {
  monitor_id: number;
  monitor_name: string;
  expected: number;
  actual: number;
  day: string;
}

function emailHTML(p: CronUnderranPayload): string {
  const dashboardUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const missed = p.expected - p.actual;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;"><tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#d97706,#b45309);padding:24px 28px;border-radius:12px 12px 0 0;">
        <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.65);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Cron Monitoring</div>
        <div style="font-size:20px;font-weight:700;color:#fff;">Cron Job Under-ran</div>
      </td></tr>
      <tr><td style="background:#fff;padding:28px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Monitor</div>
            <div style="font-size:14px;font-weight:600;color:#111827;">${p.monitor_name}</div></td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Day</div>
            <div style="font-size:13px;color:#111827;">${p.day}</div></td></tr>
          <tr><td style="padding:13px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;">Runs</div>
            <div style="font-size:14px;font-weight:600;color:#b45309;">${p.actual} of ${p.expected} expected (${missed} missed)</div></td></tr>
        </table>
        <div style="text-align:center;">
          <a href="${dashboardUrl}/cron-monitoring/monitors/${p.monitor_id}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:13px;font-weight:600;">View Monitor →</a>
        </div>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:14px 28px;border-radius:0 0 12px 12px;border-top:1px solid #e5e7eb;text-align:center;">
        <div style="font-size:11px;color:#9ca3af;">Automated notification from Cron Monitoring.</div></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function slackBlocks(p: CronUnderranPayload): unknown[] {
  const dashboardUrl = process.env.NEXT_PUBLIC_BASE_URL;
  return [
    { type: "header", text: { type: "plain_text", text: "🟠 Cron Job Under-ran", emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Monitor:*\n${p.monitor_name}` },
        { type: "mrkdwn", text: `*Day:*\n${p.day}` },
        { type: "mrkdwn", text: `*Runs:*\n${p.actual} of ${p.expected} expected` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Monitor →" },
          url: `${dashboardUrl}/cron-monitoring/monitors/${p.monitor_id}`,
          style: "primary",
        },
      ],
    },
  ];
}

export function renderCronUnderran(p: CronUnderranPayload): NotifyPayload {
  return {
    subject: `Cron Job Under-ran — ${p.monitor_name} (${p.actual}/${p.expected})`,
    html: emailHTML(p),
    slackBlocks: slackBlocks(p),
    text: `*Cron Job Under-ran* — ${p.monitor_name}: ran ${p.actual} of ${p.expected} expected on ${p.day}.`,
  };
}
