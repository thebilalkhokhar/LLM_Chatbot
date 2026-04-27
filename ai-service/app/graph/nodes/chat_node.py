"""Chat node — generates an assistant reply, optionally grounded on RAG context.

If the upstream :func:`retriever_node` attached ``retrieved_chunks`` to
``state["context"]``, we prepend a dedicated :class:`SystemMessage` that
tells the LLM to answer strictly from those chunks and to open with
"Based on the document, …". Otherwise the node behaves exactly like the
Phase 1 chat node.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage

from app.graph.state import AgentState
from app.services.llm import LLMUnavailableError, get_llm_service

logger = logging.getLogger(__name__)

_MAX_CONTEXT_CHARS = 6000  # safety cap so we never blow past LLM context limits


def build_rag_system_message(context: dict[str, Any]) -> SystemMessage | None:
    """Build a grounded-answer system message from retrieved chunks.

    Public so that the streaming chat service can reuse the exact same
    prompt the non-streaming graph node uses.
    """
    chunks = context.get("retrieved_chunks") or []
    if not chunks:
        return None

    joined: list[str] = []
    running_len = 0
    for idx, chunk in enumerate(chunks, start=1):
        text = str(chunk).strip()
        if not text:
            continue
        snippet = f"[chunk {idx}]\n{text}"
        if running_len + len(snippet) > _MAX_CONTEXT_CHARS:
            break
        joined.append(snippet)
        running_len += len(snippet)

    if not joined:
        return None

    sources = context.get("source_files") or []
    source_line = (
        f"Source document(s): {', '.join(sources)}\n\n" if sources else ""
    )

    prompt = (
        "You are a helpful assistant answering questions about the user's "
        "uploaded document.\n"
        "Use ONLY the context below to answer. If the answer is not in the "
        "context, say you don't know instead of guessing.\n"
        "Begin your reply with the phrase: \"Based on the document, \".\n\n"
        f"{source_line}"
        "=== CONTEXT START ===\n"
        f"{chr(10).join(joined)}\n"
        "=== CONTEXT END ==="
    )
    return SystemMessage(content=prompt)


def chat_node(state: AgentState) -> dict[str, Any]:
    """Generate an assistant reply from the current message history."""
    messages: list[BaseMessage] = list(state.get("messages", []))
    if not messages:
        logger.warning("chat_node invoked with empty message list.")
        return {
            "messages": [AIMessage(content="(no input provided)")],
            "next_step": "END",
        }

    context = state.get("context") or {}
    rag_system = build_rag_system_message(context)
    if rag_system is not None:
        logger.debug("chat_node: injecting RAG context into system prompt.")
        messages = [rag_system, *messages]

    use_gemini = bool(state.get("use_gemini", False))
    llm = get_llm_service()
    try:
        reply = llm.invoke(messages, use_gemini=use_gemini)
    except LLMUnavailableError as exc:
        logger.error("LLM unavailable: %s", exc)
        reply = AIMessage(content=_format_unavailable_message(exc))

    return {"messages": [reply], "next_step": "END"}


def _format_unavailable_message(exc: Exception) -> str:
    """Translate a raw LLM failure into a user-facing reason string."""
    lowered = f"{exc.__class__.__name__}: {exc}".lower()
    if (
        "resourceexhausted" in lowered
        or "quota" in lowered
        or "429" in lowered
        or "rate limit" in lowered
    ):
        return (
            "All language-model providers hit a rate limit or quota. "
            "Please retry shortly."
        )
    if "api key" in lowered or "api_key_invalid" in lowered or "401" in lowered:
        return (
            "The configured API keys were rejected. Check GROQ_API_KEY "
            "and GEMINI_API_KEY in ai-service/.env."
        )
    return (
        "I'm temporarily unable to reach a language model. "
        "Please try again shortly."
    )
