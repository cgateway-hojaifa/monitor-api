import config from "./config";

/**
 * Custom logger — ported from the base Express template (config/logger.js).
 * Colorized in development, plain in production. `debug` only emits in development.
 */
type Level = "debug" | "info" | "warn" | "error";

class CustomLogger {
  private env: string;
  private level: string;

  constructor(env?: string) {
    this.env = env || "development";
    this.level = this.env === "development" ? "debug" : "info";
  }

  private formatMessage(level: Level, message: string): string {
    const formattedMessage = `${level}: ${message}`;
    if (this.env === "development") {
      const color = this.getColor(level);
      return `${color(formattedMessage)}`;
    }
    return `${formattedMessage}`;
  }

  private getColor(level: Level): (msg: string) => string {
    const colors: Record<Level, (msg: string) => string> = {
      debug: (msg) => `\x1b[36m${msg}\x1b[0m`, // Cyan
      info: (msg) => `\x1b[32m${msg}\x1b[0m`, // Green
      warn: (msg) => `\x1b[33m${msg}\x1b[0m`, // Yellow
      error: (msg) => `\x1b[31m${msg}\x1b[0m`, // Red
    };
    return colors[level] || ((msg: string) => msg);
  }

  private logAt(level: Level, message: string, ...args: unknown[]): void {
    const formattedMessage = this.formatMessage(level, message);
    if (args.length) {
      console.log(formattedMessage, ...args);
    } else {
      console.log(formattedMessage);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level === "debug") this.logAt("debug", message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.logAt("info", message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.logAt("warn", message, ...args);
  }

  error(message: string | Error, ...args: unknown[]): void {
    if (message instanceof Error) {
      this.logAt("error", message.stack || message.message, ...args);
    } else {
      this.logAt("error", message, ...args);
    }
  }
}

const logger = new CustomLogger(config.env);

export default logger;
