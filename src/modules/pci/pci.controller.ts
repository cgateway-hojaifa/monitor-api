import type { Request, Response } from "express";
import httpStatus from "@/constants/httpStatus";
import catchAsync from "@/middleware/catchAsync";
import ApiError from "@/utils/ApiError";
import * as service from "@/modules/pci/pci.service";
import { reportOne, reportAll } from "@/modules/pci/services/report";
import { runWithLog } from "@/shared/cron";

// ── Projects ──
export const listProjects = catchAsync(async (_req: Request, res: Response) => {
  const data = await service.listProjects();
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

// ── Files ──
export const listFiles = catchAsync(async (req: Request, res: Response) => {
  const projectId = typeof req.query.project_id === "string" ? req.query.project_id : undefined;
  const data = await service.listFiles(projectId);
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
  const fileId = typeof req.query.file_id === "string" ? req.query.file_id : undefined;
  const data = await service.listCheckHistory(fileId, req.query.limit);
  res.status(httpStatus.OK).json({ success: true, data });
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
  res.status(httpStatus.OK).json({ success: true, message: "DB connected and synced." });
});

// ── Manual run (session-authenticated; behind authGate's default session-token branch) ──
// The dashboard "Run" button triggers this. Auth is the logged-in user's session cookie — the PCI
// file-check batch is the same one the in-process scheduler runs every PCI_INTERVAL_SEC.
export const runManual = catchAsync(async (_req: Request, res: Response) => {
  const batch = await runWithLog("pci", "manual", service.runAllFileChecks);
  res.status(httpStatus.OK).json({ success: true, timestamp: new Date().toISOString(), ...batch });
});
