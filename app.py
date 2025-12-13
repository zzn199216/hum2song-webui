# app.py
"""
Hum2Song MVP main entry (FastAPI)

- App Factory pattern for testing & packaging
- Lifespan startup: ensure dirs + cleanup old files + prune task store
- Dev CORS: allow localhost any port (supports credentials)
- Prod CORS: MUST specify explicit origins (no wildcard with credentials)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from core.config import get_settings
from core.utils import TaskManager, cleanup_old_files, ensure_dir
from routers.generation import router as generation_router
from routers.health import router as health_router

logger = logging.getLogger("hum2song")


PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_ROOT / "static"


def _is_dev(app_env: str) -> bool:
    v = (app_env or "").strip().lower()
    return v in {"dev", "development", "local"}


def _parse_origins(raw: Optional[str]) -> list[str]:
    """
    Parse comma-separated origins string into list.
    Example: "https://a.com,https://b.com"
    """
    if not raw:
        return []
    parts = [p.strip() for p in raw.split(",")]
    return [p for p in parts if p]


@asynccontextmanager
async def lifespan(_: FastAPI):
    s = get_settings()

    # 1) Ensure directories exist
    try:
        ensure_dir(s.upload_dir)
        ensure_dir(s.output_dir)
        ensure_dir(STATIC_DIR)
    except Exception as e:
        logger.critical("Failed to create runtime dirs: %s", e)
        raise

    # 2) Cleanup old files (24h)
    try:
        removed_u = cleanup_old_files(s.upload_dir, older_than_seconds=86400)
        removed_o = cleanup_old_files(s.output_dir, older_than_seconds=86400)
        if removed_u or removed_o:
            logger.info("Startup cleanup: uploads=%s, outputs=%s", removed_u, removed_o)
    except Exception as e:
        logger.warning("Startup cleanup warning: %s", e)

    # 3) Prune old tasks in memory store (24h)
    try:
        removed_tasks = TaskManager.prune(older_than_seconds=86400)
        if removed_tasks:
            logger.info("Task prune: removed=%s", removed_tasks)
    except Exception as e:
        logger.warning("Task prune warning: %s", e)

    yield
    logger.info("Service shutting down...")


def create_app() -> FastAPI:
    # logging once (avoid duplicated handlers in reload/test)
    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        )

    s = get_settings()
    app = FastAPI(
        title="Hum2Song MVP",
        version="0.1.0",
        description="Humming -> MIDI -> Audio (MP3/WAV) MVP API",
        lifespan=lifespan,
    )

    # expose settings for debugging
    app.state.settings = s

    # ---- CORS ----
    # Dev: allow localhost any port, supports credentials
    # Prod: must specify explicit origins (CORS_ALLOW_ORIGINS)
    if _is_dev(s.app_env):
        allow_origins: list[str] = []
        allow_origin_regex = r"http://(?:localhost|127\.0\.0\.1)(?::\d+)?"
        allow_credentials = True
    else:
        allow_origins = _parse_origins(getattr(s, "cors_allow_origins", None))
        allow_origin_regex = None
        # If you don't specify explicit origins, we DISABLE credentials (safe fallback)
        allow_credentials = bool(allow_origins)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_origin_regex=allow_origin_regex,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ---- Routers ----
    app.include_router(health_router)
    app.include_router(generation_router)

    # ---- Static ----
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/", include_in_schema=False)
    def root():
        index_path = STATIC_DIR / "index.html"
        if index_path.exists():
            return FileResponse(str(index_path))
        return JSONResponse(
            {
                "service": "Hum2Song MVP",
                "docs_url": "/docs",
                "note": "static/index.html not found yet",
            }
        )

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
