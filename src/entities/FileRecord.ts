import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

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

  @Column({ type: "enum", enum: ["valid", "invalid", "unchecked"], default: "unchecked" })
  current_status!: "valid" | "invalid" | "unchecked";

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
