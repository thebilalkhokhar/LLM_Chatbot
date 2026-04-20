"""PDF ingestion pipeline.

Loads a PDF, splits it into chunks using a recursive character splitter,
and persists the resulting vectors via :class:`VectorStoreManager`.

The public entry point, :func:`ingest_pdf`, is used by both the
``/upload`` route and (optionally) background jobs.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.rag.vector_store import (
    VectorStoreError,
    VectorStoreManager,
    get_vector_store_manager,
)

logger = logging.getLogger(__name__)

_CHUNK_SIZE = 1000
_CHUNK_OVERLAP = 200
_SEPARATORS = ["\n\n", "\n", " ", ""]


class PdfIngestionError(RuntimeError):
    """Raised when a PDF cannot be parsed or embedded."""


@dataclass(frozen=True)
class IngestionResult:
    """Summary returned from :func:`ingest_pdf`."""

    vector_id: str
    filename: str
    documents: int
    chunks: int
    storage_path: str


def ingest_pdf(
    pdf_path: str | Path,
    *,
    store_id: str | None = None,
    filename: str | None = None,
    manager: VectorStoreManager | None = None,
) -> IngestionResult:
    """Ingest a PDF on disk into a FAISS vector store.

    Parameters
    ----------
    pdf_path:
        Filesystem path to the PDF file to index.
    store_id:
        Optional caller-supplied identifier. When omitted a UUID4 is
        generated and returned as ``vector_id``.
    filename:
        Original file name (useful when ``pdf_path`` is a temp file).
    manager:
        Injected :class:`VectorStoreManager` for testability. Defaults to
        the cached singleton.

    Returns
    -------
    IngestionResult
        The vector id plus summary metadata.

    Raises
    ------
    PdfIngestionError
        If the PDF is missing, empty, or embedding fails.
    """
    path = Path(pdf_path).expanduser()
    if not path.exists() or not path.is_file():
        raise PdfIngestionError(f"PDF not found at: {path}")

    try:
        docs = PyPDFLoader(str(path)).load()
    except Exception as exc:  # noqa: BLE001
        logger.exception("PyPDFLoader failed for %s: %s", path, exc)
        raise PdfIngestionError(f"Failed to read PDF '{path.name}': {exc}") from exc

    if not docs:
        raise PdfIngestionError(
            f"PDF '{path.name}' contains no extractable text."
        )

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=_CHUNK_SIZE,
        chunk_overlap=_CHUNK_OVERLAP,
        separators=_SEPARATORS,
    )
    chunks = splitter.split_documents(docs)
    if not chunks:
        raise PdfIngestionError(
            f"PDF '{path.name}' produced no chunks after splitting."
        )

    # Stamp each chunk with the source filename for nicer citations later.
    source_name = filename or path.name
    for chunk in chunks:
        chunk.metadata.setdefault("source_file", source_name)

    vector_id = store_id or uuid.uuid4().hex
    mgr = manager or get_vector_store_manager()

    try:
        storage_path = mgr.save_vector_store(chunks, vector_id)
    except VectorStoreError as exc:
        raise PdfIngestionError(str(exc)) from exc

    logger.info(
        "Ingested PDF '%s': %d pages → %d chunks → vector_id=%s",
        source_name,
        len(docs),
        len(chunks),
        vector_id,
    )

    return IngestionResult(
        vector_id=vector_id,
        filename=source_name,
        documents=len(docs),
        chunks=len(chunks),
        storage_path=str(storage_path),
    )
