import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from "typeorm";

export type HeartbeatStatus = "up" | "down";

@Entity({ name: "health_monitoring_heartbeats" })
@Index(["monitor_id", "checked_at"])
export class Heartbeat {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  id!: string;

  @Column({ type: "int", unsigned: true })
  monitor_id!: number;

  @Column({ type: "enum", enum: ["up", "down"] })
  status!: HeartbeatStatus;

  @Column({ type: "int", nullable: true, default: null })
  status_code!: number | null;

  @Column({ type: "int", nullable: true, default: null })
  ping_ms!: number | null;

  @Column({ type: "varchar", length: 255, nullable: true, default: null })
  message!: string | null;

  @Column({ type: "datetime" })
  checked_at!: Date;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;
}
