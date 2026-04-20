"""Chat business logic.

Owns the work of:
  * converting API-layer :class:`ChatMessage` payloads into LangChain messages,
  * invoking the compiled LangGraph workflow,
  * extracting a clean :class:`ChatResponse` from the final graph state.

The route handlers in ``app.api.chat_routes`` should contain *no* LangGraph
or LLM logic — they only call into this module.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.graph.graph import get_graph
from app.schemas.chat_schema import ChatMessage, ChatRequest, ChatResponse

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
