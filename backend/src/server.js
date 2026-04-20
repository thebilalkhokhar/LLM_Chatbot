/**
 * Server bootstrap.
 *
 * Responsibilities:
 *   1. Load env (side effect of importing `./config/env.js`).
 *   2. Connect to MongoDB.
 *   3. Start the HTTP server.
 *   4. Wire graceful-shutdown handlers.
 */

import http from "node:http";

import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { createApp } from "./app.js";

async function main() {
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[server] Listening on http://localhost:${env.port} (${env.nodeEnv})`
    );
  });

  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[server] ${signal} received — shutting down gracefully…`);
    server.close(async (err) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error("[server] Error while closing HTTP server:", err);
      }
      try {
        await disconnectDatabase();
      } catch (dbErr) {
        // eslint-disable-next-line no-console
        console.error("[server] Error while closing DB:", dbErr);
      }
      process.exit(err ? 1 : 0);
    });

    // Hard-exit safety net — 10s to drain, then kill.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    // eslint-disable-next-line no-console
    console.error("[server] Unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    // eslint-disable-next-line no-console
    console.error("[server] Uncaught exception:", error);
    shutdown("uncaughtException");
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[server] Fatal error during startup:", error);
  process.exit(1);
});
