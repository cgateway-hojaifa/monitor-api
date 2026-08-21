/**
 * Notification facade (inversion of control).
 *
 * Feature modules call `notifyModule(...)`. The delivery implementation lives in the Central
 * module and is injected at startup via `registerDispatcher(...)`. Keeps `shared/` free of any
 * `modules/` import — arrows point module → shared, never the reverse.
 */
import type {
  ModuleKey,
  NotifyPayload,
  NotificationDispatcher,
} from "@/shared/contracts/notification";

let dispatcher: NotificationDispatcher | null = null;

export function registerDispatcher(fn: NotificationDispatcher): void {
  dispatcher = fn;
}

export async function notifyModule(moduleKey: ModuleKey, payload: NotifyPayload): Promise<void> {
  if (!dispatcher) {
    console.warn(`[Notify] No dispatcher registered — dropping ${moduleKey} notification.`);
    return;
  }
  await dispatcher(moduleKey, payload);
}
