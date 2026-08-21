import type { Request, Response } from "express";
import httpStatus from "@/constants/httpStatus";
import catchAsync from "@/middleware/catchAsync";
import * as service from "@/modules/ip-monitoring/ip-monitoring.service";

// ── Manual check (all) ────────────────────────────────────────────────────────
export const checkAll = catchAsync(async (_req: Request, res: Response) => {
  const { processed, data } = await service.checkAll();
  res.status(httpStatus.OK).json({ success: true, processed, data });
});

// ── Collection ────────────────────────────────────────────────────────────────
export const listMonitors = catchAsync(async (req: Request, res: Response) => {
  const { data, total, page, perPage, upCount, downCount } = await service.listMonitors(req.query);
  res.status(httpStatus.OK).json({ success: true, data, total, page, perPage, upCount, downCount });
});

export const createMonitor = catchAsync(async (req: Request, res: Response) => {
  const data = await service.createMonitor(req.body);
  res.status(httpStatus.CREATED).json({ success: true, data });
});

// ── Item ──────────────────────────────────────────────────────────────────────
export const getMonitor = catchAsync(async (req: Request, res: Response) => {
  const data = await service.getMonitor(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, data });
});

export const updateMonitor = catchAsync(async (req: Request, res: Response) => {
  const data = await service.updateMonitor(Number(req.params.id), req.body);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const deleteMonitor = catchAsync(async (req: Request, res: Response) => {
  await service.deleteMonitor(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, message: "Monitor deleted." });
});

// ── Manual check (one) ────────────────────────────────────────────────────────
export const checkOne = catchAsync(async (req: Request, res: Response) => {
  const data = await service.checkOne(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, data });
});

// ── Heartbeats ────────────────────────────────────────────────────────────────
export const heartbeats = catchAsync(async (req: Request, res: Response) => {
  const data = await service.listHeartbeats(Number(req.params.id), req.query.limit);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const clearHeartbeats = catchAsync(async (req: Request, res: Response) => {
  const removed = await service.clearHeartbeats(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, message: "Heartbeats cleared.", removed });
});
