import type { Request, Response, NextFunction } from "express";
import { QueryFailedError } from "typeorm";
import httpStatus from "@/constants/httpStatus";
import config from "@/config/config";
import ApiError from "@/utils/ApiError";
import logger from "@/config/logger";

type MysqlDriverError = { code?: string; sqlMessage?: string; sql?: string };

/** Map a raw MySQL driver error code to (statusCode, message). Ported from the template. */
function mapMysqlError(code: string): { statusCode: number; message: string } {
  switch (code) {
    case "ER_DUP_ENTRY":
      return { statusCode: httpStatus.CONFLICT, message: "Duplicate entry" };
    case "ER_BAD_NULL_ERROR":
      return { statusCode: httpStatus.BAD_REQUEST, message: "Missing required field(s)" };
    case "ER_NO_REFERENCED_ROW_2":
      return { statusCode: httpStatus.BAD_REQUEST, message: "Foreign key constraint fails" };
    case "ER_PARSE_ERROR":
      return { statusCode: httpStatus.BAD_REQUEST, message: "SQL syntax error" };
    default:
      return { statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Database error" };
  }
}

/** Convert non-ApiError errors (incl. TypeORM/MySQL errors) into ApiError. */
export function errorConverter(
  err: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  let error: ApiError;

  if (err instanceof ApiError) {
    error = err;
  } else {
    const raw = (err ?? {}) as MysqlDriverError & {
      statusCode?: number;
      message?: string;
      stack?: string;
    };
    let statusCode = raw.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
    let message = raw.message || String(statusCode);

    // TypeORM wraps DB errors in QueryFailedError; the raw mysql2 error is on `driverError`.
    const driver: MysqlDriverError | undefined =
      err instanceof QueryFailedError
        ? (err as unknown as { driverError?: MysqlDriverError }).driverError
        : raw.code && raw.sqlMessage
          ? raw
          : undefined;

    if (driver?.code && driver?.sqlMessage) {
      logger.error("MySQL Error:");
      logger.error(
        JSON.stringify({ code: driver.code, sqlMessage: driver.sqlMessage, sql: driver.sql }),
      );
      ({ statusCode, message } = mapMysqlError(driver.code));
    }

    error = new ApiError(statusCode, message, false, raw.stack);
  }

  next(error);
}

/** Final error responder. Renders `{ code, message, stack? }` (template shape). */
export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  let { statusCode, message } = err;

  if (config.env === "production" && !err.isOperational) {
    statusCode = httpStatus.INTERNAL_SERVER_ERROR;
    message = String(httpStatus.INTERNAL_SERVER_ERROR);
  }

  res.locals.errorMessage = err.message;

  const response = {
    code: statusCode,
    message,
    ...(config.env === "development" && { stack: err.stack }),
  };

  if (config.env === "development") {
    logger.error(err);
  }

  res.status(statusCode).send(response);
}
