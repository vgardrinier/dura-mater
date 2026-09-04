# Dura Mater — MVP PRD

## Promise

Get the full leverage of coding agents without losing the skills and judgment to
steer them.

## First user

Terminal-based Codex and Claude Code users. Start with vibe coders: they ship
quickly, delegate heavily, and often cannot tell which parts they truly understand.

## Product loop

1. Setup asks only three questions, then tells the user to start Codex.
2. Dura Mater silently reads agent sessions and records delegation, review,
   correction, and outcomes.
3. It coaches only when a consequential decision is being accepted blindly.
4. A normal run leads with one concise, category-specific insight, never a quoted
   prompt or an aggregate score.
5. `review <category>` opens the evidence path with up to five redacted session
   prompts. `details` holds diagnostics; `share` repeats only the personal fact.
6. A rare hook question captures the user's next explicit judgment. `recall`
   tests that call later and shows the first redacted implementation action beside it.

## Installation and onboarding

```sh
npx dura-mater
```

The installer detects Codex and Claude Code. Setup never shows analytics. Local
use needs no account.

On the first interactive run, onboarding asks exactly three short questions: what
the user is working on, what they want to become great at, and how often coaching
should step in. The last answer maps to a stored intervention sensitivity and
threshold. Answers live plainly in editable `USER.md`. Non-interactive installs
skip the questions safely. An editable `VOICE.md` keeps coaching personal.

The working profile has three explicit layers: **You told me**, **I've seen**, and
**Still learning**. User statements are authoritative. Observations cite evidence
and confidence. Unconfirmed hypotheses never cause a strong intervention.

## Capture

Capture prompts, responses, tool calls, commands, file changes, approvals, user
corrections, and outcomes through native hooks. Store normalized events locally.
Missing events lower confidence; they are never invented.
Profile learning uses at most the latest 200 meaningful decisions, never raw action
volume. Generated content is written atomically to `LEARNED.md` and
`decisions.json`; it never overwrites user edits in `USER.md`.

## Coaching

The voice is a demanding human coach on the user's side: natural, personal, and
focused on the mental rep—not lectures, quizzes, or generic warnings.

Intervene only when all are true:

- the work touches a must-retain skill or a high-impact decision;
- the agent has taken meaningful action;
- the user shows weak evidence of review;
- the point has not already been raised in this session.

> Wait. Who should have access here?

Never interrupt routine delegated work. Respect coaching intensity and support
`mute`, `later`, and `never for this task`.

## Measures

Raw measures live behind `details` and obey two invariants:

`reviewed + unreviewed = important`, and `corrected <= reviewed`.

For each category, count sessions where it appeared, sessions with and without a
visible follow-up, and category-named corrections. Compare the prior seven days
when available. Never claim the agent made a decision; report only observed topics
and follow-ups.
When the user's declared craft clearly maps to a category and at least two sessions
support it, that category outranks unrelated volume.

Diagnostics include:

- agent actions accepted;
- consequential decisions reviewed;
- corrections made by the user;
- must-retain skills practiced versus delegated;
- risky actions approved without inspection;
- review depth: files opened, tests run, explanations requested;
- intervention follow-through.

`/score` reports the last 7 and 30 days, data confidence, and one next action. The
weekly recap highlights trends, a win, a risk, and one training focus. A single
“cognitive fitness” score waits until raw measures predict useful outcomes.

## Privacy

Local-first by default. No code, prompts, or session content leaves the machine
without explicit opt-in. Users can inspect, export, and delete all stored data.
Weekly email is opt-in. Secrets are redacted before storage.

## MVP scope

Build the installer, `USER.md` onboarding, editable `VOICE.md`, Codex and Claude
Code adapters, local event store, intervention engine, `/score`, and weekly recap.
Exclude browser capture, IDE plugins, teams, leaderboards, spaced repetition, and
scientific claims.

## Success after four weeks

- 70% complete setup without help.
- 40% of activated users return in week two.
- 30% use `/score` at least twice in week two.
- 25% act on at least one intervention each week.
- Under 10% mute coaching entirely.
- Users can name one decision they caught or understood because of Dura Mater.
