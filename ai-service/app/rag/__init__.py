"""Retrieval-Augmented Generation helpers: PDF ingestion + FAISS storage."""

from app.rag.ingest import PdfIngestionError, ingest_pdf
from app.rag.vector_store import VectorStoreManager, get_vector_store_manager

__all__ = [
    "PdfIngestionError",
    "VectorStoreManager",
    "get_vector_store_manager",
    "ingest_pdf",
]
