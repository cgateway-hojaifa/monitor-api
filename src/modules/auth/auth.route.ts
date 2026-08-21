import { Router } from "express";
import * as authController from "@/modules/auth/auth.controller";
import * as schema from "@/modules/auth/auth.validation";
import validate from "@/middleware/validate";

const router = Router();

router.post("/login", validate(schema.login), authController.login);
router.post("/logout", validate(schema.logout), authController.logout);

router.post("/2fa/verify", validate(schema.verify2fa), authController.verify2fa);
router.post("/2fa/setup", validate(schema.setup2fa), authController.setup2fa);
router.post("/2fa/disable", validate(schema.disable2fa), authController.disable2fa);
router.post("/2fa/recover", validate(schema.recover2fa), authController.recover2fa);
router.post(
  "/2fa/regenerate-codes",
  validate(schema.regenerateCodes),
  authController.regenerateCodes,
);
router.post(
  "/2fa/set-setup-cookie",
  validate(schema.setSetupCookie),
  authController.setSetupCookie,
);
router.get("/2fa/get-setup-token", validate(schema.getSetupToken), authController.getSetupToken);
router.post(
  "/2fa/clear-setup-cookie",
  validate(schema.clearSetupCookie),
  authController.clearSetupCookie,
);

export default router;
