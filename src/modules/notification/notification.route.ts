import express from "express";
import * as notificationController from "@/modules/notification/notification.controller";
import * as schema from "@/modules/notification/notification.validation";
import validate from "@/middleware/validate";

const router = express.Router();

// Mounted at /api/notifications
router
  .route("/")
  .get(validate(schema.listNotifications), notificationController.listNotifications)
  .post(validate(schema.createNotification), notificationController.createNotification);
router
  .route("/:id")
  .get(validate(schema.getNotification), notificationController.getNotification)
  .put(validate(schema.updateNotification), notificationController.updateNotification)
  .delete(validate(schema.deleteNotification), notificationController.deleteNotification);

export default router;
