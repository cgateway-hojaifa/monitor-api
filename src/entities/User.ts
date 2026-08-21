import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "users" })
export class User {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  // Named unique index (matches the legacy Sequelize `users_email_unique`) to avoid
  // duplicate-index churn under schema sync.
  @Index("users_email_unique", { unique: true })
  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ type: "varchar", length: 255 })
  password!: string;

  @Column({ type: "varchar", length: 100, default: "" })
  name!: string;

  @Column({ type: "varchar", length: 255, nullable: true, default: null })
  totp_secret!: string | null;

  @Column({ type: "boolean", default: false })
  totp_enabled!: boolean;

  @Column({ type: "text", nullable: true, default: null })
  recovery_codes!: string | null;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
