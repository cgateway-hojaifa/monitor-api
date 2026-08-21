import { Router } from "express";
import * as controller from "@/modules/cron-monitoring/cron-monitoring.controller";
import * as schema from "@/modules/cron-monitoring/cron-monitoring.validation";
import validate from "@/middleware/validate";

/**
 * PUSH ingest endpoint for remote cron jobs. Mounted at the app root, OUTSIDE the `/api` session
 * auth gate — a remote job authenticates server-to-server with its own `X-Cron-Key` header, not
 * the portal's session cookie. The key is the credential; an unknown key is rejected in the service.
 *
 * Deliberately NOT behind `moduleGuard`: ingest must keep working regardless of whether the module
 * is toggled active in the portal. (Only the daily *evaluation* is gated by module status, via the
 * scheduler registry.)
 */
const router = Router();

router.post("/", validate(schema.ingest), controller.ingest);

export default router;
