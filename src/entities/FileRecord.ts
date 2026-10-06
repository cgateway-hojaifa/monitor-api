import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export type FileStatus = "valid" | "invalid" | "error" | "unchecked";

@Entity({ name: "files" })
export class FileRecord {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "int", unsigned: true })
  project_id!: number;

  @Column({ type: "varchar", length: 255 })
  file_name!: string;

  @Column({ type: "longtext" })
  file_content!: string;

  @Column({ type: "varchar", length: 2048 })
  file_url!: string;

  @Column({ type: "datetime", nullable: true, default: null })
  last_check!: Date | null;

  /**
   * valid / invalid = the live file matched / differed from the baseline. `error` = the last check
   * could not fetch the file (host down, 404, timeout…) — not evidence of tampering.
   */
  @Column({ type: "enum", enum: ["valid", "invalid", "error", "unchecked"], default: "unchecked" })
  current_status!: FileStatus;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
