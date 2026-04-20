"""Pydantic models for the /upload API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    """Response returned after a successful PDF ingestion."""

    vector_id: str = Field(
        ...,
        description=(
            "Identifier of the FAISS index built for this document. "
            "Pass this back in `context.pdf_id` when calling /chat."
        ),
    )
    filename: str = Field(..., description="Original file name.")
    documents: int = Field(..., description="Number of PDF pages loaded.")
    chunks: int = Field(..., description="Number of text chunks indexed.")
    status: str = Field(default="ok", description="Ingestion status.")
