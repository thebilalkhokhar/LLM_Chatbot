"""Shared state schema used by every node in the LangGraph workflow."""

from __future__ import annotations

from typing import Annotated, Any, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict, total=False):
    """Global state carried between graph nodes.

    Attributes
    ----------
    messages:
        Full conversation history. The ``add_messages`` reducer appends
        new messages produced by a node instead of overwriting the list.
    next_step:
        Name of the next node to run. Reserved for later phases where we
        add routing / tool-calling.
    context:
        Arbitrary context bag for RAG retrievals and other upstream data.
    """

    messages: Annotated[list[BaseMessage], add_messages]
    next_step: str
    context: dict[str, Any]
