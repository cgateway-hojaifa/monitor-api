import type { Request, Response } from "express";
import httpStatus from "@/constants/httpStatus";
import catchAsync from "@/middleware/catchAsync";
import ApiError from "@/utils/ApiError";
import * as service from "@/modules/pci/pci.service";
import { reportOne, reportAll } from "@/modules/pci/services/report";
import { startManualBatch, batchStatus, BatchBusyError } from "@/modules/pci/services/batch";

// ── Projects ──
export const listProjects = catchAsync(async (req: Request, res: Response) => {
  const data = await service.listProjects(req.query.category_id);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const createProject = catchAsync(async (req: Request, res: Response) => {
  const data = await service.createProject(req.body);
  res.status(httpStatus.CREATED).json({ success: true, data });
});

export const getProject = catchAsync(async (req: Request, res: Response) => {
  const data = await service.getProject(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, data });
});

export const updateProject = catchAsync(async (req: Request, res: Response) => {
  const data = await service.updateProject(Number(req.params.id), req.body);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const deleteProject = catchAsync(async (req: Request, res: Response) => {
  await service.deleteProject(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, message: "Project deleted." });
});

// ── Payment page scans (PCI DSS 11.6.1) ──
export const scanProject = catchAsync(async (req: Request, res: Response) => {
  const data = await service.scanProject(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, data });
});

export const listProjectScans = catchAsync(async (req: Request, res: Response) => {
  const result = await service.listProjectScans(Number(req.params.id), req.query);
  res.status(httpStatus.OK).json({ success: true, ...result });
});

export const listPageScans = catchAsync(async (req: Request, res: Response) => {
  const result = await service.listPageScans(req.query);
  res.status(httpStatus.OK).json({ success: true, ...result });
});

// ── Files ──
export const listFileOptions = catchAsync(async (req: Request, res: Response) => {
  const data = await service.listFileOptions(req.query.project_id);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const listFiles = catchAsync(async (req: Request, res: Response) => {
  // `validate` has already coerced project_id to a number (it is not a string here).
  const data = await service.listFiles(req.query.project_id);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const createFile = catchAsync(async (req: Request, res: Response) => {
  const data = await service.createFile(req.body);
  res.status(httpStatus.CREATED).json({ success: true, data });
});

export const getFile = catchAsync(async (req: Request, res: Response) => {
  const data = await service.getFile(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, data });
});

export const updateFile = catchAsync(async (req: Request, res: Response) => {
  const data = await service.updateFile(Number(req.params.id), req.body);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const deleteFile = catchAsync(async (req: Request, res: Response) => {
  await service.deleteFile(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, message: "File deleted." });
});

/** POST /files/check — 422 on fetch error (handled via ApiError in service). */
export const checkFile = catchAsync(async (req: Request, res: Response) => {
  const result = await service.checkFile(req.body?.id);
  res.status(httpStatus.OK).json({ success: true, ...result });
});

// ── Emails ──
export const listEmails = catchAsync(async (_req: Request, res: Response) => {
  const data = await service.listEmails();
  res.status(httpStatus.OK).json({ success: true, data });
});

export const createEmail = catchAsync(async (req: Request, res: Response) => {
  const data = await service.createEmail(req.body);
  res.status(httpStatus.CREATED).json({ success: true, data });
});

export const getEmail = catchAsync(async (req: Request, res: Response) => {
  const data = await service.getEmail(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, data });
});

export const updateEmail = catchAsync(async (req: Request, res: Response) => {
  const data = await service.updateEmail(Number(req.params.id), req.body);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const deleteEmail = catchAsync(async (req: Request, res: Response) => {
  await service.deleteEmail(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, message: "Deleted." });
});

// ── Check history ──
export const listCheckHistory = catchAsync(async (req: Request, res: Response) => {
  const result = await service.listCheckHistory(req.query);
  res.status(httpStatus.OK).json({ success: true, ...result });
});

// ── Reports ──
export const reportProject = catchAsync(async (req: Request, res: Response) => {
  const format = typeof req.query.format === "string" ? req.query.format : "pdf";
  const out = await reportOne(Number(req.params.id), format);
  if (!out) throw new ApiError(httpStatus.NOT_FOUND, "Project not found.");
  res.status(httpStatus.OK);
  res.setHeader("Content-Type", out.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.send(out.body);
});

export const reportProjects = catchAsync(async (req: Request, res: Response) => {
  const format = typeof req.query.format === "string" ? req.query.format : "pdf";
  const out = await reportAll(format);
  res.status(httpStatus.OK);
  res.setHeader("Content-Type", out.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.send(out.body);
});

// ── Health ──
export const health = catchAsync(async (_req: Request, res: Response) => {
  await service.health();
  res.status(httpStatus.OK).json({ success: true, message: "Database reachable." });
});

// ── Manual run (session-authenticated; the dashboard / Check History "Run" button) ──
// Starts the PCI batch in the background and answers 202 at once; the UI polls GET /run/status.
// One batch at a time: 409 while a run (manual or scheduled) is in progress.
export const runManual = catchAsync(async (_req: Request, res: Response) => {
  try {
    const status = startManualBatch();
    res.status(httpStatus.ACCEPTED).json({ success: true, ...status });
  } catch (err) {
    if (err instanceof BatchBusyError) throw new ApiError(httpStatus.CONFLICT, err.message);
    throw err;
  }
});

export const runStatus = catchAsync(async (_req: Request, res: Response) => {
  res.status(httpStatus.OK).json({ success: true, ...batchStatus() });
});
