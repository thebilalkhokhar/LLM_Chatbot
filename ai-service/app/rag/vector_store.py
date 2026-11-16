"""Pinecone-backed vector store manager.

Responsible for:

* constructing an embedding function (local FastEmbed ONNX model —
  by default ``sentence-transformers/all-MiniLM-L6-v2``, 384-d, no PyTorch),
* upserting document vectors into a Pinecone index under a per-document
  *namespace* (so each uploaded PDF is isolated),
* running similarity queries against Pinecone and returning results as
  :class:`~langchain_core.documents.Document` objects so the rest of
  the LangChain pipeline is unaffected.

Why namespaces?
    A single Pinecone Starter (free) index hosts multiple PDFs.
    Namespaces act as isolated partitions — we use the ``store_id``
    (UUID assigned at upload time) as the namespace so different PDFs
    never bleed into each other.

Why direct pinecone client (no langchain-pinecone)?
    ``langchain-pinecone <0.2`` requires ``langchain-core <0.3`` and
    ``langchain-pinecone >=0.2`` requires ``langchain-core >=1.x``.
    Neither range is compatible with the rest of the project's
    LangChain stack (0.3.x). Using the raw Pinecone SDK avoids the
    version conflict entirely while keeping the same public API.

Why local embeddings?
    Google's hosted embedding models keep getting rotated/retired.
    FastEmbed runs the same MiniLM weights as ONNX Runtime, so we keep
    deterministic 384-d vectors and zero API cost without loading PyTorch.
    The model is downloaded once into a writable cache (``/tmp`` on Vercel).
"""

from __future__ import annotations

import logging
import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence

from langchain_core.documents import Document

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

_UPSERT_BATCH = 100  # Pinecone recommends batches of ≤100 vectors


def _unit_vector(values: Sequence[float]) -> list[float]:
    """L2-normalize so cosine search matches the previous embedding setup."""
    coords = [float(value) for value in values]
    norm = math.sqrt(sum(value * value for value in coords))
    if norm == 0.0:
        return coords
    return [value / norm for value in coords]


def _embedding_cache_dir(settings: Settings) -> str:
    """Return a writable directory for the ONNX model.

    Vercel functions can only write to ``/tmp``. Local runs use
    ``ai-service/.cache/fastembed`` unless ``FASTEMBED_CACHE_PATH`` is set.
    """
    configured = (settings.embedding_cache_dir or "").strip()
    if configured:
        path = configured
    elif os.environ.get("VERCEL"):
        path = "/tmp/fastembed"
    else:
        path = str(Path(__file__).resolve().parents[2] / ".cache" / "fastembed")
    Path(path).mkdir(parents=True, exist_ok=True)
    return path


class _FastEmbedAdapter:
    """Small wrapper so the rest of the store can call LangChain-style methods.

    The ONNX model is constructed on first use, not at import time, so
    ``/health`` and plain chat do not pay the model RAM cost.
    """

    def __init__(self, model_name: str, cache_dir: str) -> None:
        self._model_name = model_name
        self._cache_dir = cache_dir
        self._model = None

    def _load(self):  # noqa: ANN202
        if self._model is not None:
            return self._model

        # Hugging Face / FastEmbed must not touch a read-only home directory.
        os.environ.setdefault("FASTEMBED_CACHE_PATH", self._cache_dir)
        os.environ.setdefault("HF_HOME", self._cache_dir)
        os.environ.setdefault(
            "HUGGINGFACE_HUB_CACHE", str(Path(self._cache_dir) / "hub")
        )

        try:
            from fastembed import TextEmbedding
        except ImportError as exc:  # pragma: no cover
            raise VectorStoreError(
                "fastembed is not installed. "
                "Run `pip install \"fastembed>=0.4.0\"`."
            ) from exc

        try:
            # CPU-only. threads=1 keeps the ONNX session inside the Hobby RAM cap.
            self._model = TextEmbedding(
                model_name=self._model_name,
                cache_dir=self._cache_dir,
                threads=1,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to load FastEmbed model: %s", exc)
            raise VectorStoreError(
                f"Failed to load embedding model '{self._model_name}': {exc}"
            ) from exc
        logger.info(
            "Loaded FastEmbed ONNX model '%s' (cache: %s)",
            self._model_name,
            self._cache_dir,
        )
        return self._model

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        """Embed a batch of document chunks."""
        if not texts:
            return []
        model = self._load()
        return [_unit_vector(vector) for vector in model.embed(list(texts))]

    def embed_query(self, text: str) -> list[float]:
        """Embed a single search query."""
        model = self._load()
        vector = next(model.embed([text]))
        return _unit_vector(vector)


class VectorStoreError(RuntimeError):
    """Raised when saving / loading a Pinecone index namespace fails."""


# ---------------------------------------------------------------------------
# Lightweight retriever shim — matches the LangChain retriever contract used
# by retriever_node.py (.invoke(query) → list[Document]).
# ---------------------------------------------------------------------------
class _PineconeRetriever:
    """Minimal retriever that queries Pinecone directly."""

    def __init__(
        self,
        index,  # pinecone.Index
        embeddings,
        store_id: str,
        k: int,
    ) -> None:
        self._index = index
        self._embeddings = embeddings
        self._store_id = store_id
        self._k = k

    def invoke(self, query: str) -> list[Document]:
        """Embed *query* and return the top-k matching Documents."""
        query_vector = self._embeddings.embed_query(query)
        result = self._index.query(
            vector=query_vector,
            top_k=self._k,
            namespace=self._store_id,
            include_metadata=True,
        )
        docs: list[Document] = []
        for match in result.get("matches", []):
            meta: dict[str, Any] = dict(match.get("metadata") or {})
            text = meta.pop("text", "")
            docs.append(Document(page_content=str(text), metadata=meta))
        return docs


class VectorStoreManager:
    """Save, load, and query Pinecone namespaces keyed by ``store_id``."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        # Adapter is cheap; the ONNX session is created on the first embed.
        self._embeddings = _FastEmbedAdapter(
            model_name=self.settings.embedding_model,
            cache_dir=_embedding_cache_dir(self.settings),
        )
        self._validate_pinecone_config()

    # ------------------------------------------------------------------ #
    # Validation
    # ------------------------------------------------------------------ #
    def _validate_pinecone_config(self) -> None:
        """Raise early if Pinecone credentials are missing."""
        if not self.settings.pinecone_api_key:
            raise VectorStoreError(
                "PINECONE_API_KEY is not set. "
                "Add it to your .env or Render environment variables."
            )

    # ------------------------------------------------------------------ #
    # Embeddings
    # ------------------------------------------------------------------ #
    @property
    def embeddings(self):  # noqa: ANN201
        """Expose the FastEmbed adapter for advanced callers."""
        return self._embeddings

    # ------------------------------------------------------------------ #
    # Pinecone client helper
    # ------------------------------------------------------------------ #
    def _get_pinecone_index(self):  # noqa: ANN202
        """Return a connected Pinecone ``Index`` handle."""
        try:
            from pinecone import Pinecone  # noqa: PLC0415
        except ImportError as exc:  # pragma: no cover
            raise VectorStoreError(
                "pinecone package is not installed. Run `pip install pinecone`."
            ) from exc

        pc = Pinecone(api_key=self.settings.pinecone_api_key)

        if self.settings.pinecone_host:
            return pc.Index(
                host=self.settings.pinecone_host,
                name=self.settings.pinecone_index_name,
            )
        return pc.Index(self.settings.pinecone_index_name)

    # ------------------------------------------------------------------ #
    # Existence check
    # ------------------------------------------------------------------ #
    def exists(self, store_id: str) -> bool:
        """Return ``True`` if vectors for ``store_id`` exist in Pinecone."""
        try:
            index = self._get_pinecone_index()
            stats = index.describe_index_stats()
            namespaces = stats.get("namespaces", {})
            return (
                store_id in namespaces
                and (namespaces[store_id].get("vector_count") or 0) > 0
            )
        except VectorStoreError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("Pinecone exists() check failed for %s: %s", store_id, exc)
            return False

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #
    def save_vector_store(
        self, documents: Sequence[Document], store_id: str
    ) -> str:
        """Embed *documents* and upsert them into Pinecone under *store_id* namespace.

        Returns
        -------
        str
            The ``store_id`` (namespace) that was written.
        """
        if not documents:
            raise VectorStoreError("Cannot build a vector store from zero documents.")

        docs_list = list(documents)
        texts = [doc.page_content for doc in docs_list]
        metadatas = [dict(doc.metadata or {}) for doc in docs_list]

        try:
            vectors_data = self._embeddings.embed_documents(texts)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to embed documents for namespace %s: %s", store_id, exc)
            raise VectorStoreError(
                f"Embedding failed for store '{store_id}': {exc}"
            ) from exc

        # Build Pinecone vector records — store the raw text in metadata so
        # we can reconstruct Document objects on retrieval.
        records = [
            {
                "id": f"{store_id}_{i}",
                "values": vec,
                "metadata": {**meta, "text": text},
            }
            for i, (text, vec, meta) in enumerate(zip(texts, vectors_data, metadatas))
        ]

        try:
            index = self._get_pinecone_index()
            # Upsert in batches to stay within Pinecone's request-size limits.
            for start in range(0, len(records), _UPSERT_BATCH):
                batch = records[start : start + _UPSERT_BATCH]
                index.upsert(vectors=batch, namespace=store_id)
        except VectorStoreError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Failed to upsert to Pinecone namespace %s: %s", store_id, exc
            )
            raise VectorStoreError(
                f"Failed to save vector store '{store_id}' to Pinecone: {exc}"
            ) from exc

        logger.info(
            "Upserted %d chunks to Pinecone namespace '%s' (index: %s)",
            len(records),
            store_id,
            self.settings.pinecone_index_name,
        )
        return store_id

    def load_vector_store(self, store_id: str) -> _PineconeRetriever | None:
        """Return a retriever for *store_id*, or ``None`` if the namespace is absent."""
        if not self.exists(store_id):
            return None
        return _PineconeRetriever(
            index=self._get_pinecone_index(),
            embeddings=self._embeddings,
            store_id=store_id,
            k=4,
        )

    # ------------------------------------------------------------------ #
    # Retrieval helper
    # ------------------------------------------------------------------ #
    def as_retriever(self, store_id: str, k: int = 4):  # noqa: ANN201
        """Return a retriever bound to *store_id* namespace, or ``None`` if missing."""
        if not self.exists(store_id):
            return None
        return _PineconeRetriever(
            index=self._get_pinecone_index(),
            embeddings=self._embeddings,
            store_id=store_id,
            k=k,
        )


@lru_cache(maxsize=1)
def get_vector_store_manager() -> VectorStoreManager:
    """Cached accessor used by the ingestion pipeline and retriever node."""
    return VectorStoreManager()
