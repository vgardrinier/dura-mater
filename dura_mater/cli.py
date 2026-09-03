from __future__ import annotations

import argparse
import os
from pathlib import Path

from .core import intervention, load_sessions, score


def _root(value: str | None) -> Path:
    return Path(value or os.environ.get("CODEX_SESSIONS_DIR", Path.home() / ".codex" / "sessions"))


def _advice(stats: dict) -> str:
    if stats["unreviewed"]:
        return "Today: review one important agent decision before shipping."
    if stats["leverage"] < 50:
        return "Today: delegate one routine task and save your attention for judgment."
    return "You are balancing delegation and review well."


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dura-mater")
    parser.add_argument("command", choices=["/score", "score", "check", "weekly"])
    parser.add_argument("--sessions-dir")
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args(argv)
    sessions = load_sessions(_root(args.sessions_dir), args.days)
    stats = score(sessions)

    if args.command in ("/score", "score"):
        print(f"Dura Mater: {stats['fitness']}/100")
        print(f"Leverage {stats['leverage']} · Control {stats['control']}")
        print(f"{stats['sessions']} sessions · {stats['unreviewed']} important sessions not reviewed")
        print(_advice(stats))
    elif args.command == "check":
        prompt = intervention(sessions[-1] if sessions else None)
        if prompt:
            print(prompt)
    else:
        print("Your week with AI")
        print(f"Dura Mater: {stats['fitness']}/100")
        print(f"You used agents across {stats['sessions']} sessions and {stats['actions']} actions.")
        print(f"You showed active judgment {stats['reviews']} times.")
        print(_advice(stats))
    return 0
