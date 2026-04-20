/**
 * Express application factory.
 *
 * Wires up middleware, routers, and the centralised error handler.
 * Keep this file free of "listen" / "connect" side effects — those
 * live in `server.js` so tests can import the app without booting a
 * socket or the database.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/error.middleware.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin / non-browser callers (no Origin header).
        if (!origin) return cb(null, true);
        if (env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());

  if (env.nodeEnv !== "test") {
    app.use(morgan(env.isProduction ? "combined" : "dev"));
  }

  // Liveness probe — safe to expose publicly.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", env: env.nodeEnv });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/chat", chatRoutes);

  // 404 + centralised error handler (order matters).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
