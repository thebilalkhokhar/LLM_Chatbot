/**
 * Environment variable loader.
 *
 * Reads ./backend/.env once at startup and exposes a typed, validated
 * `env` object. Missing critical variables cause a hard exit so we never
 * silently boot with broken config.
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "../../.env");

dotenv.config({ path: ENV_PATH });

const REQUIRED_KEYS = [
  "MONGO_URI",
  "ACCESS_TOKEN_SECRET",
  "REFRESH_TOKEN_SECRET",
];

const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);
if (missing.length) {
  // eslint-disable-next-line no-console
  console.error(
    `[config] Missing required env vars: ${missing.join(", ")}\n` +
      `         Populate them in backend/.env (see .env.example).`
  );
  process.exit(1);
}

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
};

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: toInt(process.env.PORT, 4000),

  corsOrigins,

  mongoUri: process.env.MONGO_URI,

  jwt: {
    accessSecret: process.env.ACCESS_TOKEN_SECRET,
    refreshSecret: process.env.REFRESH_TOKEN_SECRET,
    accessExpiry: process.env.ACCESS_TOKEN_EXPIRY ?? "15m",
    refreshExpiry: process.env.REFRESH_TOKEN_EXPIRY ?? "7d",
  },

  cookie: {
    secure: toBool(process.env.COOKIE_SECURE, false),
    sameSite: (process.env.COOKIE_SAMESITE ?? "strict").toLowerCase(),
  },

  aiService: {
    url: (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(
      /\/+$/,
      ""
    ),
    timeoutMs: toInt(process.env.AI_SERVICE_TIMEOUT_MS, 60000),
    retries: toInt(process.env.AI_SERVICE_RETRIES, 3),
    retryDelayMs: toInt(process.env.AI_SERVICE_RETRY_DELAY_MS, 500),
  },
});
