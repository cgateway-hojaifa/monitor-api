import type { Request, Response } from "express";
import httpStatus from "@/constants/httpStatus";
import catchAsync from "@/middleware/catchAsync";
import * as service from "@/modules/cron/cron.service";

export const listCronLogs = catchAsync(async (req: Request, res: Response) => {
  const moduleFilter = typeof req.query.module === "string" ? req.query.module : undefined;
  const result = await service.listCronLogs({
    module: moduleFilter,
    page: req.query.page,
    perPage: req.query.perPage,
  });
  res.status(httpStatus.OK).json({ success: true, ...result });
});

/** Distinct modules present in the logs — drives the filter buttons. */
export const listCronLogModules = catchAsync(async (_req: Request, res: Response) => {
  const data = await service.listCronLogModules();
  res.status(httpStatus.OK).json({ success: true, data });
});
