import type { Request, Response, NextFunction } from "express";
import logger from "@/config/logger";

/** Per-request access log — ported from the base Express template (middleware/logRequest.js). */

function getIpFormat(req: Request): string {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || req.ip;
  return `${ip} - `;
}

function getDeviceType(req: Request): string {
  const userAgent = req.headers["user-agent"] || "";
  if (/mobile/i.test(userAgent)) return "Mobile App";
  if (/iPad|Android|Touch/i.test(userAgent)) return "Tablet";
  return "Web Browser";
}

function getElapsedTime(startTime: [number, number]): string {
  const diff = process.hrtime(startTime);
  return (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(3); // ms
}

export default function logRequest(req: Request, res: Response, next: NextFunction): void {
  const startTime = process.hrtime();
  const deviceType = getDeviceType(req);

  res.on("finish", () => {
    const elapsedTime = getElapsedTime(startTime);
    const status = res.statusCode;
    const message = (res.locals.errorMessage as string) || "";
    const ipFormat = getIpFormat(req);

    const logMessage = `${ipFormat}${req.method} ${req.originalUrl} ${status} - ${elapsedTime} ms - Device: ${deviceType}`;

    if (status < 400) {
      logger.info(logMessage);
    } else {
      logger.error(`${logMessage} - message: ${message}`);
    }
  });

  next();
}
