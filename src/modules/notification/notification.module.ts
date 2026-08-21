/**
 * Notification module manifest.
 *
 * Owns notification-target CRUD, and wires the notification dispatcher (sending logic in
 * `@/notifications/dispatch`) into the shared IoC slot at startup so feature modules can notify
 * without importing the dispatcher directly.
 */
import type { ModuleManifest } from "@/shared/registry";
import { registerDispatcher } from "@/shared/notify";
import { dispatch } from "@/notifications/dispatch";

export const notificationModule: ModuleManifest = {
  key: "notification",
  infra: true, // pure IoC wiring; no nav, no DB row — always inits
  init() {
    registerDispatcher(dispatch);
  },
};
