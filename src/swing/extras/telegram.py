"""Optional Telegram push (free). Enabled when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
Used for actionable intraday alerts and a one-message nightly summary; Notion remains the full record."""

from __future__ import annotations

import logging
from pathlib import Path

import httpx

from swing.config import env
from swing.models import Alert, DailyBrief

log = logging.getLogger(__name__)


def available() -> bool:
    return bool(env("TELEGRAM_BOT_TOKEN") and env("TELEGRAM_CHAT_ID"))


def _api(method: str) -> str:
    return f"https://api.telegram.org/bot{env('TELEGRAM_BOT_TOKEN')}/{method}"


def send_text(text: str) -> bool:
    if not available():
        return False
    try:
        r = httpx.post(_api("sendMessage"), data={"chat_id": env("TELEGRAM_CHAT_ID"), "text": text[:4000], "disable_web_page_preview": True}, timeout=20)
        return r.status_code == 200
    except Exception as e:  # noqa: BLE001
        log.warning("telegram sendMessage failed: %s", e)
        return False


def send_photo(path: str | Path, caption: str = "") -> bool:
    if not available() or not Path(path).exists():
        return False
    try:
        with open(path, "rb") as f:
            r = httpx.post(_api("sendPhoto"), data={"chat_id": env("TELEGRAM_CHAT_ID"), "caption": caption[:1000]}, files={"photo": f}, timeout=60)
        return r.status_code == 200
    except Exception as e:  # noqa: BLE001
        log.warning("telegram sendPhoto failed: %s", e)
        return False


def push_alerts(alerts: list[Alert]) -> None:
    for a in alerts:
        if a.actionable:
            send_text(f"[{a.ts:%H:%M}] {a.message}")


def push_nightly(brief: DailyBrief) -> None:
    if not available():
        return
    r = brief.regime
    head = f"Nightly {brief.date}: {len(brief.plans)} plans | sizing {r.sizing if r else 'n/a'}"
    if brief.prose:
        head += f"\n{brief.prose.headline}"
    send_text(head)
    for p in brief.plans[:5]:
        send_text(p.card_text())
        if p.chart_paths.get("daily"):
            send_photo(p.chart_paths["daily"], f"{p.symbol} daily")
