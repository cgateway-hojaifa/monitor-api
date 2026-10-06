import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from "typeorm";

@Entity({ name: "check_history" })
@Index("check_history_file_time", ["file_id", "check_time"])
export class CheckHistory {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "int", unsigned: true })
  file_id!: number;

  @Column({ type: "datetime" })
  check_time!: Date;

  @Column({ type: "enum", enum: ["valid", "invalid", "error"] })
  file_status!: "valid" | "invalid" | "error";

  /** Why an `error` check failed (e.g. "HTTP 404 Not Found", "Timeout"). Null for valid/invalid. */
  @Column({ type: "varchar", length: 500, nullable: true, default: null })
  message!: string | null;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;
}
