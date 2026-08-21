import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Cron monitor — a definition of a remote scheduled job we expect to run N times a day.
 *
 * PUSH model (opposite of the old poll design): the remote job reports each completed run by
 * POSTing to the ingest endpoint with this monitor's `cron_key` in a header. Every accepted POST
 * inserts one `cron_run` row. Once a day the daily check counts those rows and compares the count
 * to `expected_per_day`; an under-run fires a notification.
 *
 * `cron_key` is the shared secret that maps an inbound ping to this monitor. It is stored in
 * plaintext (re-viewable in the portal) and is unique so a lookup by key is unambiguous.
 */
@Entity({ name: "cron_monitor" })
export class CronMonitor {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "varchar", length: 150 })
  name!: string;

  /**
   * Auto-generated shared secret. Sent by the remote job as `X-Cron-Key` on every ingest POST;
   * an unknown key is rejected. Unique so key → monitor is 1:1.
   */
  @Index("cron_monitor_cron_key", { unique: true })
  @Column({ type: "varchar", length: 64 })
  cron_key!: string;

  /** Expected number of complete runs per calendar day. The daily check compares actual against this. */
  @Column({ type: "int", unsigned: true, default: 1 })
  expected_per_day!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  /** When the daily check last evaluated this monitor. Null until first checked. */
  @Column({ type: "datetime", nullable: true, default: null })
  last_checked_at!: Date | null;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
