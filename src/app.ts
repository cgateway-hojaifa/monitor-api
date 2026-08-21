import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";

import config from "@/config/config";
import { errorConverter, errorHandler } from "@/middleware/error";
import httpStatus from "@/constants/httpStatus";
import ApiError from "@/utils/ApiError";
import logRequest from "@/middleware/logRequest";
import { authGate } from "@/middleware/authGate";
import cronIngestRoute from "@/modules/cron-monitoring/cron-ingest.route";
import routes from "@/routes";

const app = express();

// access logging
app.use(logRequest);

// security HTTP headers
app.use(helmet());

// parse cookies (auth_token / setup_required_token are httpOnly cookies)
app.use(cookieParser());

// parse json request body (5mb — file_content payloads for PCI)
app.use(express.json({ limit: "5mb" }));

// parse urlencoded request body
app.use(express.urlencoded({ extended: true }));

// gzip compression
app.use(compression());

// Credentialed CORS: explicit origin (a wildcard is illegal with credentials) so the browser
// sends and accepts the httpOnly auth cookie cross-origin.
app.use(cors({ origin: config.frontendOrigin, credentials: true }));

// Cron Monitoring PUSH ingest. Mounted at the app root — deliberately OUTSIDE the `/api` auth
// gate — because a remote job reports its runs server-to-server with its own credential
// (X-Cron-Key header), not the app's session cookie. The key is validated in the service.
app.use("/cron-ingest", cronIngestRoute);

// API auth gate (ported from the old Next middleware's API branch) runs before all /api routes.
app.use("/api", authGate);

// module routes
app.use("/api", routes);

// send back a 404 error for any unknown api request
app.use((_req, _res, next) => {
  next(new ApiError(httpStatus.NOT_FOUND, "Not found"));
});

// convert error to ApiError, if needed
app.use(errorConverter);

// handle error
app.use(errorHandler);

export default app;
