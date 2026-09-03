# Dura Mater

A local prototype for tracking how much work you delegate to Codex without losing
the judgment to steer it.

## Install

```sh
npx dura-mater
```

That is the full setup. It detects local Codex and Claude Code sessions, creates
`~/.dura-mater/USER.md`, `VOICE.md`, and `sources.json`, then shows agent actions,
important decisions, review, corrections, and blind acceptance from the last seven
days. Only then may it ask one short profile question. `npx dura-mater install`
works too.

The installer never changes Codex or Claude Code settings. Data stays local.

## Earlier scoring prototype

```sh
python3 -m dura_mater /score
python3 -m dura_mater check
python3 -m dura_mater weekly
```

## Develop

```sh
npm test
npm pack --dry-run
```
