import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export type ScanStatus = "clean" | "failed" | "error" | "unscanned";

/** One expected HTTP response header on the payment page (name stored lowercase). */
export interface ExpectedHeader {
  name: string;
  value: string;
}

/** Parse a project's `expected_headers` JSON, tolerating malformed stored values. */
export function parseExpectedHeaders(raw: string | null): ExpectedHeader[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((h) => h && typeof h.name === "string")
      .map((h) => ({ name: String(h.name).toLowerCase(), value: String(h.value ?? "") }));
  } catch {
    return [];
  }
}

@Entity({ name: "projects" })
export class Project {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "varchar", length: 150 })
  name!: string;

  @Column({ type: "text", nullable: true, default: null })
  description!: string | null;

  /** Optional category (`categories.id`, shared with the monitors). Null = uncategorized. */
  @Index("projects_category_id")
  @Column({ type: "int", unsigned: true, nullable: true, default: null })
  category_id!: number | null;

  // ── PCI DSS 11.6.1 — payment page monitoring ──

  /** Payment page checked by the page scan (http/https only). Null = page monitoring off. */
  @Column({ type: "varchar", length: 2048, nullable: true, default: null })
  page_url!: string | null;

  /** JSON array of `ExpectedHeader` — the response headers each scan checks. Null = none. */
  @Column({ type: "longtext", nullable: true, default: null })
  expected_headers!: string | null;

  @Column({ type: "datetime", nullable: true, default: null })
  last_scan!: Date | null;

  @Column({
    type: "enum",
    enum: ["clean", "failed", "error", "unscanned"],
    default: "unscanned",
  })
  scan_status!: ScanStatus;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
