import path from "path";
import dotenv from "dotenv";
import Joi from "joi";

dotenv.config({ path: path.join(__dirname, "../../.env") });

// Extends the template's env schema with this app's keys (auth, cron, mail, cookies, scheduler).
// `.unknown()` keeps any extra vars (e.g. the legacy DB_*/NEXT_PUBLIC_* aliases) from failing.
const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid("production", "development", "test").required(),
    PORT: Joi.number().default(4000),

    MYSQL_HOST: Joi.string().required().description("MySQL host"),
    MYSQL_PORT: Joi.number().default(3306),
    MYSQL_USERNAME: Joi.string().required().description("MySQL username"),
    MYSQL_PASSWORD: Joi.string().allow("").required().description("MySQL password"),
    MYSQL_DATABASE: Joi.string().required().description("MySQL database name"),

    FRONTEND_ORIGIN: Joi.string().default("http://localhost:3000"),

    JWT_SECRET: Joi.string().required(),
    JWT_EXPIRES_IN: Joi.string().default("7d"),

    // Cron intervals (seconds). Optional — when unset (or empty), the corresponding cron is
    // disabled (no scheduled task registered), so no default is injected here.
    HEALTH_MONITORING_INTERVAL_SEC: Joi.number().allow("").optional(),
    PCI_INTERVAL_SEC: Joi.number().allow("").optional(),

    NEXT_PUBLIC_BASE_URL: Joi.string().required().description("Public base URL for links in notifications"),

    BREVO_API_KEY: Joi.string().allow("").optional(),
    BREVO_API_URL: Joi.string().default("https://api.brevo.com/v3/"),
    MAIL_FROM_NAME: Joi.string().default("Notifications"),
    MAIL_FROM_ADDRESS: Joi.string().default("noreply@example.com"),
    MAIL_BCC_ADDRESS: Joi.string().allow("").optional(),

    COOKIE_SAMESITE: Joi.string().valid("lax", "strict", "none").optional(),
    COOKIE_SECURE: Joi.string().valid("true", "false").optional(),
    COOKIE_DOMAIN: Joi.string().allow("").optional(),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema
  .prefs({ errors: { label: "key" } })
  .validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export default {
  env: envVars.NODE_ENV as string,
  port: envVars.PORT as number,

  frontendOrigin: envVars.FRONTEND_ORIGIN as string,

  mysql: {
    host: envVars.MYSQL_HOST as string,
    port: envVars.MYSQL_PORT as number,
    username: envVars.MYSQL_USERNAME as string,
    password: envVars.MYSQL_PASSWORD as string,
    database: envVars.MYSQL_DATABASE as string,
  },
};
