import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from "typeorm";

export type PageScanResult = "clean" | "failed" | "error";

/**
 * One payment-page scan (PCI DSS 11.6.1). `snapshot_json` keeps everything the browser received
 * (final URL, status, headers) as evidence; findings live in `page_findings`.
 *
 * `scripts_found` / `scripts_expected` belong to the script-inventory check, which is switched off
 * (third-party script URLs change on every load and raised false alerts). They are kept so the
 * table matches the original PCI app's schema and stay 0 on new scans.
 */
@Entity({ name: "page_scans" })
@Index("page_scans_project_time", ["project_id", "scan_time"])
export class PageScan {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "int", unsigned: true })
  project_id!: number;

  @Column({ type: "datetime" })
  scan_time!: Date;

  @Column({ type: "enum", enum: ["clean", "failed", "error"] })
  result!: PageScanResult;

  @Column({ type: "int", unsigned: true, default: 0 })
  scripts_found!: number;

  @Column({ type: "int", unsigned: true, default: 0 })
  scripts_expected!: number;

  @Column({ type: "int", unsigned: true, default: 0 })
  findings_count!: number;

  @Column({ type: "longtext", nullable: true, default: null })
  snapshot_json!: string | null;

  @Column({ type: "text", nullable: true, default: null })
  error_message!: string | null;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;
}
