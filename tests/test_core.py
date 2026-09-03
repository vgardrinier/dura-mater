import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from dura_mater.core import intervention, load_sessions, score


class CoreTest(unittest.TestCase):
    def write_session(self, root: Path, reviewed: bool = False) -> None:
        rows = [
            {"type": "session_meta", "payload": {"timestamp": "2026-09-03T08:00:00Z"}},
            {"type": "event_msg", "payload": {"type": "user_message", "message": "Change the payment database"}},
            {"type": "response_item", "payload": {"type": "function_call", "name": "exec_command", "arguments": "database migration"}},
            {"type": "response_item", "payload": {"type": "function_call", "name": "apply_patch", "arguments": "payment schema"}},
        ]
        if reviewed:
            rows.append({"type": "event_msg", "payload": {"type": "user_message", "message": "Verify why this is safe"}})
        (root / "one.jsonl").write_text("\n".join(json.dumps(r) for r in rows))

    def test_flags_consequential_unreviewed_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_session(Path(tmp))
            sessions = load_sessions(Path(tmp), now=datetime(2026, 9, 3, tzinfo=timezone.utc))
            self.assertEqual(len(sessions), 1)
            self.assertIsNotNone(intervention(sessions[0]))
            self.assertEqual(score(sessions)["unreviewed"], 1)

    def test_review_suppresses_intervention(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_session(Path(tmp), reviewed=True)
            sessions = load_sessions(Path(tmp), now=datetime(2026, 9, 3, tzinfo=timezone.utc))
            self.assertIsNone(intervention(sessions[0]))


if __name__ == "__main__":
    unittest.main()
