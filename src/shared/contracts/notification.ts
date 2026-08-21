/**
 * Cross-module notification contract.
 *
 * This file is the ONLY notification coupling point between modules. Feature modules
 * (e.g. PCI) import from here + `@/shared/notify` and never touch the Central module directly.
 * The Central Settings module implements `NotificationDispatcher` and registers it via
 * `registerDispatcher` (see `@/shared/notify`).
 */

/**
 * Identifies which module a notification belongs to — a module **slug** (`modules.slug`), or
 * `"global"`, which targets alerts from every module.
 *
 * Deliberately `string`, not a closed union: modules live in the DB and are added without code
 * changes, so a union here would need hand-editing for every new module. It didn't get edited —
 * `ip-monitoring` was missing from the notification service's copy of the list, which silently
 * dropped that scope on save. Validation happens at runtime instead, against the live `modules`
 * table (see `validModuleScopeKeys` in the module service).
 */
export type ModuleKey = string;

/** A fully-rendered, content-agnostic notification. */
export interface NotifyPayload {
  subject: string;
  html: string;
  slackBlocks?: unknown[];
  text: string;
}

/** A resolved delivery target (email address or slack webhook). */
export interface NotificationTarget {
  type: "email" | "slack";
  name: string;
  target: string;
  status: "active" | "inactive";
  modules: ModuleKey[];
}

/** Contract the Central module fulfils. */
export type NotificationDispatcher = (
  moduleKey: ModuleKey,
  payload: NotifyPayload,
) => Promise<void>;
