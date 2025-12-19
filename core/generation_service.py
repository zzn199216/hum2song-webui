from __future__ import annotations

import importlib
import inspect
import logging
import shutil
import time
from pathlib import Path
from typing import Callable, Optional, Union
from uuid import UUID

from core.models import FileType, Stage
from core.task_manager import TaskManager, task_manager as default_task_manager

# 尝试导入配置，如果没有则使用默认值
try:
    from core.config import settings  # type: ignore
except Exception:
    settings = None

logger = logging.getLogger("hum2song.worker")


RunnerFn = Callable[[Path, str], Path]


def _resolve_storage_dir() -> Path:
    """Best-effort 寻找合适的存储目录"""
    base: Optional[Path] = None
    if settings:
        for name in ("data_dir", "work_dir", "output_dir", "temp_dir", "tmp_dir", "workspace_dir"):
            p = getattr(settings, name, None)
            if p:
                base = Path(p)
                break
    if base is None:
        base = Path("data")
    base.mkdir(parents=True, exist_ok=True)
    return base


def _resolve_outputs_dir_fallback() -> Path:
    """
    Best-effort resolve outputs directory used by pipeline.
    Prefer core.config.get_settings().output_dir if available.
    """
    try:
        from core.config import get_settings  # type: ignore

        s = get_settings()
        out = Path(getattr(s, "output_dir", "outputs"))
        out.mkdir(parents=True, exist_ok=True)
        return out
    except Exception:
        out = Path("outputs")
        out.mkdir(parents=True, exist_ok=True)
        return out


def _adapt_runner(obj: Callable[..., object]) -> RunnerFn:
    """
    把各种可能的 pipeline callable 适配成统一签名：
        (input_path: Path, output_format: str) -> Path
    优先尝试关键字参数，再降级到位置参数。
    """
    sig = None
    try:
        sig = inspect.signature(obj)
    except Exception:
        sig = None

    def _call(input_path: Path, output_format: str) -> Path:
        # Prefer keyword call if possible
        try:
            if sig and ("input_path" in sig.parameters or "audio_path" in sig.parameters):
                kw = {}
                if "input_path" in (sig.parameters if sig else {}):
                    kw["input_path"] = input_path
                elif "audio_path" in (sig.parameters if sig else {}):
                    kw["audio_path"] = input_path

                # output format param name variants
                if sig and "output_format" in sig.parameters:
                    kw["output_format"] = output_format
                elif sig and "format" in sig.parameters:
                    kw["format"] = output_format
                elif sig and "out_format" in sig.parameters:
                    kw["out_format"] = output_format

                res = obj(**kw)  # type: ignore[arg-type]
                return Path(res)

        except TypeError:
            pass

        # Fallbacks
        try:
            res = obj(input_path=input_path, output_format=output_format)  # type: ignore[misc]
            return Path(res)
        except TypeError:
            pass

        try:
            res = obj(input_path, output_format=output_format)  # type: ignore[misc]
            return Path(res)
        except TypeError:
            pass

        res = obj(input_path, output_format)  # type: ignore[misc]
        return Path(res)

    return _call


class GenerationService:
    """
    Service Layer: 负责协调任务执行。

    特性:
    1) 动态加载（惰性）: 自动检测 core.pipeline；失败则回退 Mock
    2) 状态管理: 全程接管 TaskManager 状态流转（严格方法调用）
    3) 资源清理: 自动清理输入文件
    4) 可测试: 可注入 task_manager / runner / base_dir
    """

    def __init__(
        self,
        *,
        task_manager: TaskManager = default_task_manager,
        base_dir: Optional[Union[str, Path]] = None,
        runner: Optional[RunnerFn] = None,
    ) -> None:
        self.task_manager = task_manager

        self.base_dir = Path(base_dir) if base_dir is not None else _resolve_storage_dir()
        self.upload_dir = self.base_dir / "uploads"
        self.artifact_dir = self.base_dir / "artifacts"
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.artifact_dir.mkdir(parents=True, exist_ok=True)

        # ✅ expose outputs_dir for routers (midi download uses it if present)
        self.outputs_dir = _resolve_outputs_dir_fallback()
        # keep compatibility with router's fallback attribute name
        self.output_dir = self.outputs_dir

        # runner 惰性加载：如果传入就用，否则第一次任务再加载真实 pipeline / mock
        self._runner: Optional[RunnerFn] = runner

    def set_runner(self, runner: RunnerFn) -> None:
        """For tests or overrides."""
        self._runner = runner

    def _load_pipeline_runner(self) -> RunnerFn:
        """
        尝试动态加载真实 AI Pipeline。
        如果找不到 core.pipeline 模块，则回退到 Mock 模式。
        """
        try:
            pipeline_mod = importlib.import_module("core.pipeline")

            # 策略 A: run_pipeline 函数
            fn = getattr(pipeline_mod, "run_pipeline", None)
            if callable(fn):
                logger.info("✅ Found real AI pipeline: run_pipeline()")
                return _adapt_runner(fn)

            # 策略 B: Pipeline 类
            cls = getattr(pipeline_mod, "Pipeline", None)
            if cls is not None:
                logger.info("✅ Found real AI pipeline: class Pipeline")
                obj = cls()
                if hasattr(obj, "run") and callable(getattr(obj, "run")):
                    return _adapt_runner(obj.run)

            # 策略 C: GenerationPipeline 类
            cls2 = getattr(pipeline_mod, "GenerationPipeline", None)
            if cls2 is not None:
                logger.info("✅ Found real AI pipeline: class GenerationPipeline")
                obj2 = cls2()
                if hasattr(obj2, "run") and callable(getattr(obj2, "run")):
                    return _adapt_runner(obj2.run)

        except ImportError:
            pass
        except Exception as e:
            logger.warning(f"⚠️ Error loading core.pipeline: {e}")

        logger.warning("⚠️ core.pipeline not found (or incompatible). Using MOCK runner.")
        return self._mock_pipeline_runner

    def _get_runner(self) -> RunnerFn:
        if self._runner is None:
            self._runner = self._load_pipeline_runner()
        return self._runner

    def process_task(self, task_id: UUID, input_path: Path, output_format: str = "mp3") -> None:
        """
        Worker 主入口（BackgroundTasks 调用）。
        """
        logger.info(f"🚀 [Start] Task {task_id} processing...")

        current_stage = Stage.preprocessing
        try:
            if not input_path.exists():
                raise FileNotFoundError(f"Input file missing: {input_path}")

            # 1) 标记开始
            self.task_manager.mark_running(task_id, stage=Stage.preprocessing)
            self.task_manager.update_progress(task_id, progress=0.1, stage=Stage.preprocessing)

            # 2) 执行 Pipeline
            current_stage = Stage.converting
            self.task_manager.update_progress(task_id, progress=0.4, stage=current_stage)

            runner = self._get_runner()
            output_path = runner(input_path, output_format)

            if not isinstance(output_path, Path):
                output_path = Path(output_path)

            if not output_path.exists():
                raise FileNotFoundError(f"Pipeline finished but output file missing: {output_path}")

            # 3) move 到 artifacts（命名规范化）
            current_stage = Stage.synthesizing
            self.task_manager.update_progress(task_id, progress=0.8, stage=current_stage)

            final_path = (self.artifact_dir / f"{task_id}.{output_format}").resolve()
            if output_path.resolve() != final_path:
                final_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(output_path), str(final_path))

            # 4) 标记完成（TaskManager 会把 progress=1.0 + stage=finalizing）
            self.task_manager.mark_completed(
                task_id,
                artifact_path=final_path,
                file_type=FileType.audio,
                output_format=None,  # 让 Manager 自动推断
            )
            logger.info(f"✅ [Done] Task {task_id} finished.")

        except Exception as e:
            logger.error(f"❌ [Fail] Task {task_id} failed: {e}", exc_info=True)
            try:
                self.task_manager.mark_failed(task_id, message=str(e), stage=current_stage)
            except Exception:
                pass

        finally:
            # 5) 清理上传源文件
            try:
                if input_path.exists():
                    input_path.unlink()
                    logger.debug(f"🧹 Cleaned up input: {input_path}")
            except Exception as e:
                logger.warning(f"Failed to cleanup input {input_path}: {e}")

    # ----------------------------------------------------------------
    # MOCK implementation (当没有 core.pipeline 时使用)
    # ----------------------------------------------------------------
    def _mock_pipeline_runner(self, input_path: Path, output_format: str = "mp3") -> Path:
        """
        模拟 AI 处理流程：生成一个临时输出文件，交由 process_task 移动到 artifacts。
        """
        # 模拟耗时
        time.sleep(0.05)

        # 生成假文件（放在 base_dir 下，避免跑到项目根目录）
        temp_out = (self.base_dir / f"temp_{input_path.stem}.{output_format}").resolve()
        temp_out.parent.mkdir(parents=True, exist_ok=True)

        with open(temp_out, "wb") as f:
            f.write(b"RIFF" if output_format == "wav" else b"ID3")
            f.write(b"\x00" * 1024)  # small dummy data

        return temp_out


# 单例导出（生产使用）
generation_service = GenerationService()
