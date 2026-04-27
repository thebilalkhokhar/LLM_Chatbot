"""Pydantic models for the /chat API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """A single turn in a conversation."""

    role: Literal["system", "user", "assistant"] = Field(
        ..., description="Message role."
    )
    content: str = Field(..., min_length=1, description="Message body text.")


class ChatRequest(BaseModel):
    """Incoming payload for POST /chat."""

    messages: list[ChatMessage] = Field(
        ...,
        min_length=1,
        description="Conversation history. The last message is the new user turn.",
    )
    context: dict[str, Any] | None = Field(
        default=None,
        description="Optional RAG / metadata context forwarded to the graph state.",
    )
    use_gemini: bool = Field(
        default=False,
        description=(
            "If `true`, route this turn to Google Gemini. Otherwise the "
            "default Groq backend is used. The service auto-falls-back "
            "to the other provider if the preferred one is unreachable."
        ),
    )


class ChatResponse(BaseModel):
    """Outgoing payload for POST /chat."""

    reply: str = Field(..., description="Assistant reply text.")
    provider: str | None = Field(
        default=None,
        description="LLM provider that produced the reply ('groq' or 'gemini').",
    )
    model: str | None = Field(
        default=None, description="Concrete model id used for the reply."
    )
    next_step: str | None = Field(
        default=None, description="Name of the next graph step (if any)."
    )
