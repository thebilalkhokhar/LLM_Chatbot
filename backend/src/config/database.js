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

let connectPromise = null;
let listenersBound = false;

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;

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

export function connectDatabase() {
  if (!env.mongoUri) {
    return Promise.reject(new Error("MONGO_URI is not set."));
  }
  if (mongoose.connection.readyState === 1) {
    return Promise.resolve(mongoose.connection);
  }
  if (connectPromise) return connectPromise;

  bindListeners();
  connectPromise = mongoose
    .connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 })
    .then((connection) => {
      // eslint-disable-next-line no-console
      console.log(
        `[db] MongoDB connected: ${connection.connection.host}/${connection.connection.name}`
      );
      return connection;
    })
    .catch((error) => {
      connectPromise = null;
      // eslint-disable-next-line no-console
      console.error("[db] MongoDB connection failed:", error.message);
      throw error;
    });

  return connectPromise;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
