import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity({ name: "check_history" })
export class CheckHistory {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "int", unsigned: true })
  file_id!: number;

  @Column({ type: "datetime" })
  check_time!: Date;

  @Column({ type: "enum", enum: ["valid", "invalid", "error"] })
  file_status!: "valid" | "invalid" | "error";

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;
}
