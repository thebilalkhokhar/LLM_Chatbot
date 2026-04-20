/**
 * Chat controller.
 *
 * Responsibilities:
 *   - Persist the user's message on the Chat document.
 *   - Forward the conversation to the Python AI service via the bridge.
 *   - Stream Gemini's tokens back to the frontend over SSE as they arrive.
 *   - On stream completion, persist the fully assembled assistant message.
 *
 * Wire protocol (SSE events sent to the frontend):
 *   event: start
 *   data: { provider, model }
 *
 *   event: token
 *   data: { delta: "…" }
 *
 *   event: done
 *   data: { chatId, messageId, reply, provider, model, next_step }
 *
 *   event: error
 *   data: { message, code }
 */

import { Readable } from "node:stream";

import { Chat } from "../models/chat.model.js";
import { env } from "../config/env.js";
import {
  MESSAGE_ROLES,
  SSE_EVENTS,
} from "../config/constants.js";
import {
  generateAIResponse,
  mapMessagesToPython,
  streamAIResponse,
} from "../services/ai.service.js";
import { ApiError } from "../utils/ApiError.js";

const DEFAULT_CHAT_TITLE_MAX = 60;

function deriveTitle(content) {
  if (typeof content !== "string" || !content.trim()) return "New Chat";
  const text = content.trim().replace(/\s+/g, " ");
  return text.length <= DEFAULT_CHAT_TITLE_MAX
    ? text
    : `${text.slice(0, DEFAULT_CHAT_TITLE_MAX - 1).trimEnd()}…`;
}

function assertMessagePayload(body) {
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    throw ApiError.badRequest("Request body must include a non-empty `content`.");
  }
  const context =
    body.context && typeof body.context === "object" && !Array.isArray(body.context)
      ? body.context
      : {};
  const chatId = typeof body.chatId === "string" ? body.chatId : null;
  const pdfId =
    typeof body.pdf_id === "string"
      ? body.pdf_id
      : typeof context.pdf_id === "string"
        ? context.pdf_id
        : null;
  return { content, context, chatId, pdfId };
}

async function loadOrCreateChat({ chatId, userId, firstMessageContent, pdfId }) {
  if (chatId) {
    const existing = await Chat.findOne({ _id: chatId, userId });
    if (!existing) {
      throw ApiError.notFound("Chat not found.", { code: "CHAT_NOT_FOUND" });
    }
    if (pdfId && existing.active_pdf_id !== pdfId) {
      existing.active_pdf_id = pdfId;
    }
    return existing;
  }
  return Chat.create({
    userId,
    title: deriveTitle(firstMessageContent),
    active_pdf_id: pdfId,
    messages: [],
  });
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/chat
 *
 * Body:
 *   {
 *     content: "...",         // required — user message
 *     chatId?: "...",         // optional — continue an existing chat
 *     pdf_id?: "...",         // optional — override active PDF
 *     context?: { pdf_id? }   // optional — Python-compatible context
 *   }
 *
 * Response: `text/event-stream`
 */
export async function sendMessage(req, res) {
  const { content, context, chatId, pdfId } = assertMessagePayload(req.body ?? {});

  const chat = await loadOrCreateChat({
    chatId,
    userId: req.user._id,
    firstMessageContent: content,
    pdfId,
  });

  const userMessage = {
    role: MESSAGE_ROLES.USER,
    content,
    context: { ...context, ...(pdfId ? { pdf_id: pdfId } : {}) },
  };
  chat.messages.push(userMessage);
  await chat.save();

  // SSE preamble
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let upstream;
  try {
    upstream = await streamAIResponse({
      messages: chat.messages,
      context: userMessage.context,
      activePdfId: chat.active_pdf_id,
    });
  } catch (error) {
    writeSse(res, SSE_EVENTS.ERROR, {
      message: error?.message ?? "AI service failed.",
      code: error?.code ?? "AI_SERVICE_ERROR",
      statusCode: error?.statusCode ?? 502,
    });
    res.end();
    return;
  }

  // If the frontend goes away mid-stream, drop the upstream too so
  // we don't keep generating tokens into the void.
  const abortUpstream = () => {
    try {
      upstream.stream?.destroy?.();
    } catch {
      /* noop */
    }
  };
  req.on("close", abortUpstream);

  let assembledReply = "";
  let provider = null;
  let model = null;
  let nextStep = null;
  let receivedError = false;

  try {
    for await (const chunk of upstream) {
      if (chunk?.event === "start") {
        provider = chunk.provider ?? provider;
        model = chunk.model ?? model;
        writeSse(res, SSE_EVENTS.START, { provider, model });
        continue;
      }

      if (typeof chunk?.token === "string") {
        assembledReply += chunk.token;
        writeSse(res, SSE_EVENTS.TOKEN, { delta: chunk.token });
        continue;
      }

      if (chunk?.event === "done") {
        nextStep = chunk.next_step ?? null;
        continue;
      }

      if (chunk?.event === "error") {
        receivedError = true;
        writeSse(res, SSE_EVENTS.ERROR, {
          message: chunk.message ?? "AI service failed mid-stream.",
          code: "AI_SERVICE_STREAM_ERROR",
          statusCode: 502,
        });
        break;
      }
    }
  } catch (error) {
    receivedError = true;
    writeSse(res, SSE_EVENTS.ERROR, {
      message: error?.message ?? "AI stream interrupted.",
      code: error?.code ?? "AI_SERVICE_STREAM_ERROR",
      statusCode: error?.statusCode ?? 502,
    });
  } finally {
    req.off("close", abortUpstream);
  }

  if (receivedError) {
    res.end();
    return;
  }

  // Only persist the assistant turn when we actually got content.
  let persistedId = null;
  if (assembledReply.length > 0) {
    const assistantMessage = {
      role: MESSAGE_ROLES.ASSISTANT,
      content: assembledReply,
      context: {},
      provider,
      model,
    };
    chat.messages.push(assistantMessage);
    await chat.save();
    const persisted = chat.messages[chat.messages.length - 1];
    persistedId = persisted?._id?.toString?.() ?? null;
  }

  writeSse(res, SSE_EVENTS.DONE, {
    chatId: chat.id,
    messageId: persistedId,
    reply: assembledReply,
    provider,
    model,
    next_step: nextStep,
  });
  res.end();
}

/**
 * GET /api/chat
 *
 * List the current user's chats (most recently updated first). Returns
 * only light-weight summaries; fetch `/api/chat/:id` for the full thread.
 */
export async function listChats(req, res) {
  const chats = await Chat.find({ userId: req.user._id })
    .select("_id title active_pdf_id updatedAt createdAt")
    .sort({ updatedAt: -1 })
    .lean();

  res.json({
    status: "ok",
    chats: chats.map((c) => ({
      id: c._id.toString(),
      title: c.title,
      active_pdf_id: c.active_pdf_id,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}

/**
 * Shape a Mongo chat message subdocument into the richer payload the
 * frontend expects (id, provider, model, createdAt — not just
 * role/content like the Python-bound mapper).
 */
function mapMessagesForUI(messages = []) {
  return messages.map((m) => ({
    id: m._id?.toString?.() ?? null,
    role: m.role,
    content: m.content,
    provider: m.provider ?? null,
    model: m.model ?? null,
    createdAt: m.createdAt ?? null,
  }));
}

/**
 * GET /api/chat/:id — return a single chat's full history.
 */
export async function getChat(req, res) {
  const chat = await Chat.findOne({ _id: req.params.id, userId: req.user._id }).lean();
  if (!chat) {
    throw ApiError.notFound("Chat not found.", { code: "CHAT_NOT_FOUND" });
  }
  res.json({
    status: "ok",
    chat: {
      id: chat._id.toString(),
      title: chat.title,
      active_pdf_id: chat.active_pdf_id,
      messages: mapMessagesForUI(chat.messages),
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    },
  });
}

/**
 * PATCH /api/chat/:id — update metadata (title / active_pdf_id).
 */
export async function updateChat(req, res) {
  const updates = {};
  if (typeof req.body?.title === "string") updates.title = req.body.title.trim();
  if (typeof req.body?.active_pdf_id === "string" || req.body?.active_pdf_id === null) {
    updates.active_pdf_id = req.body.active_pdf_id;
  }
  if (Object.keys(updates).length === 0) {
    throw ApiError.badRequest("No updatable fields supplied.");
  }

  const chat = await Chat.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    { $set: updates },
    { new: true }
  ).lean();
  if (!chat) {
    throw ApiError.notFound("Chat not found.", { code: "CHAT_NOT_FOUND" });
  }
  res.json({
    status: "ok",
    chat: {
      id: chat._id.toString(),
      title: chat.title,
      active_pdf_id: chat.active_pdf_id,
      updatedAt: chat.updatedAt,
    },
  });
}

/**
 * POST /api/chat/upload
 *
 * Thin multipart proxy to the Python AI service `POST /upload`.
 * We forward the raw request body to Python — no in-process buffering —
 * and relay the JSON response (or the upstream error) back to the
 * client. On success we also remember the returned `vector_id` on the
 * chat document (if `chatId` was supplied as a query string).
 *
 * Requires `verifyJWT` — see `chat.routes.js`.
 */
export async function uploadPdf(req, res) {
  const contentType = req.headers["content-type"];
  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw ApiError.badRequest(
      "Upload must be sent as multipart/form-data.",
      { code: "UPLOAD_INVALID_CONTENT_TYPE" }
    );
  }

  const chatId =
    typeof req.query?.chatId === "string" && req.query.chatId.length > 0
      ? req.query.chatId
      : null;

  let upstream;
  try {
    upstream = await fetch(`${env.aiService.url}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        ...(req.headers["content-length"]
          ? { "Content-Length": req.headers["content-length"] }
          : {}),
      },
      body: Readable.toWeb(req),
      duplex: "half",
    });
  } catch (err) {
    throw ApiError.serviceUnavailable(
      `AI service unreachable for upload: ${err?.message ?? err}`,
      { code: "AI_SERVICE_UNREACHABLE" }
    );
  }

  const contentTypeOut = upstream.headers.get("content-type") ?? "";
  const payload = contentTypeOut.includes("application/json")
    ? await upstream.json().catch(() => ({}))
    : { detail: await upstream.text().catch(() => "") };

  if (!upstream.ok) {
    const detail = payload?.detail ?? payload?.message ?? "Upload failed upstream.";
    throw new ApiError(upstream.status >= 500 ? 502 : upstream.status, detail, {
      code: "AI_SERVICE_UPSTREAM_ERROR",
    });
  }

  const vectorId = payload?.vector_id ?? null;

  if (chatId && vectorId) {
    try {
      await Chat.updateOne(
        { _id: chatId, userId: req.user._id },
        { $set: { active_pdf_id: vectorId } }
      );
    } catch (err) {
      // Non-fatal — the upload itself succeeded.
      // eslint-disable-next-line no-console
      console.warn("[chat.controller] failed to persist active_pdf_id:", err);
    }
  }

  res.status(200).json({
    status: "ok",
    vector_id: vectorId,
    filename: payload?.filename ?? null,
    documents: payload?.documents ?? null,
    chunks: payload?.chunks ?? null,
    chatId,
  });
}

/**
 * POST /api/chat/title
 *
 * Generate a short (max ~4 words) human-friendly chat title from a
 * seed user message. This endpoint does NOT persist anything — the
 * frontend decides whether to PATCH the chat with the returned title.
 *
 * Body: `{ text: string, chatId?: string }`
 *
 * If `chatId` is supplied AND belongs to the caller, we also persist
 * the generated title on the chat as a convenience. Otherwise we just
 * return it.
 */
export async function generateChatTitle(req, res) {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    throw ApiError.badRequest("`text` is required.", {
      code: "TITLE_TEXT_MISSING",
    });
  }
  const chatId = typeof req.body?.chatId === "string" ? req.body.chatId : null;

  const titlerMessages = [
    {
      role: MESSAGE_ROLES.SYSTEM,
      content:
        "You generate chat titles. Given a user's first message, reply " +
        "with 3 to 5 words that capture the topic — NO quotes, NO trailing " +
        "punctuation, NO prefix like 'Title:'. Just the words. Title Case.",
    },
    {
      role: MESSAGE_ROLES.USER,
      content: text.slice(0, 800),
    },
  ];

  let title = "New chat";
  try {
    const ai = await generateAIResponse({ messages: titlerMessages });
    const raw = typeof ai?.reply === "string" ? ai.reply : "";
    title = cleanupTitle(raw) || title;
  } catch (error) {
    // Non-fatal — fall back to a sensible default derived from the text.
    // eslint-disable-next-line no-console
    console.warn("[chat.controller] title generation failed:", error?.message ?? error);
    title = deriveTitle(text);
  }

  if (chatId) {
    try {
      await Chat.updateOne(
        { _id: chatId, userId: req.user._id },
        { $set: { title } }
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[chat.controller] failed to persist generated title:", err);
    }
  }

  res.status(200).json({ status: "ok", title, chatId });
}

/**
 * Normalise a title candidate returned by the LLM: strip surrounding
 * quotes, trailing punctuation, clamp to a reasonable length.
 */
function cleanupTitle(raw) {
  if (!raw) return "";
  let t = raw.trim().split(/\r?\n/)[0].trim();
  t = t.replace(/^["'`]+|["'`]+$/g, "");
  t = t.replace(/^(title\s*:\s*)/i, "");
  t = t.replace(/[.。!?！？\s]+$/u, "");
  if (t.length > DEFAULT_CHAT_TITLE_MAX) {
    t = `${t.slice(0, DEFAULT_CHAT_TITLE_MAX - 1).trimEnd()}…`;
  }
  return t;
}

/**
 * DELETE /api/chat/:id — delete one chat thread.
 */
export async function deleteChat(req, res) {
  const result = await Chat.deleteOne({
    _id: req.params.id,
    userId: req.user._id,
  });
  if (result.deletedCount === 0) {
    throw ApiError.notFound("Chat not found.", { code: "CHAT_NOT_FOUND" });
  }
  res.json({ status: "ok" });
}
