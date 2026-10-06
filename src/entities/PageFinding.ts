import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from "typeorm";

export type FindingType = "HEADER_REMOVED" | "HEADER_CHANGED";

/** One detected change on a payment page: an expected header missing, or its value changed. */
@Entity({ name: "page_findings" })
export class PageFinding {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Index("page_findings_scan_id")
  @Column({ type: "int", unsigned: true })
  scan_id!: number;

  @Index("page_findings_project_id")
  @Column({ type: "int", unsigned: true })
  project_id!: number;

  @Column({ type: "enum", enum: ["HEADER_REMOVED", "HEADER_CHANGED"] })
  type!: FindingType;

  @Column({ type: "varchar", length: 2048 })
  subject!: string;

  @Column({ type: "longtext", nullable: true, default: null })
  expected_value!: string | null;

  @Column({ type: "longtext", nullable: true, default: null })
  observed_value!: string | null;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;
}
