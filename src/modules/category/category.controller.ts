import type { Request, Response } from "express";
import httpStatus from "@/constants/httpStatus";
import catchAsync from "@/middleware/catchAsync";
import * as service from "@/modules/category/category.service";

// ── Collection ────────────────────────────────────────────────────────────────
export const listCategories = catchAsync(async (req: Request, res: Response) => {
  const data = await service.listCategories(req.query);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const createCategory = catchAsync(async (req: Request, res: Response) => {
  const data = await service.createCategory(req.body);
  res.status(httpStatus.CREATED).json({ success: true, data });
});

// ── Item ──────────────────────────────────────────────────────────────────────
export const getCategory = catchAsync(async (req: Request, res: Response) => {
  const data = await service.getCategory(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, data });
});

export const updateCategory = catchAsync(async (req: Request, res: Response) => {
  const data = await service.updateCategory(Number(req.params.id), req.body);
  res.status(httpStatus.OK).json({ success: true, data });
});

export const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  await service.deleteCategory(Number(req.params.id));
  res.status(httpStatus.OK).json({ success: true, message: "Category deleted." });
});
