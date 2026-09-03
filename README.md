# Dura Mater

A local prototype for tracking how much work you delegate to Codex without losing
the judgment to steer it.

## Run the local build in Terminal.app

```sh
cd "/Users/victorgardrinier/Desktop/Victor 2030/agency_fitness"
node ./bin/dura-mater.js
```

After the package is published, the command will be:

```sh
npx dura-mater
```

It detects local Codex and Claude Code sessions, keeps their results separate,
and shows an honest combined sum. It creates
`~/.dura-mater/USER.md`, `VOICE.md`, and `sources.json`, then shows agent actions,
important decisions, review, corrections, and blind acceptance from the last seven
days. On an interactive first run it asks three short questions, maps coaching
frequency to an intervention threshold, and stores the answers plainly in
`USER.md`. The whole flow takes under a minute. Non-interactive runs skip the
questions safely. `npx dura-mater install` will work too.

Running the command again refreshes the sources without overwriting `USER.md` or
`VOICE.md`.

If setup was interrupted, run the same command again. Dura Mater notices the
unfinished `USER.md` and resumes. To answer setup again without deleting data:

```sh
node ./bin/dura-mater.js setup
```

## Dogfood the Codex hook in one project

From this repository:

```sh
node ./bin/dura-mater.js --project "/absolute/path/to/test-project"
cd "/absolute/path/to/test-project"
codex
```

Review and trust the project hook when Codex asks. Then try:

> Implement the authentication flow for me.

On the first matching tool handoff, Dura Mater should say: “Hang on. What's your
call here before the agent makes it?” It stays quiet for the rest of that session.

Remove only the files Dura Mater installed:

```sh
node ./bin/dura-mater.js uninstall --project "/absolute/path/to/test-project"
```

The hook is project-local in `.codex/hooks.json`; it never edits `~/.codex`.
Codex requires project hooks to be reviewed and trusted. See the
[official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks).

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
