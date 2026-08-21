import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export type ModuleStatus = "active" | "inactive";

/**
 * Module metadata — the single source of truth for the app's module system.
 *
 * A self-referencing tree (`parent_id`): a parent with `route = null` is a nav *section*; its
 * children are the nav links. Everything here is metadata (nav, ordering, nesting, visibility,
 * status, permissions, config, flags, deps) — the module's actual behavior (scheduled jobs, API
 * handlers, React pages) is code, mapped to this row by `slug`.
 *
 * Following the codebase convention, `parent_id` is a plain FK column (not a TypeORM relation).
 */
@Entity({ name: "modules" })
export class Module {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  /** Internal name. */
  @Column({ type: "varchar", length: 100 })
  name!: string;

  /** Human-facing label shown in the UI. */
  @Column({ type: "varchar", length: 150 })
  display_name!: string;

  /** Stable key; maps a row to its (code-defined) behavior + used in URLs. Unique. */
  @Index("modules_slug_unique", { unique: true })
  @Column({ type: "varchar", length: 100 })
  slug!: string;

  @Column({ type: "varchar", length: 500, nullable: true, default: null })
  description!: string | null;

  /** Icon NAME (e.g. "MdFolder"); the frontend maps it to a react-icons component. */
  @Column({ type: "varchar", length: 64, nullable: true, default: null })
  icon!: string | null;

  /** Nav/link route (e.g. "/pci/projects"). Null for section-only parents. */
  @Column({ type: "varchar", length: 255, nullable: true, default: null })
  route!: string | null;

  /** Sort order within siblings. */
  @Column({ type: "int", default: 0 })
  menu_order!: number;

  /** Parent module id (self-FK). Null = top-level section. */
  @Column({ type: "int", unsigned: true, nullable: true, default: null })
  parent_id!: number | null;

  @Column({ type: "enum", enum: ["active", "inactive"], default: "active" })
  status!: ModuleStatus;

  /** Shown in navigation. `false` = module runs but is hidden from the sidebar. */
  @Column({ type: "boolean", default: true })
  visible!: boolean;

  /** Permission slugs required to see/use this module. Empty = open to any authenticated user. */
  @Column({ type: "json" })
  permissions!: string[];

  /** Arbitrary per-module configuration. */
  @Column({ type: "json" })
  config!: Record<string, unknown>;

  /** Feature flags: `{ flagName: boolean }`. */
  @Column({ type: "json" })
  feature_flags!: Record<string, boolean>;

  /** Slugs of modules that must be active for this one to function. */
  @Column({ type: "json" })
  dependencies!: string[];

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
