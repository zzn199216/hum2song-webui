from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx
from pydantic import ValidationError

from core.models import FileType, TaskCreateResponse, TaskInfoResponse


# -----------------------------
# Exceptions (Business-level)
# -----------------------------
class Hum2SongClientError(Exception):
    """Base exception for SDK client."""


class NetworkError(Hum2SongClientError):
    """Connection/timeout/DNS issues."""


class HTTPError(Hum2SongClientError):
    """Non-2xx response from server."""

    def __init__(self, status_code: int, body: str):
        super().__init__(f"HTTP {status_code}: {body}")
        self.status_code = status_code
        self.body = body


class ContractError(Hum2SongClientError):
    """Response JSON doesn't match frozen contract."""


@dataclass(frozen=True)
class DownloadResult:
    file_type: FileType
    path: Path
    bytes_written: int


def _normalize_base_url(base_url: str) -> str:
    base = (base_url or "").strip()
    if not base:
        base = "http://127.0.0.1:8000"
    return base.rstrip("/")


def _guess_mime(path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "application/octet-stream"


class Hum2SongClient:
    """
    Contract API client (Frozen):
    - POST /generate?output_format=mp3|wav
    - GET  /tasks/{id}
    - GET  /tasks/{id}/download?file_type=audio|midi
    """

    def __init__(
        self,
        *,
        base_url: str = "http://127.0.0.1:8000",
        timeout_s: float = 30.0,
        http: Optional[httpx.Client] = None,
    ) -> None:
        self.base_url = _normalize_base_url(base_url)
        self._owns_http = http is None
        self.http = http or httpx.Client(timeout=httpx.Timeout(timeout_s))

    def close(self) -> None:
        if self._owns_http:
            self.http.close()

    # --------- core requests ---------
    def submit_task(self, audio_path: Path, *, output_format: str = "mp3") -> TaskCreateResponse:
        audio_path = Path(audio_path)
        if not audio_path.exists() or not audio_path.is_file():
            raise ValueError(f"audio_path not found: {audio_path}")

        url = f"{self.base_url}/generate"
        params = {"output_format": output_format}

        mime = _guess_mime(audio_path)
        # httpx handles multipart
        with audio_path.open("rb") as f:
            files = {"file": (audio_path.name, f, mime)}
            try:
                r = self.http.post(url, params=params, files=files)
            except (httpx.TimeoutException, httpx.NetworkError, httpx.ConnectError) as e:
                raise NetworkError(str(e)) from e

        if r.status_code != 202:
            raise HTTPError(r.status_code, r.text)

        try:
            data = r.json()
        except ValueError as e:
            raise ContractError(f"Invalid JSON in /generate response: {e}") from e

        try:
            return TaskCreateResponse.model_validate(data)
        except ValidationError as e:
            raise ContractError(f"/generate response violates contract: {e}") from e

    def get_status(self, task_id: str) -> TaskInfoResponse:
        url = f"{self.base_url}/tasks/{task_id}"
        try:
            r = self.http.get(url)
        except (httpx.TimeoutException, httpx.NetworkError, httpx.ConnectError) as e:
            raise NetworkError(str(e)) from e

        if r.status_code != 200:
            raise HTTPError(r.status_code, r.text)

        try:
            data = r.json()
        except ValueError as e:
            raise ContractError(f"Invalid JSON in /tasks response: {e}") from e

        try:
            return TaskInfoResponse.model_validate(data)
        except ValidationError as e:
            raise ContractError(f"/tasks response violates contract: {e}") from e

    def download_file(
        self,
        task_id: str,
        *,
        file_type: FileType,
        dest_path: Path,
        overwrite: bool = False,
    ) -> DownloadResult:
        dest_path = Path(dest_path)

        if dest_path.exists() and not overwrite:
            raise FileExistsError(f"Destination exists: {dest_path}")

        url = f"{self.base_url}/tasks/{task_id}/download"
        params = {"file_type": file_type.value}

        try:
            with self.http.stream("GET", url, params=params) as r:
                if r.status_code != 200:
                    # 409/404/400 should be surfaced as HTTPError
                    raise HTTPError(r.status_code, r.text)

                dest_path.parent.mkdir(parents=True, exist_ok=True)
                n = 0
                with dest_path.open("wb") as f:
                    for chunk in r.iter_bytes():
                        if chunk:
                            f.write(chunk)
                            n += len(chunk)

        except (httpx.TimeoutException, httpx.NetworkError, httpx.ConnectError) as e:
            raise NetworkError(str(e)) from e

        return DownloadResult(file_type=file_type, path=dest_path, bytes_written=n)

    # New: convenience wrapper (keeps future naming consistent with plan)
    def download_task_file(
        self,
        task_id: str,
        *,
        file_type: FileType,
        dest_path: Path,
        overwrite: bool = False,
    ) -> DownloadResult:
        return self.download_file(task_id, file_type=file_type, dest_path=dest_path, overwrite=overwrite)
