"""
Перевірка доступу через Hub для бота «Щиро».

Файл кладеться в bot/core/hub_access.py. Замінює щоденну вивантажку учасників:
на кожне повідомлення бот питає Hub, чи є в людини право `shchyro.access`.

Без нових залежностей: лише стандартна бібліотека. Відповідь кешується на
HUB_CACHE_TTL_SECONDS (за замовчуванням 180). Якщо Hub недоступний, повертається
None, і викликач лишає старе рішення (локальний список доступу) — так бот не
відрізає нікого через мережеву помилку.

Змінні оточення в bot/.env:
    HUB_API_URL=https://hub-two-ivory.vercel.app
    HUB_API_KEY=<ключ із розділу «Боти й меню» → «Зовнішні боти»>
    HUB_RESOURCE=shchyro.access
    HUB_CACHE_TTL_SECONDS=180
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

logger = logging.getLogger(__name__)

HUB_API_URL = os.getenv("HUB_API_URL", "").rstrip("/")
HUB_API_KEY = os.getenv("HUB_API_KEY", "")
HUB_RESOURCE = os.getenv("HUB_RESOURCE", "shchyro.access")
HUB_CACHE_TTL_SECONDS = int(os.getenv("HUB_CACHE_TTL_SECONDS", "180"))
HUB_TIMEOUT_SECONDS = float(os.getenv("HUB_TIMEOUT_SECONDS", "3"))


@dataclass
class HubAccess:
    allowed: bool
    reason: str | None = None          # no_subscription | expired | quota_exceeded | unknown_person
    offer_url: str | None = None
    valid_until: str | None = None
    plan: str | None = None
    quota_per_day: int | None = None
    used_today: int | None = None


_cache: dict[int, tuple[float, HubAccess]] = {}
_lock = threading.Lock()


def enabled() -> bool:
    return bool(HUB_API_URL and HUB_API_KEY)


def _request(method: str, path: str, params: dict | None = None, body: dict | None = None) -> dict | None:
    url = HUB_API_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Authorization": f"Bearer {HUB_API_KEY}", "Content-Type": "application/json", "User-Agent": "shchyro-bot/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=HUB_TIMEOUT_SECONDS) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        logger.warning(f"Hub {method} {path} → HTTP {e.code}")
    except Exception as e:  # мережа, таймаут, DNS
        logger.warning(f"Hub {method} {path} недоступний: {e}")
    return None


def check(user_id: int) -> HubAccess | None:
    """Чи має людина право на бота. None означає «Hub не відповів, вирішуй сам»."""
    if not enabled():
        return None
    now = time.monotonic()
    with _lock:
        hit = _cache.get(user_id)
        if hit and now - hit[0] < HUB_CACHE_TTL_SECONDS:
            return hit[1]

    data = _request("GET", "/api/v1/access", {"telegram_user_id": user_id, "resource": HUB_RESOURCE})
    if data is None or "allowed" not in data:
        return None

    quota = data.get("quota") or {}
    result = HubAccess(
        allowed=bool(data["allowed"]),
        reason=data.get("reason"),
        offer_url=data.get("offer_url"),
        valid_until=data.get("valid_until"),
        plan=data.get("plan"),
        quota_per_day=quota.get("per_day"),
        used_today=quota.get("used_today"),
    )
    with _lock:
        _cache[user_id] = (now, result)
    return result


def invalidate(user_id: int | None = None) -> None:
    with _lock:
        if user_id is None:
            _cache.clear()
        else:
            _cache.pop(user_id, None)


def report_usage(user_id: int, topic: str | None = None) -> None:
    """Фіксує факт відповіді бота (рахується у квоті). Текст діалогу не передається."""
    if not enabled():
        return
    _request("POST", "/api/v1/events", body={"telegram_user_id": user_id, "type": "usage", "payload": {"topic": topic} if topic else {}})
    invalidate(user_id)  # щоб used_today оновився при наступній перевірці


def report_start(user) -> None:
    """Повідомляє Hub, що людина натиснула /start у «Щиро» (user — telegram.User)."""
    if not enabled():
        return
    _request("POST", "/api/v1/identity", body={
        "telegram_user_id": user.id, "first_name": user.first_name,
        "last_name": user.last_name, "username": user.username, "chat_id": user.id,
    })
