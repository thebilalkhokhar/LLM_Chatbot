/**
 * Thin typed wrappers around the Node gateway's /api/chat endpoints.
 *
 * The streaming endpoint (`POST /api/chat`) is deliberately NOT wrapped
 * here — that lives in `hooks/useChat.ts` because it needs the Fetch
 * API's `ReadableStream`.
 */

import { apiClient, getJson, postJson } from "@/lib/api-client";
import type { ChatSummary, Message } from "@/types";

export interface ChatDetail {
  id: string;
  title: string;
  titleLocked?: boolean;
  active_pdf_id?: string | null;
  messages: Message[];
  createdAt?: string;
  updatedAt?: string;
}

interface ListChatsResponse {
  status: "ok";
  chats: ChatSummary[];
}

interface GetChatResponse {
  status: "ok";
  chat: ChatDetail;
}

interface PatchChatResponse {
  status: "ok";
  chat: Pick<ChatSummary, "id" | "title" | "active_pdf_id" | "updatedAt"> & {
    titleLocked?: boolean;
  };
}

interface TitleResponse {
  status: "ok";
  title: string;
  chatId: string | null;
  /** True when the backend actually persisted the generated title. */
  persisted?: boolean;
}

/** Fetch every chat thread for the current user (most-recent first). */
export async function listChats(): Promise<ChatSummary[]> {
  const data = await getJson<ListChatsResponse>("/chat");
  return data.chats;
}

/** Fetch a single chat thread (full message history). */
export async function getChatById(id: string): Promise<ChatDetail> {
  const data = await getJson<GetChatResponse>(`/chat/${id}`);
  return data.chat;
}

/** Patch metadata (title / active_pdf_id). */
export async function patchChat(
  id: string,
  patch: { title?: string; active_pdf_id?: string | null }
): Promise<PatchChatResponse["chat"]> {
  const { data } = await apiClient.patch<PatchChatResponse>(`/chat/${id}`, patch);
  return data.chat;
}

/**
 * Manually rename a chat thread.
 *
 * Empty / whitespace-only titles are rejected client-side so we don't
 * round-trip a request the backend will refuse.
 */
export async function patchChatTitle(
  id: string,
  title: string
): Promise<PatchChatResponse["chat"]> {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Title cannot be empty.");
  }
  const { data } = await apiClient.patch<PatchChatResponse>(
    `/chat/${id}/title`,
    { title: trimmed }
  );
  return data.chat;
}

/** Delete a chat thread. */
export async function deleteChat(id: string): Promise<void> {
  await apiClient.delete(`/chat/${id}`);
}

/**
 * Ask the AI service to summarize the user's first message into a
 * 3–5 word chat title. If `chatId` is provided the backend will also
 * persist it on that chat.
 */
export async function generateChatTitle(
  text: string,
  chatId?: string | null
): Promise<string> {
  const data = await postJson<TitleResponse>("/chat/title", {
    text,
    chatId: chatId ?? null,
  });
  return data.title;
}
