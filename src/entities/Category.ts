import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Monitor category — a user-managed label for grouping health monitors.
 *
 * Scoped to the Health Monitoring module: a monitor carries an optional `category_id`, and the
 * monitor list can filter by it. Following the codebase convention, the link is a plain FK column
 * on `health_monitoring` (not a TypeORM relation).
 */
@Entity({ name: "categories" })
export class Category {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  /** Display label. Unique (case-insensitive under the table's default collation). */
  @Index("categories_name_unique", { unique: true })
  @Column({ type: "varchar", length: 100 })
  name!: string;

  @Column({ type: "varchar", length: 500, nullable: true, default: null })
  description!: string | null;

  /** Hex swatch (e.g. "#2563eb") shown as the category pill colour. Null = neutral. */
  @Column({ type: "varchar", length: 7, nullable: true, default: null })
  color!: string | null;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
