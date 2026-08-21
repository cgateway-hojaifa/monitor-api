import type { Request, Response } from "express";
import httpStatus from "@/constants/httpStatus";
import catchAsync from "@/middleware/catchAsync";
import * as service from "@/modules/cron-monitoring/cron-monitoring.service";

// ── Ingest (PUSH, unauthenticated by session — keyed by X-Cron-Key) ──────────────
export const ingest = catchAsync(async (req: Request, res: Response) => {
  const key = req.header("X-Cron-Key") ?? "";
  const data = await service.ingestRun(key, req.body ?? {});
  res.status(httpStatus.CREATED).json({ success: true, data });
});

// ── Collection ────────────────────────────────────────────────────────────────
export const listMonitors = catchAsync(async (req: Request, res: Response) => {
  const { data, total, page, perPage, okCount, failCount } = await service.listMonitors(req.query);
  res
    .status(httpStatus.OK)
    .json({ success: true, data, total, page, perPage, okCount, failCount });
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

export const regenerateKey = catchAsync(async (req: Request, res: Response) => {
  const data = await service.regenerateKey(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, data });
});

// ── History ──────────────────────────────────────────────────────────────────────
export const runs = catchAsync(async (req: Request, res: Response) => {
  const data = await service.listRuns(Number(req.params.id), req.query.limit);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const dailyResults = catchAsync(async (req: Request, res: Response) => {
  const data = await service.listDailyResults(Number(req.params.id), req.query.limit);
  res.status(httpStatus.OK).json({ success: true, data });
});
