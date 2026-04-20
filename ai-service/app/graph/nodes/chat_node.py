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


def _build_rag_system_message(context: dict[str, Any]) -> SystemMessage | None:
    """Build a grounded-answer system message from retrieved chunks."""
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
    rag_system = _build_rag_system_message(context)
    if rag_system is not None:
        logger.debug("chat_node: injecting RAG context into system prompt.")
        messages = [rag_system, *messages]

    llm = get_llm_service()
    try:
        reply = llm.invoke(messages)
    except LLMUnavailableError as exc:
        logger.error("LLM unavailable: %s", exc)
        reply = AIMessage(
            content=(
                "I'm temporarily unable to reach any language model. "
                "Please try again shortly."
            )
        )

    return {"messages": [reply], "next_step": "END"}
