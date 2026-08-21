import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity({ name: "cron_logs" })
export class CronLog {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "varchar", length: 100 })
  module!: string;

  @Column({ type: "enum", enum: ["schedule", "manual"], default: "schedule" })
  trigger!: "schedule" | "manual";

  @Column({ type: "enum", enum: ["running", "success", "error"], default: "running" })
  status!: "running" | "success" | "error";

  @Column({ type: "datetime" })
  started_at!: Date;

  @Column({ type: "datetime", nullable: true, default: null })
  finished_at!: Date | null;

  @Column({ type: "int", unsigned: true, nullable: true, default: null })
  duration_ms!: number | null;

  @Column({ type: "varchar", length: 500, nullable: true, default: null })
  message!: string | null;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;
}
