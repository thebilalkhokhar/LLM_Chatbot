"""Application configuration.

Environment variables are loaded from a single file: ``ai-service/.env``.
The service is self-contained, so there is no longer a repo-root fallback.
Use ``.env.example`` alongside it as the public template / documentation.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# ai-service/
_SERVICE_ROOT: Path = Path(__file__).resolve().parents[2]
_ENV_FILE: Path = _SERVICE_ROOT / ".env"


def _load_env_file() -> None:
    """Load env vars from ``ai-service/.env`` if it exists."""
    if _ENV_FILE.exists():
        load_dotenv(_ENV_FILE, override=False)


_load_env_file()


class Settings(BaseSettings):
    """Typed application settings."""

    model_config = SettingsConfigDict(
        env_file=None,            # we handle loading manually above
        case_sensitive=False,
        extra="ignore",
    )

    # --- Groq (default chat provider) ---
    groq_api_key: str | None = Field(default=None, alias="GROQ_API_KEY")
    groq_model: str = Field(
        default="llama-3.3-70b-versatile", alias="GROQ_MODEL"
    )

    # --- Gemini (toggle via `use_gemini` on the request body) ---
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model: str = Field(
        default="gemini-2.5-flash-lite", alias="GEMINI_MODEL"
    )

    # --- Embeddings (stable, local, free) ---
    # We deliberately use a *local* sentence-transformers model so vectors
    # stay deterministic across runs and we never get bitten by Google's
    # rotating embedding model IDs.
    embedding_model: str = Field(
        default="sentence-transformers/all-MiniLM-L6-v2",
        alias="EMBEDDING_MODEL",
    )

    # --- Runtime ---
    app_env: str = Field(default="development", alias="APP_ENV")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # --- Storage (vector indices, uploads, etc.) ---
    # Overridable via env but defaults to <service_root>/storage/vectors.
    vector_store_dir: str = Field(
        default_factory=lambda: str(_SERVICE_ROOT / "storage" / "vectors"),
        alias="VECTOR_STORE_DIR",
    )

    @property
    def vector_store_path(self) -> Path:
        """Return :attr:`vector_store_dir` as an absolute :class:`~pathlib.Path`."""
        return Path(self.vector_store_dir).expanduser().resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()

    # Make sure the vector-store root exists before any node tries to write.
    settings.vector_store_path.mkdir(parents=True, exist_ok=True)

    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    )
    return settings
