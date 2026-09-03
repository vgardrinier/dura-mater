# Dura Mater

A local prototype for tracking how much work you delegate to Codex without losing
the judgment to steer it.

Run from the workspace root:

```sh
python3 -m dura_mater /score
python3 -m dura_mater check
python3 -m dura_mater weekly
python3 -m unittest discover -s tests
```

Use `--sessions-dir PATH` or `CODEX_SESSIONS_DIR` with fixtures or another Codex
installation. The MVP reads logs only; it never edits them or sends their contents
anywhere.
