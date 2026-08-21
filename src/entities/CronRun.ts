import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from "typeorm";

/**
 * One completed cron run. The job POSTs once, after finishing, with its `start_time` and `end_time`.
 * Each row is one completed cycle — the daily count is simply how many rows landed in the day,
 * bucketed by the row's `received_at` (our server clock).
 */
@Index("cron_run_monitor_received", ["monitor_id", "received_at"])
@Entity({ name: "cron_run" })
export class CronRun {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  id!: string;

  /** Parent monitor (which cron job this run belongs to). */
  @Column({ type: "int", unsigned: true })
  monitor_id!: number;

  /** When the run started, as reported by the job. */
  @Column({ type: "datetime" })
  start_time!: Date;

  /** When the run finished, as reported by the job. */
  @Column({ type: "datetime" })
  end_time!: Date;

  /** Opaque JSON payload from the job. Stored verbatim, no schema enforced. Null when omitted. */
  @Column({ type: "json", nullable: true })
  data!: unknown;

  /** Server clock when this run was received. Used for ordering + bucketing the day. */
  @Column({ type: "datetime" })
  received_at!: Date;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;
}
