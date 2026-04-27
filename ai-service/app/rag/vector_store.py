"""FAISS-backed vector store manager.

Responsible for:

* constructing an embedding function (local sentence-transformers
  model — by default ``sentence-transformers/all-MiniLM-L6-v2``),
* persisting FAISS indices to disk under ``storage/vectors/<store_id>/``,
* loading them back on demand,
* exposing a ``as_retriever`` helper for the retriever node.

The manager intentionally knows nothing about PDFs or HTTP layers — it
works on a list of :class:`~langchain_core.documents.Document` objects.

Why local embeddings?
    Google's hosted embedding models keep getting rotated/retired
    (``embedding-001`` → ``text-embedding-004`` → ``gemini-embedding-001``…),
    which silently breaks every persisted FAISS index. Switching to a
    local sentence-transformers model gives us deterministic 384-d
    vectors, zero API cost, and offline reproducibility once the model
    is cached on disk (~90 MB the first time).
"""

from __future__ import annotations

import logging
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Sequence

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


class VectorStoreError(RuntimeError):
    """Raised when saving / loading a FAISS index fails."""


class VectorStoreManager:
    """Save, load, and query FAISS indices keyed by ``store_id``."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._root: Path = self.settings.vector_store_path
        self._root.mkdir(parents=True, exist_ok=True)
        self._embeddings = self._build_embeddings()

    # ------------------------------------------------------------------ #
    # Embeddings
    # ------------------------------------------------------------------ #
    def _build_embeddings(self):  # noqa: ANN202
        """Build a local sentence-transformers embedding function.

        Uses :class:`langchain_huggingface.HuggingFaceEmbeddings`, which
        downloads the model into the HuggingFace cache on first use and
        runs entirely on the local CPU thereafter — no API key or
        network round-trip per document.
        """
        try:
            from langchain_huggingface import HuggingFaceEmbeddings
        except ImportError as exc:  # pragma: no cover - dependency pinned in requirements
            raise VectorStoreError(
                "langchain-huggingface is not installed; cannot build embeddings. "
                "Install it with `pip install langchain-huggingface "
                "sentence-transformers`."
            ) from exc

        try:
            return HuggingFaceEmbeddings(
                model_name=self.settings.embedding_model,
                # CPU is enough for MiniLM-class models. We keep encoding
                # deterministic by disabling the progress bar.
                encode_kwargs={"normalize_embeddings": True},
                model_kwargs={"device": "cpu"},
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to load embedding model: %s", exc)
            raise VectorStoreError(
                f"Failed to load embedding model "
                f"'{self.settings.embedding_model}': {exc}"
            ) from exc

    @property
    def embeddings(self):  # noqa: ANN201
        """Expose the underlying embedding function for advanced callers."""
        return self._embeddings

    # ------------------------------------------------------------------ #
    # Paths
    # ------------------------------------------------------------------ #
    def _path_for(self, store_id: str) -> Path:
        """Return the directory used to persist a FAISS index."""
        safe_id = store_id.strip()
        if not safe_id or "/" in safe_id or "\\" in safe_id or ".." in safe_id:
            raise VectorStoreError(f"Invalid store_id: {store_id!r}")
        return self._root / safe_id

    def exists(self, store_id: str) -> bool:
        """Return ``True`` if a persisted index for ``store_id`` exists."""
        path = self._path_for(store_id)
        return path.is_dir() and (path / "index.faiss").exists()

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #
    def save_vector_store(
        self, documents: Sequence[Document], store_id: str
    ) -> Path:
        """Build a FAISS index from ``documents`` and persist it to disk.

        Parameters
        ----------
        documents:
            Chunked documents to embed.
        store_id:
            Stable identifier for the index (used as a folder name).

        Returns
        -------
        pathlib.Path
            The directory the index was written to.
        """
        if not documents:
            raise VectorStoreError("Cannot build a vector store from zero documents.")

        path = self._path_for(store_id)
        if path.exists():
            logger.info("Overwriting existing vector store at %s", path)
            shutil.rmtree(path, ignore_errors=True)
        path.mkdir(parents=True, exist_ok=True)

        try:
            store = FAISS.from_documents(list(documents), self._embeddings)
            store.save_local(str(path))
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to save vector store %s: %s", store_id, exc)
            shutil.rmtree(path, ignore_errors=True)
            raise VectorStoreError(
                f"Failed to save vector store '{store_id}': {exc}"
            ) from exc

        logger.info(
            "Saved FAISS index '%s' (%d chunks) to %s", store_id, len(documents), path
        )
        return path

    def load_vector_store(self, store_id: str) -> FAISS | None:
        """Load a persisted FAISS index. Returns ``None`` if absent."""
        path = self._path_for(store_id)
        if not self.exists(store_id):
            return None
        try:
            return FAISS.load_local(
                str(path),
                self._embeddings,
                allow_dangerous_deserialization=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to load vector store %s: %s", store_id, exc)
            raise VectorStoreError(
                f"Failed to load vector store '{store_id}': {exc}"
            ) from exc

    # ------------------------------------------------------------------ #
    # Retrieval helper
    # ------------------------------------------------------------------ #
    def as_retriever(self, store_id: str, k: int = 4):  # noqa: ANN201
        """Return a retriever bound to ``store_id`` or ``None`` if missing."""
        store = self.load_vector_store(store_id)
        if store is None:
            return None
        return store.as_retriever(
            search_type="similarity", search_kwargs={"k": k}
        )


@lru_cache(maxsize=1)
def get_vector_store_manager() -> VectorStoreManager:
    """Cached accessor used by the ingestion pipeline and retriever node."""
    return VectorStoreManager()
