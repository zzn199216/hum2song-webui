# app.py
"""
Hum2Song MVP main entry (FastAPI)

- App Factory pattern for testing & packaging
- Lifespan startup: ensure dirs + cleanup old files + prune task store
- Dev CORS: allow localhost any port (supports credentials)
- Prod CORS: MUST specify explicit origins (no wildcard with credentials)
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from core.config import Settings, get_settings
from core.utils import TaskManager, cleanup_old_files, ensure_dir
from routers.generation import router as generation_router
from routers.health import router as health_router

from routers.export import router as export_router
from routers.score import router as score_router

logger = logging.getLogger("hum2song")


PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_ROOT / "static"
SAMPLER_STATIC_PREFIX = "pianoroll/vendor/tonejs-instruments/samples/"
SAMPLER_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800"
MODEL_STATIC_PREFIX = "pianoroll/vendor/yamnet-v1/"
ORT_STATIC_PREFIX = "pianoroll/vendor/onnxruntime-web/"
VERSIONED_MODEL_CACHE_CONTROL = "public, max-age=31536000, immutable"


class StudioStaticFiles(StaticFiles):
    """Static serving policy for immutable-in-practice bundled sample files.

    Keep the browser cache bounded to one day until sample URLs are content-hashed;
    stale-while-revalidate avoids blocking a later session on validation.
    """

    async def get_response(self, path: str, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        normalized = path.replace("\\", "/").lower()
        if normalized.endswith(".mjs"):
            # ORT loads its WASM backend through a dynamic module import.  A
            # text/plain response makes Chromium reject that import before the
            # runtime can initialize.
            response.headers["Content-Type"] = "text/javascript; charset=utf-8"
        if (normalized.startswith(MODEL_STATIC_PREFIX) and normalized.endswith((".onnx", ".csv"))) or (
            normalized.startswith(ORT_STATIC_PREFIX) and normalized.endswith((".js", ".wasm"))
        ):
            response.headers["Cache-Control"] = VERSIONED_MODEL_CACHE_CONTROL
        if normalized.startswith(SAMPLER_STATIC_PREFIX) and normalized.endswith((".mp3", ".ogg", ".wav")):
            response.headers["Cache-Control"] = SAMPLER_CACHE_CONTROL
        return response


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


def _studio_public_config_script(settings: Settings) -> str:
    origins_json = json.dumps(
        settings.cloud_parent_origin_list,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return (
        "<script>\n"
        f"window.H2S_CLOUD_PARENT_ORIGINS = {origins_json};\n"
        "</script>"
    )


def _render_studio_index(index_path: Path, settings: Settings) -> HTMLResponse:
    html = index_path.read_text(encoding="utf-8")
    script = _studio_public_config_script(settings)
    marker = "  <script>\n  (function () {\n    function localCloudParentOrigins() {"
    if marker in html:
        html = html.replace(marker, script + "\n" + marker, 1)
    else:
        html = html.replace("</body>", script + "\n</body>", 1)
    return HTMLResponse(html)


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

    # 4) Optional Basic Pitch / TF stack warmup (off by default; avoids first-request cold load)
    if os.getenv("H2S_BASIC_PITCH_WARMUP", "").strip().lower() in ("1", "true", "yes", "on"):
        try:
            from core.ai_converter import warmup_basic_pitch

            warmup_basic_pitch()
        except Exception as e:
            logger.warning("Basic Pitch warmup skipped: %s", e)

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
        allow_origins = getattr(s, "cors_allow_origin_list", _parse_origins(getattr(s, "cors_allow_origins", None)))
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
    app.include_router(score_router)
    app.include_router(export_router)

    # ---- Static ----
    app.mount("/static", StudioStaticFiles(directory=str(STATIC_DIR)), name="static")

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
    
    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        icon_path = STATIC_DIR / "favicon.ico"
        if icon_path.exists():
            return FileResponse(str(icon_path))
        return Response(status_code=204)
    
    @app.get("/ui", include_in_schema=False)
    @app.get("/ui/", include_in_schema=False)
    def ui():
        ui_path = STATIC_DIR / "pianoroll" / "index.html"
        if ui_path.exists():
            return _render_studio_index(ui_path, s)
        return JSONResponse(
            {"detail": "UI not found. Create static/pianoroll/index.html first."},
            status_code=404,
        )
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
