"""Read Codex sessions and derive transparent fitness signals."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

REVIEW_WORDS = ("why", "explain", "verify", "check", "test", "wrong", "instead", "review", "sure", "risk")
RISK_WORDS = ("auth", "security", "database", "migration", "deploy", "production", "delete", "payment", "permission", "architecture")
ACTION_NAMES = {"exec_command", "apply_patch", "write_stdin"}


@dataclass
class Session:
    path: Path
    timestamp: datetime
    title: str
    actions: int
    consequential: int
    reviews: int

    @property
    def needs_check(self) -> bool:
        return self.consequential > 0 and self.actions >= 2 and self.reviews == 0


def _text(payload: dict) -> str:
    if isinstance(payload.get("message"), str):
        return payload["message"]
    bits = []
    for item in payload.get("content", []):
        if isinstance(item, dict):
            bits.append(str(item.get("text", "")))
    return " ".join(bits)


def parse_session(path: Path) -> Session | None:
    timestamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
    title = path.stem
    actions = consequential = reviews = 0
    user_messages: list[str] = []
    try:
        for line in path.read_text(errors="replace").splitlines():
            row = json.loads(line)
            payload = row.get("payload", {})
            kind = payload.get("type")
            if row.get("type") == "session_meta":
                raw = payload.get("timestamp")
                if raw:
                    timestamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if kind == "user_message":
                text = _text(payload).strip()
                if text:
                    user_messages.append(text)
                    if len(user_messages) == 1:
                        title = text.replace("\n", " ")[:64]
                    elif any(word in text.lower() for word in REVIEW_WORDS):
                        reviews += 1
            if kind == "function_call":
                name = payload.get("name", "")
                if name in ACTION_NAMES or "tool" in name or "exec" in name:
                    actions += 1
                blob = json.dumps(payload, ensure_ascii=False).lower()
                if any(word in blob for word in RISK_WORDS):
                    consequential += 1
    except (OSError, json.JSONDecodeError):
        return None
    return Session(path, timestamp, title, actions, consequential, reviews)


def load_sessions(root: Path, days: int = 7, now: datetime | None = None) -> list[Session]:
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    sessions = (parse_session(path) for path in root.rglob("*.jsonl"))
    return sorted((s for s in sessions if s and s.timestamp >= cutoff), key=lambda s: s.timestamp)


def score(sessions: Iterable[Session]) -> dict:
    rows = list(sessions)
    actions = sum(s.actions for s in rows)
    consequential = sum(s.consequential for s in rows)
    reviews = sum(s.reviews for s in rows)
    exposed = sum(1 for s in rows if s.needs_check)
    leverage = min(100, round(20 + actions * 3)) if rows else 0
    control = 100 if consequential == 0 else min(100, round(100 * reviews / max(1, consequential)))
    fitness = 0 if not rows else round(0.45 * leverage + 0.55 * control)
    return {"fitness": fitness, "leverage": leverage, "control": control,
            "sessions": len(rows), "actions": actions, "reviews": reviews,
            "unreviewed": exposed}


def intervention(session: Session | None) -> str | None:
    if not session or not session.needs_check:
        return None
    return f'Before you move on: what is the most important decision the agent made in “{session.title}”?'
