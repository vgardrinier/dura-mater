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

First setup asks three questions, shows no analytics, then tells you to start
Codex. Later runs prefer the category closest to the craft named in `USER.md`, when
there is enough evidence. They show where it appeared, which sessions had a visible
follow-up, and which did not. Raw source diagnostics are
available only through:

```sh
node ./bin/dura-mater.js details
```

Create a compact terminal card with:

```sh
node ./bin/dura-mater.js share
```

After a recall, the card shows that result and its topic. Before the first
recall, it falls back to the weekly personal fact.

Open up to five recent sessions behind an insight:

```sh
node ./bin/dura-mater.js review architecture
```

The list contains a date and a short, locally redacted prompt. It never prints more
than five sessions.

Running the command again refreshes the sources without overwriting `USER.md` or
`VOICE.md`.

`USER.md` contains what you said. Machine-made observations and open hypotheses
live separately in `LEARNED.md`, with evidence and confidence. Dura Mater reads at
most the latest 200 meaningful decisions. Unconfirmed ideas cannot trigger a
strong intervention.

Inspect or remove learned topics:

```sh
node ./bin/dura-mater.js profile
node ./bin/dura-mater.js forget data
```

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

If `USER.md` says security is part of the craft, the first matching tool handoff
asks for your rule. Reply in your next Codex message. Dura Mater stores that call
locally, along with a short redacted note of the tool handoff.

Test the judgment later:

```sh
node ./bin/dura-mater.js recall
```

The hook cannot open a form or stop Codex to collect a reply. It can only ask and
observe the next user prompt. If you answer `continue`, nothing is saved. Recall
uses a conservative word match; uncertain answers are shown as different.

Remove only the files Dura Mater installed:

```sh
node ./bin/dura-mater.js uninstall --project "/absolute/path/to/test-project"
```

The hook is project-local in `.codex/hooks.json`; it never edits `~/.codex`.
Installation adds only those generated paths to the repository's local
`.git/info/exclude`, so `git status` stays clean. Uninstall removes both files and
only Dura Mater's exclude block. Existing hook files are never overwritten.
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
