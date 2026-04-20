"""LangGraph retriever node.

Contract
--------
- If ``state["context"]["pdf_id"]`` is set, load the corresponding FAISS
  index and retrieve the top-k chunks for the latest user message.
- The retrieved chunk texts are attached back to ``state["context"]``
  under ``retrieved_chunks``, along with ``source_files`` and the query
  we used. Downstream nodes (notably :func:`chat_node`) use these to
  build a context-aware system prompt.
- If no ``pdf_id`` is present — or no user message is available — the
  node is a no-op and returns an empty diff.

The node deliberately never raises on retrieval errors; it only logs
and yields an empty diff, so the chat pipeline keeps working even if
the vector store is misconfigured.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage

from app.graph.state import AgentState
from app.rag.vector_store import VectorStoreError, get_vector_store_manager

logger = logging.getLogger(__name__)

_DEFAULT_K = 4


def _latest_user_query(messages: list[BaseMessage]) -> str | None:
    """Return the content of the most recent :class:`HumanMessage`, if any."""
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            content = msg.content
            if isinstance(content, str) and content.strip():
                return content
    return None


def retriever_node(state: AgentState) -> dict[str, Any]:
    """Inject retrieved PDF chunks into ``state['context']`` when possible."""
    context: dict[str, Any] = dict(state.get("context") or {})
    pdf_id = context.get("pdf_id") or context.get("vector_id")

    if not pdf_id:
        logger.debug("retriever_node: no pdf_id in context — skipping retrieval.")
        return {}

    query = _latest_user_query(list(state.get("messages", [])))
    if not query:
        logger.debug("retriever_node: no user message found — skipping retrieval.")
        return {}

    try:
        manager = get_vector_store_manager()
    except VectorStoreError as exc:
        logger.warning("retriever_node: vector store unavailable: %s", exc)
        return {}

    retriever = manager.as_retriever(str(pdf_id), k=_DEFAULT_K)
    if retriever is None:
        logger.info("retriever_node: no index found for pdf_id=%s.", pdf_id)
        context["retrieved_chunks"] = []
        return {"context": context}

    try:
        docs = retriever.invoke(query)
    except Exception as exc:  # noqa: BLE001
        logger.exception("retriever_node: similarity search failed: %s", exc)
        return {}

    chunks: list[str] = []
    sources: list[str] = []
    for doc in docs:
        text = getattr(doc, "page_content", "")
        if isinstance(text, str) and text.strip():
            chunks.append(text.strip())
        src = (getattr(doc, "metadata", {}) or {}).get("source_file")
        if src and src not in sources:
            sources.append(str(src))

    context.update(
        {
            "pdf_id": str(pdf_id),
            "query": query,
            "retrieved_chunks": chunks,
            "source_files": sources,
        }
    )

    logger.info(
        "retriever_node: pdf_id=%s, query=%r → %d chunks",
        pdf_id,
        query[:80],
        len(chunks),
    )
    return {"context": context}
