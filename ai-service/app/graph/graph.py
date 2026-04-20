"""LangGraph workflow assembly.

Phase 2 graph::

    START ──▶ retriever ──▶ chat ──▶ END

The retriever is a conditional-feeling but unconditional node — it
inspects ``state['context']`` and silently no-ops when no ``pdf_id`` is
provided, which keeps the graph shape simple.
"""

from __future__ import annotations

from functools import lru_cache

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.graph.nodes.chat_node import chat_node
from app.graph.nodes.retriever_node import retriever_node
from app.graph.state import AgentState


def build_graph() -> CompiledStateGraph:
    """Construct and compile the Phase 2 LangGraph workflow."""
    workflow = StateGraph(AgentState)
    workflow.add_node("retriever", retriever_node)
    workflow.add_node("chat", chat_node)

    workflow.add_edge(START, "retriever")
    workflow.add_edge("retriever", "chat")
    workflow.add_edge("chat", END)

    return workflow.compile()


@lru_cache(maxsize=1)
def get_graph() -> CompiledStateGraph:
    """Compile the graph once and reuse the instance across requests."""
    return build_graph()
