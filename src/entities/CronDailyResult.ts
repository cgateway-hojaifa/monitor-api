import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from "typeorm";

/**
 * The result of one daily check for one monitor — the audit trail behind "did it run enough today".
 *
 * The daily task writes exactly one row per monitor per calendar day: the expected count, the
 * actual count of `cron_run` rows that day, and whether it passed (`actual >= expected`). Unique on
 * (monitor_id, day) so a re-run of the check on the same day upserts rather than duplicating.
 * `notified` records whether an under-run alert was dispatched, so a repeat check does not re-notify.
 */
@Index("cron_daily_result_monitor_day", ["monitor_id", "day"], { unique: true })
@Entity({ name: "cron_daily_result" })
export class CronDailyResult {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  id!: string;

  @Column({ type: "int", unsigned: true })
  monitor_id!: number;

  /** The calendar day this result covers (server TZ), stored as a DATE (no time component). */
  @Column({ type: "date" })
  day!: string;

  @Column({ type: "int", unsigned: true })
  expected!: number;

  @Column({ type: "int", unsigned: true })
  actual!: number;

  /** true when actual >= expected. */
  @Column({ type: "boolean" })
  passed!: boolean;

  /** true once an under-run notification has been dispatched for this row. */
  @Column({ type: "boolean", default: false })
  notified!: boolean;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;
}
