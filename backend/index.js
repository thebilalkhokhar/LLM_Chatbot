/**
 * Vercel entry. The local process still boots through src/server.js.
 * Vercel imports this file and serves the exported Express app.
 */
import { createApp } from "./src/app.js";

const app = createApp();

export default app;
