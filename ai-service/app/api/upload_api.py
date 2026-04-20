"""HTTP routes for document uploads.

Exposes ``POST /upload``: accepts a multipart PDF, persists it to a
temporary file, runs it through the RAG ingestion pipeline, and returns
the generated ``vector_id`` along with index metadata.

The route is deliberately thin — all heavy lifting lives in
:mod:`app.rag.ingest` / :mod:`app.rag.vector_store`.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.rag.ingest import PdfIngestionError, ingest_pdf
from app.schemas.upload_schema import UploadResponse

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB hard cap for uploads


def _save_to_temp(contents: bytes, suffix: str) -> Path:
    """Persist raw bytes to a temp file and return its path."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(contents)
    finally:
        tmp.close()
    return Path(tmp.name)


@router.post(
    "/upload",
    response_model=UploadResponse,
    tags=["rag"],
    summary="Ingest a PDF into a FAISS vector store and return its vector_id.",
)
async def upload_pdf(file: UploadFile = File(...)) -> UploadResponse:
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing filename.",
        )

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only .pdf files are supported.",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )
    if len(contents) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {_MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
        )

    tmp_path = _save_to_temp(contents, suffix=".pdf")
    try:
        try:
            result = ingest_pdf(tmp_path, filename=file.filename)
        except PdfIngestionError as exc:
            logger.warning("Ingestion failed for %s: %s", file.filename, exc)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error ingesting %s: %s", file.filename, exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal error during PDF ingestion.",
            ) from exc
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            logger.debug("Could not remove temp upload %s", tmp_path)

    return UploadResponse(
        vector_id=result.vector_id,
        filename=result.filename,
        documents=result.documents,
        chunks=result.chunks,
    )
