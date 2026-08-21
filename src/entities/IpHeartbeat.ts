import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from "typeorm";

export type IpHeartbeatStatus = "up" | "down";

/**
 * One recorded TCP check against an IP monitor. Mirrors the HTTP `Heartbeat` shape minus
 * `status_code` (a TCP connect has no response code) — `ping_ms` is connect latency.
 */
@Entity({ name: "ip_monitoring_heartbeats" })
@Index(["monitor_id", "checked_at"])
export class IpHeartbeat {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  id!: string;

  @Column({ type: "int", unsigned: true })
  monitor_id!: number;

  @Column({ type: "enum", enum: ["up", "down"] })
  status!: IpHeartbeatStatus;

  /** TCP connect latency in ms; null when the attempt never produced a timing. */
  @Column({ type: "int", nullable: true, default: null })
  ping_ms!: number | null;

  @Column({ type: "varchar", length: 255, nullable: true, default: null })
  message!: string | null;

  @Column({ type: "datetime" })
  checked_at!: Date;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;
}
