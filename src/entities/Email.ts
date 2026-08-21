import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "emails" })
export class Email {
  @PrimaryGeneratedColumn({ type: "int", unsigned: true })
  id!: number;

  @Column({ type: "varchar", length: 100 })
  name!: string;

  @Index("emails_email_unique", { unique: true })
  @Column({ type: "varchar", length: 255 })
  email!: string;

  @CreateDateColumn({ type: "datetime", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", name: "updated_at" })
  updated_at!: Date;
}
