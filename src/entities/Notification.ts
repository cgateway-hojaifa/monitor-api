import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import type { ModuleKey } from "@/shared/contracts/notification";

@Entity({ name: "notifications" })
export class Notification {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "enum", enum: ["email", "slack"] })
  type!: "email" | "slack";

  @Column({ type: "varchar", length: 150 })
  name!: string;

  @Column({ type: "varchar", length: 500 })
  target!: string;

  @Column({ type: "enum", enum: ["active", "inactive"], default: "active" })
  status!: "active" | "inactive";

  /** Legacy single-scope column, kept for backfill of pre-migration rows. */
  @Column({ type: "varchar", length: 50, nullable: true, default: null })
  module!: ModuleKey | null;

  /** Module scopes this target serves (JSON array). `"global"` = every module. */
  @Column({ type: "json" })
  modules!: ModuleKey[];

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
