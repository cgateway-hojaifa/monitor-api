import "reflect-metadata";
import { DataSource } from "typeorm";
import config from "./config";
import logger from "./logger";

import { User } from "@/entities/User";
import { Notification } from "@/entities/Notification";
import { CronLog } from "@/entities/CronLog";
import { HealthMonitor } from "@/entities/HealthMonitor";
import { Heartbeat } from "@/entities/Heartbeat";
import { Project } from "@/entities/Project";
import { FileRecord } from "@/entities/FileRecord";
import { CheckHistory } from "@/entities/CheckHistory";
import { Email } from "@/entities/Email";
import { Module } from "@/entities/Module";
import { Category } from "@/entities/Category";
import { IpMonitor } from "@/entities/IpMonitor";
import { IpHeartbeat } from "@/entities/IpHeartbeat";
import { CronMonitor } from "@/entities/CronMonitor";
import { CronRun } from "@/entities/CronRun";
import { CronDailyResult } from "@/entities/CronDailyResult";

/**
 * TypeORM DataSource — replaces the template's mysql2 pool (config/db.js) and Sequelize.
 *
 * `synchronize: true` makes the entities the source of truth for schema (mirrors the old
 * Sequelize sync). Entities are mapped 1:1 to the existing tables so this is a no-op on
 * current data; watch the boot log for any ALTER on first run.
 */
export const AppDataSource = new DataSource({
  type: "mysql",
  host: config.mysql.host,
  port: config.mysql.port,
  username: config.mysql.username,
  password: config.mysql.password,
  database: config.mysql.database,
  synchronize: true,
  logging: config.env === "development" ? ["error", "schema"] : ["error"],
  entities: [
    User,
    Notification,
    CronLog,
    HealthMonitor,
    Heartbeat,
    Project,
    FileRecord,
    CheckHistory,
    Email,
    Module,
    Category,
    IpMonitor,
    IpHeartbeat,
    CronMonitor,
    CronRun,
    CronDailyResult,
  ],
});

let initialized = false;

/** Idempotent initializer used at boot (index.ts) and lazily by services if needed. */
export async function initDataSource(): Promise<DataSource> {
  if (initialized) return AppDataSource;
  await AppDataSource.initialize();
  initialized = true;
  logger.info("TypeORM DataSource initialized.");
  return AppDataSource;
}
