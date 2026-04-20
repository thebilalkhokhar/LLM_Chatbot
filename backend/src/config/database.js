/**
 * MongoDB connection helper.
 *
 * Exposes `connectDatabase()` which resolves once Mongoose is connected,
 * and wires up the most useful lifecycle listeners so ops don't have to
 * dig through logs.
 */

import mongoose from "mongoose";
import { env } from "./env.js";

mongoose.set("strictQuery", true);

export async function connectDatabase() {
  try {
    const connection = await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10_000,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[db] MongoDB connected: ${connection.connection.host}/${connection.connection.name}`
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[db] MongoDB connection failed:", error.message);
    throw error;
  }

  mongoose.connection.on("disconnected", () => {
    // eslint-disable-next-line no-console
    console.warn("[db] MongoDB disconnected.");
  });

  mongoose.connection.on("reconnected", () => {
    // eslint-disable-next-line no-console
    console.log("[db] MongoDB reconnected.");
  });

  mongoose.connection.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[db] MongoDB error:", err.message);
  });
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
