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

import { Chat } from "../models/chat.model.js";
import {
  MESSAGE_ROLES,
  SSE_EVENTS,
} from "../config/constants.js";
import {
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
      messages: mapMessagesToPython(chat.messages),
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
