import type { Request, Response } from "express";
import httpStatus from "@/constants/httpStatus";
import catchAsync from "@/middleware/catchAsync";
import * as service from "@/modules/module/module.service";
import { userHasPermission } from "@/shared/permissions";
import { invalidateModuleCache } from "@/middleware/moduleGuard";

// ── Admin CRUD ──
export const listModules = catchAsync(async (_req: Request, res: Response) => {
  const data = await service.listModules();
  res.status(httpStatus.OK).json({ success: true, data });
});

export const getModule = catchAsync(async (req: Request, res: Response) => {
  const data = await service.getModule(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, data });
});

export const createModule = catchAsync(async (req: Request, res: Response) => {
  const data = await service.createModule(req.body);
  invalidateModuleCache();
  res.status(httpStatus.CREATED).json({ success: true, data });
});

export const updateModule = catchAsync(async (req: Request, res: Response) => {
  const data = await service.updateModule(Number(req.params.id), req.body);
  invalidateModuleCache();
  res.status(httpStatus.OK).json({ success: true, data });
});

export const deleteModule = catchAsync(async (req: Request, res: Response) => {
  await service.deleteModule(Number(req.params.id));
  invalidateModuleCache();
  res.status(httpStatus.OK).json({ success: true, message: "Deleted." });
});

// ── Module scopes (notification targeting, and anywhere else modules must be listed) ──
export const getModuleScopes = catchAsync(async (_req: Request, res: Response) => {
  const data = await service.listModuleScopes();
  res.status(httpStatus.OK).json({ success: true, data });
});

// ── Module schedules (topbar auto-check line) ──
export const getModuleSchedules = catchAsync(async (_req: Request, res: Response) => {
  const data = await service.listModuleSchedules();
  res.status(httpStatus.OK).json({ success: true, data });
});

// ── Navigation (sidebar) ──
export const getNav = catchAsync(async (req: Request, res: Response) => {
  // Permission filter: a module is shown only if the caller has all of its required permissions.
  const data = await service.buildNavTree((m) => userHasPermission(req, m.permissions));
  res.status(httpStatus.OK).json({ success: true, data });
});
