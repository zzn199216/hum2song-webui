import pytest
from fastapi.testclient import TestClient

from app import create_app
from core.config import get_settings


@pytest.fixture
def client(monkeypatch, tmp_path):
    temp_upload = tmp_path / "uploads"
    temp_output = tmp_path / "outputs"

    monkeypatch.setenv("UPLOAD_DIR", str(temp_upload))
    monkeypatch.setenv("OUTPUT_DIR", str(temp_output))

    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def test_app_root(client):
    response = client.get("/")
    assert response.status_code == 200
    if response.headers["content-type"] == "application/json":
        assert response.json()["status"] == "ok"


def test_docs_exist(client):
    response = client.get("/docs")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_health_endpoint(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True


def test_bundled_sampler_assets_have_explicit_browser_cache_policy(client):
    response = client.get(
        "/static/pianoroll/vendor/tonejs-instruments/samples/piano/A4.mp3"
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == (
        "public, max-age=86400, stale-while-revalidate=604800"
    )


def test_unversioned_studio_scripts_do_not_inherit_sampler_cache_policy(client):
    response = client.get("/static/pianoroll/app.js")
    assert response.status_code == 200
    assert response.headers.get("cache-control") != (
        "public, max-age=86400, stale-while-revalidate=604800"
    )


def test_content_hashed_startup_bundle_cache(monkeypatch, tmp_path):
    import asyncio
    from app import StudioStaticFiles
    assets = tmp_path / "pianoroll"
    assets.mkdir()
    (assets / "startup-0123456789abcdef.js").write_text("void 0;", encoding="utf-8")
    static = StudioStaticFiles(directory=str(tmp_path))
    scope = {"type": "http", "method": "GET", "headers": []}
    response = asyncio.run(static.get_response("pianoroll/startup-0123456789abcdef.js", scope))
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_ui_always_revalidates_release_entrypoint(client):
    assert client.get("/ui").headers["cache-control"] == "no-cache"


def test_production_cors_uses_explicit_config(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path / "outputs"))
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://cloud.example")
    get_settings.cache_clear()
    try:
        app = create_app()
        with TestClient(app) as c:
            allowed = c.options(
                "/api/v1/health",
                headers={
                    "Origin": "https://cloud.example",
                    "Access-Control-Request-Method": "GET",
                },
            )
            denied = c.options(
                "/api/v1/health",
                headers={
                    "Origin": "https://other.example",
                    "Access-Control-Request-Method": "GET",
                },
            )
        assert allowed.headers.get("access-control-allow-origin") == "https://cloud.example"
        assert "access-control-allow-origin" not in denied.headers
    finally:
        get_settings.cache_clear()


def test_ui_injects_safe_cloud_parent_origins(monkeypatch, tmp_path):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path / "outputs"))
    monkeypatch.setenv(
        "H2S_CLOUD_PARENT_ORIGINS",
        ",".join(
            [
                "https://hum2song.cn",
                "https://www.hum2song.cn",
                "https://hum2song.com",
                "https://www.hum2song.com",
                "https://*.hum2song.com",
                "https://hum2song.com/path",
            ]
        ),
    )
    monkeypatch.setenv("H2S_TEST_SECRET_TOKEN", "do-not-inject-secret-value")
    get_settings.cache_clear()
    try:
        app = create_app()
        with TestClient(app) as c:
            response = c.get("/ui")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        html = response.text
        assert "window.H2S_CLOUD_PARENT_ORIGINS" in html
        assert (
            'window.H2S_CLOUD_PARENT_ORIGINS = ["https://hum2song.cn",'
            '"https://www.hum2song.cn","https://hum2song.com",'
            '"https://www.hum2song.com"];'
        ) in html
        assert "https://*.hum2song.com" not in html
        assert "https://hum2song.com/path" not in html
        assert "do-not-inject-secret-value" not in html
        assert "H2S_TEST_SECRET_TOKEN" not in html
    finally:
        get_settings.cache_clear()
