/**
 * Express application factory.
 *
 * Wires up middleware, routers, and the centralised error handler.
 * Listening stays in `server.js`. Database connect is lazy so a Vercel
 * cold start can serve `/health` without opening Mongo first.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import { env } from "./config/env.js";
import { connectDatabase } from "./config/database.js";
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

  // The UI is hosted on a different origin, so the API must be readable
  // cross-origin. Helmet's default CORP of `same-origin` blocks that.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

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

  // After CORS so a browser preflight is answered even if Mongo is down.
  app.use(async (req, res, next) => {
    if (req.path === "/health" || req.method === "OPTIONS") return next();
    try {
      await connectDatabase();
      next();
    } catch (error) {
      next(error);
    }
  });

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

// Vercel loads this module and requires the Express app as the default export.
const app = createApp();
export default app;
