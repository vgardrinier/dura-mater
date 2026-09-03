# Dura Mater — MVP PRD

## Promise

Use AI at full speed without losing the judgment to steer it.

## User

A frequent Codex user who delegates meaningful work and wants to stay capable of
reviewing it.

## Loop

1. Read local Codex session logs. Nothing leaves the machine.
2. Estimate leverage and evidence of judgment from observable behavior.
3. `/score` gives one number, its drivers, and one useful next action.
4. A proactive check speaks only after consequential work with weak review.
5. `weekly` creates an email-ready recap.

## Signals in V1

- Leverage: agent tool calls and completed sessions.
- Consequence: shell commands, file changes, approvals, and risk words.
- Judgment: user follow-ups that question, verify, correct, or redirect the agent.
- Blind acceptance: consequential sessions with no later evidence of review.

The score is directional, not a measure of intelligence. It must always explain
why it changed.

## Commands

```sh
python3 -m dura_mater /score
python3 -m dura_mater check
python3 -m dura_mater weekly
```

## Intervention rule

Speak only when a session is consequential, has at least two agent actions, and
has no evidence of user review. Never emit more than one prompt per session.

## Success after two weeks

- At least 40% of active users request `/score` three times in week two.
- At least 30% act on a suggested review.
- Fewer than 10% mute proactive checks.

## Not in V1

Universal capture, quizzes, skill graphs, leaderboards, or a scientifically
validated cognitive score. Add another agent only after this loop earns repeat use.
