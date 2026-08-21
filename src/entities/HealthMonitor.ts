import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

@Entity({ name: "health_monitoring" })
export class HealthMonitor {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "varchar", length: 150 })
  name!: string;

  @Column({ type: "varchar", length: 2048 })
  url!: string;

  @Column({ type: "enum", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], default: "GET" })
  method!: HttpMethod;

  @Column({ type: "text", nullable: true, default: null })
  request_headers!: string | null;

  @Column({ type: "text", nullable: true, default: null })
  request_body!: string | null;

  @Column({ type: "int", unsigned: true, default: 2 })
  fail_threshold!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  /** Optional category (`categories.id`). Null = uncategorized. Plain FK column, per convention. */
  @Index("health_monitoring_category_id")
  @Column({ type: "int", unsigned: true, nullable: true, default: null })
  category_id!: number | null;

  @Column({ type: "datetime", nullable: true, default: null })
  last_checked_at!: Date | null;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
