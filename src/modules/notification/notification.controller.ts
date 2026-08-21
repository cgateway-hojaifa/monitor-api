import type { Request, Response } from "express";
import httpStatus from "@/constants/httpStatus";
import catchAsync from "@/middleware/catchAsync";
import * as service from "@/modules/notification/notification.service";

export const listNotifications = catchAsync(async (req: Request, res: Response) => {
  const moduleFilter = typeof req.query.module === "string" ? req.query.module : undefined;
  const data = await service.listNotifications(moduleFilter);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const createNotification = catchAsync(async (req: Request, res: Response) => {
  const data = await service.createNotification(req.body);
  res.status(httpStatus.CREATED).json({ success: true, data });
});

export const getNotification = catchAsync(async (req: Request, res: Response) => {
  const data = await service.getNotification(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, data });
});

export const updateNotification = catchAsync(async (req: Request, res: Response) => {
  const data = await service.updateNotification(Number(req.params.id), req.body);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const deleteNotification = catchAsync(async (req: Request, res: Response) => {
  await service.deleteNotification(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, message: "Deleted." });
});
