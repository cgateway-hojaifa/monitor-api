import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * IP monitor — a TCP reachability target (`ip_address:port`), e.g. 46.232.248.109:8443.
 *
 * Deliberately separate from `health_monitoring` (HTTP monitors): these are never run by the
 * in-process scheduler. The module registers no scheduled task, so a check only happens when
 * someone triggers one from the UI. Keeping the tables apart means the HTTP cron runner can
 * never pick these rows up by accident.
 */
@Entity({ name: "ip_monitoring" })
export class IpMonitor {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "varchar", length: 150 })
  name!: string;

  /** IPv4/IPv6 literal or hostname. Stored as given; resolved at check time. */
  @Column({ type: "varchar", length: 255 })
  ip_address!: string;

  @Column({ type: "int", unsigned: true })
  port!: number;

  /** Connect timeout for a single check, in milliseconds. */
  @Column({ type: "int", unsigned: true, default: 5000 })
  timeout_ms!: number;

  /** Consecutive Down checks required before a notification fires. */
  @Column({ type: "int", unsigned: true, default: 2 })
  fail_threshold!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  /** Optional category (`categories.id`). Null = uncategorized. Plain FK column, per convention. */
  @Index("ip_monitoring_category_id")
  @Column({ type: "int", unsigned: true, nullable: true, default: null })
  category_id!: number | null;

  @Column({ type: "datetime", nullable: true, default: null })
  last_checked_at!: Date | null;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
