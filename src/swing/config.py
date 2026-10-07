"""Configuration: config.yaml thresholds + environment secrets."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(os.environ.get("SWING_CONFIG", ROOT / "config.yaml"))

load_dotenv(ROOT / ".env", override=False)


class Cfg(dict):
    """dict with attribute access and dotted lookup: cfg.screener.price_min / cfg.get_path('a.b')."""

    def __getattr__(self, item: str) -> Any:
        try:
            v = self[item]
        except KeyError as e:
            raise AttributeError(item) from e
        return Cfg(v) if isinstance(v, dict) else v

    def get_path(self, dotted: str, default: Any = None) -> Any:
        cur: Any = self
        for part in dotted.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur


def _coerce_numbers(obj: Any) -> Any:
    """YAML 1.1 reads 2.0e9 as str in some loaders; make sure numerics are numeric."""
    if isinstance(obj, dict):
        return {k: _coerce_numbers(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_coerce_numbers(v) for v in obj]
    if isinstance(obj, str):
        try:
            if any(c in obj for c in ".eE") and obj.replace("_", "").replace(".", "").replace("e", "").replace(
                "E", ""
            ).replace("-", "").replace("+", "").isdigit():
                return float(obj.replace("_", ""))
        except ValueError:
            pass
    return obj


@lru_cache(maxsize=1)
def load_config(path: Path | None = None) -> Cfg:
    p = path or CONFIG_PATH
    with open(p, encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    return Cfg(_coerce_numbers(raw))


def env(name: str, default: str | None = None, required: bool = False) -> str | None:
    v = os.environ.get(name, default)
    if required and not v:
        raise RuntimeError(f"Missing required environment variable {name}")
    return v or None


def has_env(*names: str) -> bool:
    return all(os.environ.get(n) for n in names)


def ensure_dirs(cfg: Cfg) -> dict[str, Path]:
    out: dict[str, Path] = {}
    for key in ("state_dir", "out_dir", "cache_dir"):
        p = ROOT / cfg.paths[key]
        p.mkdir(parents=True, exist_ok=True)
        out[key] = p
    return out
