import axios from "axios";
import https from "https";
import { getActiveTargets } from "@/notifications/store";
import type { ModuleKey, NotifyPayload, NotificationTarget } from "@/shared/contracts/notification";

/**
 * Notification dispatcher — the delivery side of the sending logic. Registered into the
 * `@/shared/notify` IoC slot at startup (by the notification module manifest), so feature modules
 * call `notifyModule(...)` without importing this directly.
 */

// Reuse TLS connections across sends so a burst of notifications doesn't open (and drop) a
// fresh handshake per email — the cause of "socket disconnected before secure TLS" under load.
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

/** Retry transient network failures (TLS drops/resets/timeouts) with backoff; never retry HTTP responses. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if ((err as { response?: unknown })?.response) throw err;
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

// ── Transports ────────────────────────────────────────────────────────────────

async function sendEmail(to: string, name: string, payload: NotifyPayload): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const apiURL = (process.env.BREVO_API_URL || "https://api.brevo.com/v3/") + "smtp/email";
  const fromEmail = process.env.MAIL_FROM_ADDRESS || "noreply@example.com";
  const fromName = process.env.MAIL_FROM_NAME || "Notifications";
  const bccEmail = process.env.MAIL_BCC_ADDRESS;

  if (!apiKey) {
    console.warn("[Email] BREVO_API_KEY not set — skipping.");
    return;
  }

  await withRetry(() =>
    axios.post(
      apiURL,
      {
        sender: { name: fromName, email: fromEmail },
        to: [{ name, email: to }],
        ...(bccEmail ? { bcc: [{ email: bccEmail }] } : {}),
        subject: payload.subject,
        htmlContent: payload.html,
      },
      {
        headers: { "api-key": apiKey, "Content-Type": "application/json" },
        timeout: 15_000,
        httpsAgent: keepAliveAgent,
      },
    ),
  );

  console.log(`[Email] Sent to ${to}`);
}

async function sendSlack(webhookUrl: string, payload: NotifyPayload): Promise<void> {
  await withRetry(() =>
    axios.post(
      webhookUrl,
      {
        text: payload.text,
        ...(payload.slackBlocks ? { blocks: payload.slackBlocks } : {}),
      },
      { timeout: 15_000, httpsAgent: keepAliveAgent },
    ),
  );
  console.log(`[Slack] Notification sent`);
}

// ── Dispatcher (implements NotificationDispatcher) ────────────────────────────

/** Resolve active targets for `moduleKey` (∪ global) and deliver; per-target failures isolated. */
export async function dispatch(moduleKey: ModuleKey, payload: NotifyPayload): Promise<void> {
  const targets: NotificationTarget[] = await getActiveTargets(moduleKey);

  if (targets.length === 0) {
    console.log(`[Notify] No active targets for module '${moduleKey}' — skipping.`);
    return;
  }

  const tasks = targets.map((t) => {
    if (t.type === "email") {
      return sendEmail(t.target, t.name, payload).catch((err) =>
        console.error(`[Email] Failed (${t.name}):`, err?.response?.data || err?.message),
      );
    }
    if (t.type === "slack") {
      return sendSlack(t.target, payload).catch((err) =>
        console.error(`[Slack] Failed (${t.name}):`, err?.response?.data || err?.message),
      );
    }
    return Promise.resolve();
  });

  await Promise.allSettled(tasks);
}
