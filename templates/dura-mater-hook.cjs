#!/usr/bin/env node
// dura-mater-managed:v2
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const IMPORTANT = /\b(auth(?:entication|orization)?|security|permissions?|database|migration|schema|deploy|production|delete|payment|architecture)\b/i;
const THOUGHT = /\b(because|tradeoff|I think|I prefer|my plan|should|must|constraint|first I|do not)\b/i;
const DELEGATION = /\b(build|change|implement|fix|design|choose|decide|add|remove|delete|deploy|refactor|invite|migrate)\b/i;
const BROAD_CRAFT = /\b(system design|product|building|engineering|architecture)\b/i;
const CONSEQUENTIAL = /\b(oauth|log[ -]?in|email|invite|admin|permissions?|migration|schema|delete|payment|architecture|boundary|auth(?:entication|orization)?|security|database|deploy|production)\b/i;

function profileTokens(text) {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter((word) => !["working", "becoming", "great", "coaching", "intervention", "threshold", "sensitivity", "only", "when", "really", "matters", "normal"].includes(word)))];
}

function statedField(profile, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return profile.match(new RegExp(`^###? ${escaped}\\s*\\n+\\s*([^\\n]+)`, "mi"))?.[1]?.trim() || "";
}

function promptCategory(prompt) {
  if (/\b(auth(?:entication|orization)?|security|permissions?|access)\b/i.test(prompt)) return "access";
  if (/\b(database|migration|schema|data model)\b/i.test(prompt)) return "data";
  if (/\b(architecture|interface|system design)\b/i.test(prompt)) return "architecture";
  return "decision";
}

function challenge(prompt, category) {
  if (/\b(invite|admin|permissions?)\b/i.test(prompt)) return "Wait. Who can grant access to whom? Tell me your rule.";
  if (/\b(migration|schema)\b/i.test(prompt)) return "Hold on. What must never be lost in this migration? Tell me.";
  if (/\bdelete|remove|destroy\b/i.test(prompt)) return "Wait. What has to be recoverable? Tell me.";
  if (/\bpayment|billing|charge|checkout\b/i.test(prompt)) return "Hold on. What happens if payment succeeds but the app times out? Tell me.";
  if (/\b(oauth|log[ -]?in|email)\b/i.test(prompt)) return "Wait. What happens if this email already belongs to an account? Tell me.";
  if (/\b(architecture|boundary|interface|system design)\b/i.test(prompt)) return "Okay, your call. What's the boundary you don't want crossed? Tell me.";
  if (category === "access") return "Wait. Who can grant access to whom? Tell me your rule.";
  return "Wait. What would you do here? Tell me.";
}

function clean(text, limit = 180) {
  return String(text || "")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, "$1=[secret]")
    .replace(/\s+/g, " ").trim().slice(0, limit);
}

function implementation(event) {
  const input = event.tool_input || {};
  if (event.tool_name === "apply_patch") {
    const files = [...String(input.command || "").matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => path.basename(match[1])).slice(0, 3);
    return files.length ? `edited ${files.join(", ")}` : "edited code";
  }
  if (event.tool_name === "Bash") return clean(input.command, 120);
  return clean(input.path || input.file_path || event.tool_name || "", 120);
}

function judgmentFile(home) { return path.join(home, "judgments.jsonl"); }

function saveJudgment(home, state, event) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const record = {
    id: crypto.randomUUID(),
    sessionId: event.session_id || "unknown",
    category: state.category,
    question: state.challenge.replace(/ Tell me(?: your rule)?\.$/, ""),
    answer: clean(event.prompt, 500),
    implementation: state.implementation || "",
    askedAt: state.askedAt,
    answeredAt: new Date().toISOString(),
  };
  fs.appendFileSync(judgmentFile(home), `${JSON.stringify(record)}\n`, { mode: 0o600 });
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
    if (state.awaitingAnswer) {
      const answer = clean(event.prompt, 500);
      state.awaitingAnswer = false;
      if (answer.length >= 12 && !/^(ok(?:ay)?|yes|no|continue|go ahead|do it)[.!]?$/i.test(answer)) {
        saveJudgment(home, state, event);
        fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
        return { systemMessage: "Got it. I'll hold you to that." };
      }
      fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
      return null;
    }
    let profile = "";
    try { profile = fs.readFileSync(path.join(home, "USER.md"), "utf8"); } catch { return null; }
    const prompt = event.prompt || "";
    const craft = statedField(profile, "Becoming great at");
    const project = statedField(profile, "Working on");
    const stated = `${craft} ${project}`;
    const intersects = (BROAD_CRAFT.test(craft) && CONSEQUENTIAL.test(prompt))
      || profileTokens(stated).some((token) => prompt.toLowerCase().includes(token))
      || (IMPORTANT.test(stated) && IMPORTANT.test(prompt));
    state.pending = DELEGATION.test(prompt) && intersects && !THOUGHT.test(prompt);
    state.category = promptCategory(prompt);
    state.challenge = challenge(prompt, state.category);
    fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
    return null;
  }
  if (event.hook_event_name === "PreToolUse" && state.pending && !state.intervened) {
    state.intervened = true;
    state.awaitingAnswer = true;
    state.askedAt = new Date().toISOString();
    state.implementation = implementation(event);
    fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
    return { systemMessage: state.challenge };
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
