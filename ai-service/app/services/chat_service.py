"""Chat business logic.

Owns the work of:
  * converting API-layer :class:`ChatMessage` payloads into LangChain messages,
  * invoking the compiled LangGraph workflow,
  * extracting a clean :class:`ChatResponse` from the final graph state.

The route handlers in ``app.api.chat_routes`` should contain *no* LangGraph
or LLM logic — they only call into this module.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Iterator

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.core.config import get_settings
from app.graph.graph import get_graph
from app.graph.nodes.chat_node import build_rag_system_message
from app.graph.nodes.retriever_node import retriever_node
from app.schemas.chat_schema import ChatMessage, ChatRequest, ChatResponse
from app.services.llm import LLMUnavailableError, get_llm_service

logger = logging.getLogger(__name__)


class ChatServiceError(RuntimeError):
    """Raised when the chat pipeline cannot produce a valid response."""


# --------------------------------------------------------------------- #
# Internal helpers
# --------------------------------------------------------------------- #
_ROLE_MAP: dict[str, type[BaseMessage]] = {
    "system": SystemMessage,
    "user": HumanMessage,
    "assistant": AIMessage,
}


def _to_lc_messages(messages: list[ChatMessage]) -> list[BaseMessage]:
    """Translate API schema messages into LangChain message objects."""
    return [_ROLE_MAP[m.role](content=m.content) for m in messages]


def _extract_reply(
    final_state: dict[str, Any],
) -> tuple[str, str | None, str | None, str | None]:
    """Pull the reply, provider, model, and next_step from the final state."""
    messages: list[BaseMessage] = final_state.get("messages", [])
    if not messages:
        raise ChatServiceError("Graph returned no messages.")

    last = messages[-1]
    content = getattr(last, "content", str(last))
    reply_text = content if isinstance(content, str) else str(content)

    metadata = getattr(last, "response_metadata", None) or {}
    provider = metadata.get("provider")
    model = metadata.get("model")

    return reply_text, provider, model, final_state.get("next_step")


# --------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------- #
def process_chat(req: ChatRequest) -> ChatResponse:
    """Run one chat turn through the LangGraph workflow.

    Parameters
    ----------
    req:
        The validated incoming request.

    Returns
    -------
    ChatResponse
        The assistant reply plus optional ``next_step``.

    Raises
    ------
    ChatServiceError
        If the graph fails or returns an empty state.
    """
    graph = get_graph()

    initial_state: dict[str, Any] = {
        "messages": _to_lc_messages(req.messages),
        "next_step": "chat",
        "context": req.context or {},
    }

    try:
        final_state = graph.invoke(initial_state)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Graph invocation failed: %s", exc)
        raise ChatServiceError("Graph invocation failed.") from exc

    reply, provider, model, next_step = _extract_reply(final_state)
    return ChatResponse(
        reply=reply,
        provider=provider,
        model=model,
        next_step=next_step,
    )


# --------------------------------------------------------------------- #
# Streaming API
# --------------------------------------------------------------------- #
def _ndjson(payload: dict[str, Any]) -> str:
    """Serialize a dict as a single NDJSON line (trailing ``\\n``)."""
    return json.dumps(payload, ensure_ascii=False) + "\n"


def _friendly_llm_error(exc: Exception) -> tuple[str, str]:
    """Map a raw upstream error into ``(message, code)`` for the client."""
    raw = f"{exc.__class__.__name__}: {exc}"
    lowered = raw.lower()
    if (
        "resourceexhausted" in lowered
        or "quota" in lowered
        or "429" in lowered
        or "rate limit" in lowered
    ):
        return (
            "Gemini's free-tier quota is exhausted for the day. "
            "Please retry after the quota resets or upgrade your plan.",
            "GEMINI_QUOTA_EXHAUSTED",
        )
    if "api key" in lowered or "api_key_invalid" in lowered or "401" in lowered:
        return (
            "Gemini rejected the API key. Check GEMINI_API_KEY in ai-service/.env.",
            "GEMINI_AUTH_FAILED",
        )
    return (
        "I'm temporarily unable to reach the language model. Please try again shortly.",
        "LLM_UNAVAILABLE",
    )


def stream_chat(req: ChatRequest) -> Iterator[str]:
    """Run one chat turn and yield NDJSON chunks as Gemini produces tokens.

    Protocol (one JSON object per line):

    - ``{"event": "start", "provider": "gemini", "model": "..."}``
    - ``{"token": "..."}`` — zero or more, in generation order
    - ``{"event": "done", "next_step": "END"}`` on success
    - ``{"event": "error", "message": "..."}`` on failure (terminal)

    RAG behaviour matches the non-streaming path: if the request carries
    a ``pdf_id`` in ``context``, we run :func:`retriever_node` first and
    prepend the same grounded-answer system prompt that :func:`chat_node`
    uses. We bypass the compiled LangGraph for this path because LangGraph
    nodes cannot themselves yield tokens to the HTTP layer.
    """
    settings = get_settings()
    model_id = settings.gemini_model

    messages: list[BaseMessage] = _to_lc_messages(req.messages)
    state: dict[str, Any] = {
        "messages": messages,
        "next_step": "chat",
        "context": req.context or {},
    }

    try:
        diff = retriever_node(state)  # type: ignore[arg-type]
        if diff:
            state.update(diff)
    except Exception as exc:  # noqa: BLE001
        logger.exception("stream_chat: retriever failed, continuing without RAG: %s", exc)

    final_messages: list[BaseMessage] = list(state["messages"])
    rag_system = build_rag_system_message(state.get("context") or {})
    if rag_system is not None:
        final_messages = [rag_system, *final_messages]

    try:
        llm = get_llm_service()
    except LLMUnavailableError as exc:
        message, code = _friendly_llm_error(exc)
        logger.error("stream_chat: LLM unavailable: %s", exc)
        yield _ndjson({"event": "error", "message": message, "code": code})
        return

    yield _ndjson({"event": "start", "provider": "gemini", "model": model_id})

    emitted_any = False
    try:
        for token in llm.stream(final_messages):
            emitted_any = True
            yield _ndjson({"token": token})
    except LLMUnavailableError as exc:
        message, code = _friendly_llm_error(exc)
        logger.error("stream_chat: stream aborted: %s", exc)
        yield _ndjson({"event": "error", "message": message, "code": code})
        return
    except Exception as exc:  # noqa: BLE001
        message, code = _friendly_llm_error(exc)
        logger.exception("stream_chat: unexpected streaming error: %s", exc)
        yield _ndjson({"event": "error", "message": message, "code": code})
        return

    if not emitted_any:
        # Model connected but returned no text. Surface this as an error
        # instead of a hollow "done" so the client can retry.
        yield _ndjson(
            {
                "event": "error",
                "message": "Model returned an empty response.",
                "code": "LLM_EMPTY_RESPONSE",
            }
        )
        return

    yield _ndjson({"event": "done", "next_step": "END"})
