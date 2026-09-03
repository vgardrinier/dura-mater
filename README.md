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
days. On an interactive first run it asks three short questions, maps coaching
frequency to an intervention threshold, and stores the answers plainly in
`USER.md`. The whole flow takes under a minute. Non-interactive runs skip the
questions safely. `npx dura-mater install` works too.

Running the command again refreshes the sources without overwriting `USER.md` or
`VOICE.md`.

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
