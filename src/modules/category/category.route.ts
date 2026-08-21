import { Router } from "express";
import * as categoryController from "@/modules/category/category.controller";
import * as schema from "@/modules/category/category.validation";
import validate from "@/middleware/validate";

const router = Router();

// Collection
router.get("/", validate(schema.listCategories), categoryController.listCategories);
router.post("/", validate(schema.createCategory), categoryController.createCategory);

// Item
router.get("/:id", validate(schema.getCategory), categoryController.getCategory);
router.put("/:id", validate(schema.updateCategory), categoryController.updateCategory);
router.delete("/:id", validate(schema.deleteCategory), categoryController.deleteCategory);

export default router;
