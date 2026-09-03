#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const IMPORTANT = /\b(auth(?:entication|orization)?|security|permissions?|database|migration|schema|deploy|production|delete|payment|architecture)\b/i;
const THOUGHT = /\b(because|tradeoff|I think|I prefer|my plan|should|must|constraint|first I|do not)\b/i;
const DELEGATION = /\b(build|change|implement|fix|design|choose|decide|add|remove|deploy|refactor)\b/i;

function profileTokens(text) {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter((word) => !["working", "becoming", "great", "coaching", "intervention", "threshold", "sensitivity", "only", "when", "really", "matters", "normal"].includes(word)))];
}

function statePath(event) {
  const key = crypto.createHash("sha256").update(`${event.cwd || ""}:${event.session_id || "unknown"}`).digest("hex").slice(0, 20);
  return path.join(os.tmpdir(), `dura-mater-${key}.json`);
}

function main(event, home = process.env.DURA_MATER_HOME || path.join(os.homedir(), ".dura-mater")) {
  const file = statePath(event);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  if (event.hook_event_name === "SessionEnd") {
    try { fs.unlinkSync(file); } catch {}
    return null;
  }
  if (event.hook_event_name === "UserPromptSubmit") {
    let profile = "";
    try { profile = fs.readFileSync(path.join(home, "USER.md"), "utf8"); } catch { return null; }
    const prompt = event.prompt || "";
    const intersects = profileTokens(profile).some((token) => prompt.toLowerCase().includes(token))
      || (IMPORTANT.test(profile) && IMPORTANT.test(prompt));
    state.pending = DELEGATION.test(prompt) && intersects && !THOUGHT.test(prompt);
    fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
    return null;
  }
  if (event.hook_event_name === "PreToolUse" && state.pending && !state.intervened) {
    state.intervened = true;
    fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
    return { systemMessage: "Hang on. What's your call here before the agent makes it?" };
  }
  return null;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const result = main(JSON.parse(input || "{}"));
    if (result) process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(`Dura Mater hook skipped: ${error.message}\n`);
  }
});
