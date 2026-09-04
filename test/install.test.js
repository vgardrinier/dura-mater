import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { detectSources, firstResult, install, installProject, profileNeedsSetup, uninstallProject } from "../src/install.js";
import { analyzeFiles } from "../src/analyze.js";
import { formatInsight, formatResult, formatShare, onboard, run } from "../src/cli.js";
import { extractDecisions, forgetObservation, updateLearnedProfile } from "../src/profile.js";
import { formatRecallShare, isStrongRecall, loadJudgments, loadRecalls, recall } from "../src/judgments.js";

function initGit(project) {
  execFileSync("git", ["init", "-q"], { cwd: project });
}

test("detects agents without changing their settings", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dura-detect-"));
  fs.mkdirSync(path.join(home, ".codex", "sessions"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), "model='test'");
  const before = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.deepEqual(detectSources(home).map((s) => s.available), [true, true]);
  assert.equal(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"), before);
});

test("install writes local files, reports evidence, and is idempotent", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dura-install-"));
  const sessions = path.join(home, ".codex", "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const rows = [
    { type: "event_msg", payload: { type: "user_message", message: "Change the auth database" } },
    { type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: "auth schema" } },
    { type: "event_msg", payload: { type: "user_message", message: "Verify why this is safe" } },
  ];
  fs.writeFileSync(path.join(sessions, "one.jsonl"), rows.map(JSON.stringify).join("\n"));
  const target = path.join(home, ".dura-mater");
  const state = await install({ home, configDir: target });
  assert.match(fs.readFileSync(path.join(target, "USER.md"), "utf8"), /Intervention threshold/);
  assert.match(fs.readFileSync(path.join(target, "VOICE.md"), "utf8"), /live conversation/i);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, "sources.json"), "utf8"))[0].available, true);
  assert.equal(state.result.total.important, 2);
  assert.equal(state.result.total.reviewed, 2);
  fs.writeFileSync(path.join(target, "USER.md"), "my profile");
  await install({ home, configDir: target });
  assert.equal(fs.readFileSync(path.join(target, "USER.md"), "utf8"), "my profile");
});

test("metrics distinguish correction from blind acceptance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dura-metrics-"));
  const reviewed = path.join(root, "reviewed.jsonl");
  const blind = path.join(root, "blind.jsonl");
  fs.writeFileSync(reviewed, [
    { type: "event_msg", payload: { type: "user_message", message: "Deploy the auth change" } },
    { type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "deploy production auth" } },
    { type: "event_msg", payload: { type: "user_message", message: "Wrong, revert the deploy instead" } },
  ].map(JSON.stringify).join("\n"));
  fs.writeFileSync(blind, [
    { type: "event_msg", payload: { type: "user_message", message: "Update database" } },
    { type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: "database schema" } },
  ].map(JSON.stringify).join("\n"));
  const result = analyzeFiles([reviewed, blind]);
  assert.equal(result.important, 3);
  assert.equal(result.corrected, 1);
  assert.equal(result.unreviewed, 1);
  assert.equal(result.reviewed + result.unreviewed, result.important);
  assert.ok(result.corrected <= result.reviewed);
  for (const facts of Object.values(result.categories)) {
    assert.equal(facts.reviewed + facts.unreviewed, facts.sessions);
    assert.ok(facts.corrected <= facts.reviewed);
  }
});

test("parses Codex custom tool calls and counts decision topics once", () => {
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "codex-session.jsonl");
  const result = analyzeFiles([fixture]);
  assert.equal(result.actions, 2);
  assert.equal(result.important, 3);
  assert.equal(result.reviewed, 3);
  assert.equal(result.corrected, 1);
  assert.equal(result.unreviewed, 0);
  assert.equal(result.coverage, 100);
});

test("combined totals do not count the same session file twice", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dura-dedupe-"));
  fs.writeFileSync(path.join(root, "one.jsonl"), JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "deploy production" } }));
  const result = firstResult([
    { agent: "Codex", sessions: root, available: true },
    { agent: "Claude Code", sessions: root, available: true },
  ]);
  assert.equal(result.bySource[0].actions, 1);
  assert.equal(result.bySource[1].actions, 0);
  assert.equal(result.total.actions, 1);
});

test("plain output explains raw metrics without a score", () => {
  const source = { agent: "Codex", sessions: 2, actions: 8, important: 3, reviewed: 1, corrected: 1, unreviewed: 2, confidence: "directional", coverage: 100 };
  const text = formatResult({ bySource: [source], total: source });
  assert.match(text, /Important decisions\s+3/);
  assert.match(text, /Accepted without review\s+2/);
  assert.match(text, /not a cognitive score/);
  assert.doesNotMatch(text, /\u001b\[/);
});

test("first-run onboarding asks three questions and maps intense mode", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dura-onboard-"));
  const state = await install({ home, configDir: path.join(home, ".dura-mater") });
  const input = new PassThrough();
  input.isTTY = true;
  let shown = "";
  const output = new Writable({ write(chunk, _encoding, done) { shown += chunk.toString(); done(); } });
  output.isTTY = true;
  setTimeout(() => input.write("A launch\n"), 5);
  setTimeout(() => input.write("Product judgment\n"), 10);
  setTimeout(() => input.end("3\n"), 15);
  const result = await onboard(state, input, output);
  assert.equal(result.sensitivity, "intense");
  const profile = fs.readFileSync(state.userFile, "utf8");
  assert.match(profile, /A launch/);
  assert.match(profile, /Product judgment/);
  assert.match(profile, /0\.40/);
  assert.equal((shown.match(/\?/g) || []).length, 3);
  assert.match(shown, /Tell me what you're building and what you care about getting good at\./);
});

test("aborted placeholder profile resumes and completed setup stays idempotent", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dura-resume-"));
  const target = path.join(home, ".dura-mater");
  const first = await install({ home, configDir: target });
  assert.equal(first.needsSetup, true);
  assert.equal(profileNeedsSetup(first.userFile), true);
  const input = new PassThrough(); input.isTTY = true;
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } }); output.isTTY = true;
  setTimeout(() => input.write("A product\n"), 5);
  setTimeout(() => input.write("Architecture\n"), 10);
  setTimeout(() => input.end("1\n"), 15);
  await onboard(first, input, output);
  const second = await install({ home, configDir: target });
  assert.equal(second.needsSetup, false);
  assert.match(fs.readFileSync(first.userFile, "utf8"), /A product/);
});

test("project hook installs reversibly and intervenes once", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "dura-project-"));
  initGit(project);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dura-profile-"));
  fs.writeFileSync(path.join(profile, "USER.md"), "## Becoming great at\n\nSecurity architecture\n");
  const installed = installProject(project);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: project, encoding: "utf8" }), "");
  const config = JSON.parse(fs.readFileSync(installed.configFile, "utf8"));
  assert.ok(config.hooks.UserPromptSubmit);
  assert.ok(config.hooks.PreToolUse);
  const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
  const fixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8"));
  const call = (event) => spawnSync(process.execPath, [installed.handlerFile], {
    input: JSON.stringify({ ...event, cwd: project, session_id: "one" }),
    encoding: "utf8",
    env: { ...process.env, DURA_MATER_HOME: profile },
  }).stdout;
  assert.equal(call(fixture("hook-user-prompt.json")), "");
  assert.match(call(fixture("hook-pre-tool.json")), /Who can grant access to whom/);
  assert.equal(call(fixture("hook-pre-tool.json")), "");
  uninstallProject(project);
  assert.equal(fs.existsSync(installed.configFile), false);
  assert.equal(fs.existsSync(installed.handlerFile), false);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: project, encoding: "utf8" }), "");
});

test("hook captures the next explicit judgment with its first implementation action", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "dura-loop-"));
  initGit(project);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dura-loop-profile-"));
  fs.writeFileSync(path.join(profile, "USER.md"), "## Becoming great at\n\nSecurity architecture\n");
  const installed = installProject(project);
  const invoke = (event) => spawnSync(process.execPath, [installed.handlerFile], {
    input: JSON.stringify({ cwd: project, session_id: "loop", ...event }), encoding: "utf8",
    env: { ...process.env, DURA_MATER_HOME: profile },
  }).stdout;
  invoke({ hook_event_name: "UserPromptSubmit", prompt: "Implement authentication" });
  assert.match(invoke({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "change auth token=abc123" } }), /Tell me your rule/);
  assert.match(invoke({ hook_event_name: "UserPromptSubmit", prompt: "Only workspace admins can invite another admin." }), /hold you to that/);
  assert.equal(invoke({ hook_event_name: "UserPromptSubmit", prompt: "Continue" }), "");
  const records = loadJudgments(profile);
  assert.equal(records.length, 1);
  assert.equal(records[0].category, "access");
  assert.equal(records[0].answer, "Only workspace admins can invite another admin.");
  assert.equal(records[0].implementation, "change auth token=[secret]");
});

test("broad stated craft catches Victor's Google login handoff once", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "dura-victor-"));
  initGit(project);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dura-victor-profile-"));
  fs.writeFileSync(path.join(profile, "USER.md"), "## You told me\n\n### Working on\n\nDura Mater\n\n### Becoming great at\n\nsystem design and product building\n");
  const installed = installProject(project);
  const invoke = (event) => spawnSync(process.execPath, [installed.handlerFile], {
    input: JSON.stringify({ cwd: project, session_id: "victor", ...event }), encoding: "utf8",
    env: { ...process.env, DURA_MATER_HOME: profile },
  }).stdout;
  invoke({ hook_event_name: "UserPromptSubmit", prompt: "add Google login" });
  const first = invoke({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command: "*** Update File: auth.js" } });
  assert.match(first, /What happens if this email already belongs to an account\?/);
  assert.equal(invoke({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command: "*** Update File: login.js" } }), "");
});

test("context questions cover consequential failure modes", () => {
  const cases = [
    ["invite an admin", "Who can grant access to whom?"],
    ["migrate the schema", "What must never be lost in this migration?"],
    ["delete old accounts", "What has to be recoverable?"],
    ["add payment checkout", "What happens if payment succeeds but the app times out?"],
    ["change the architecture boundary", "What's the boundary you don't want crossed?"],
  ];
  for (const [prompt, expected] of cases) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "dura-question-")); initGit(project);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dura-question-profile-"));
    fs.writeFileSync(path.join(profile, "USER.md"), "### Becoming great at\n\nEngineering\n");
    const installed = installProject(project);
    const call = (event) => spawnSync(process.execPath, [installed.handlerFile], { input: JSON.stringify({ cwd: project, session_id: prompt, ...event }), encoding: "utf8", env: { ...process.env, DURA_MATER_HOME: profile } }).stdout;
    call({ hook_event_name: "UserPromptSubmit", prompt: `Please ${prompt}` });
    assert.match(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "work" } }), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("project install upgrades Dura-owned hooks but preserves foreign files", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "dura-upgrade-")); initGit(project);
  const first = installProject(project);
  fs.writeFileSync(first.handlerFile, "#!/usr/bin/env node\n// dura-mater-managed:v1\n");
  fs.writeFileSync(first.configFile, `${JSON.stringify({ description: "Dura Mater project coaching hook.", hooks: {} })}\n`);
  installProject(project);
  assert.match(fs.readFileSync(first.handlerFile, "utf8"), /dura-mater-managed:v2/);
  assert.equal(JSON.parse(fs.readFileSync(first.configFile, "utf8")).version, 2);
  fs.writeFileSync(first.handlerFile, "foreign hook\n");
  assert.throws(() => installProject(project), /left it unchanged/);
  assert.equal(fs.readFileSync(first.handlerFile, "utf8"), "foreign hook\n");
});

test("recall recognizes a conservative content-word match", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dura-recall-"));
  fs.writeFileSync(path.join(profile, "judgments.jsonl"), `${JSON.stringify({ id: "one", question: "Who should have access?", answer: "Workspace admins control invitations.", implementation: "edit auth policy" })}\n`);
  const input = new PassThrough(); input.isTTY = true;
  let shown = "";
  const output = new Writable({ write(chunk, _encoding, done) { shown += chunk.toString(); done(); } }); output.isTTY = true;
  setTimeout(() => input.end("Invitations: workspace admins control.\n"), 5);
  await recall(profile, input, output);
  assert.match(shown, /Yep\. You remembered it\./);
  assert.doesNotMatch(shown, /Last time you said/);
  assert.match(shown, /The agent then started with: edit auth policy/);
  assert.equal(fs.readFileSync(path.join(profile, "recalls.jsonl"), "utf8").trim().length > 0, true);
  assert.equal(loadRecalls(profile)[0].matched, true);
});

test("recall reveals a miss without claiming semantic equivalence", async () => {
  assert.equal(isStrongRecall("Only workspace admins can invite another admin", "Everyone can invite users"), false);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dura-recall-miss-"));
  fs.writeFileSync(path.join(profile, "judgments.jsonl"), `${JSON.stringify({ id: "one", question: "Who should have access?", answer: "Only workspace admins can invite another admin.", implementation: "edited auth.js" })}\n`);
  const input = new PassThrough(); input.isTTY = true;
  let shown = "";
  const output = new Writable({ write(chunk, _encoding, done) { shown += chunk.toString(); done(); } }); output.isTTY = true;
  setTimeout(() => input.end("Everyone can invite users.\n"), 5);
  await recall(profile, input, output);
  assert.match(shown, /Not the same answer\. Last time you said:\nOnly workspace admins/);
  assert.match(shown, /The agent then started with: edited auth\.js/);
  assert.equal(loadRecalls(profile)[0].matched, false);
});

test("share prefers the latest matched or missed recall", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dura-recall-share-"));
  const judgment = { id: "one", question: "What happens if this email already belongs to an account?", category: "access", answeredAt: "2026-09-01T10:00:00.000Z", answer: "Link it." };
  fs.writeFileSync(path.join(root, "judgments.jsonl"), `${JSON.stringify(judgment)}\n`);
  fs.writeFileSync(path.join(root, "recalls.jsonl"), `${JSON.stringify({ judgmentId: "one", matched: true, recalledAt: "2026-09-07T10:00:00.000Z" })}\n`);
  assert.equal(formatRecallShare(root), "AI worked on account linking.\nI wrote down the rule. Six days later, I still remembered it.\n- Dura Mater");
  fs.appendFileSync(path.join(root, "recalls.jsonl"), `${JSON.stringify({ judgmentId: "one", matched: false, recalledAt: "2026-09-07T10:01:00.000Z" })}\n`);
  assert.equal(formatRecallShare(root), "AI worked on account linking.\nI wrote down the rule. Six days later, I gave a different answer.\n- Dura Mater");
});

test("share recall card falls back when no recall exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dura-no-recall-share-"));
  assert.equal(formatRecallShare(root), null);
  const weekly = { total: { categories: { data: { sessions: 2, reviewed: 1, unreviewed: 1, corrected: 0 } } } };
  assert.match(formatShare(weekly), /AI worked on database in 2 sessions/);
});

test("learned profile uses at most 200 decisions and preserves USER.md", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dura-bound-"));
  const config = path.join(root, "config");
  fs.mkdirSync(config);
  const user = "# My edits stay\n";
  fs.writeFileSync(path.join(config, "USER.md"), user);
  const files = [];
  for (let index = 0; index < 205; index += 1) {
    const file = path.join(root, `${index}.jsonl`);
    fs.writeFileSync(file, JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: `Change database schema ${index}` } }));
    files.push(file);
  }
  assert.equal(extractDecisions(files).length, 200);
  const learned = updateLearnedProfile(config, files);
  assert.equal(learned.decisions.length, 200);
  assert.equal(fs.readFileSync(path.join(config, "USER.md"), "utf8"), user);
  assert.match(learned.text, /## You told me[\s\S]*## I've seen[\s\S]*## Still learning/);
  forgetObservation(config, "data");
  assert.doesNotMatch(updateLearnedProfile(config, files).text, /\*\*data\*\*/);
});

test("observations alone cannot trigger, but stated craft personalizes challenge", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "dura-weight-"));
  initGit(project);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dura-weight-profile-"));
  fs.writeFileSync(path.join(profile, "USER.md"), "## You told me\n\n### Becoming great at\n\nVisual design\n");
  fs.writeFileSync(path.join(profile, "LEARNED.md"), "## I've seen\n\nSecurity architecture\n");
  const installed = installProject(project);
  const invoke = (id, event) => spawnSync(process.execPath, [installed.handlerFile], {
    input: JSON.stringify({ cwd: project, session_id: id, ...event }), encoding: "utf8",
    env: { ...process.env, DURA_MATER_HOME: profile },
  }).stdout;
  invoke("observed", { hook_event_name: "UserPromptSubmit", prompt: "Implement authentication" });
  assert.equal(invoke("observed", { hook_event_name: "PreToolUse", tool_name: "apply_patch" }), "");
  fs.writeFileSync(path.join(profile, "USER.md"), "## You told me\n\n### Becoming great at\n\nSystems architecture\n");
  invoke("stated", { hook_event_name: "UserPromptSubmit", prompt: "Design the systems architecture" });
  assert.match(invoke("stated", { hook_event_name: "PreToolUse", tool_name: "apply_patch" }), /What's the boundary you don't want crossed\?/);
});

test("non-TTY first run skips questions and shows no analytics", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dura-nontty-"));
  let shown = "";
  const output = new Writable({ write(chunk, _encoding, done) { shown += chunk.toString(); done(); } });
  output.isTTY = false;
  const input = Readable.from([]);
  input.isTTY = false;
  await run([], { home, configDir: path.join(home, ".dura-mater"), input, output });
  assert.doesNotMatch(shown, /What are you working on/);
  assert.doesNotMatch(shown, /Agent actions|Important decisions|DURA MATER · LAST 7 DAYS/);
  assert.match(shown, /Setup is unfinished/);
});

test("setup asks only three questions, then says to start Codex", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dura-setup-ux-"));
  const input = new PassThrough(); input.isTTY = true;
  let shown = "";
  const output = new Writable({ write(chunk, _encoding, done) { shown += chunk.toString(); done(); } }); output.isTTY = true;
  setTimeout(() => input.write("A tool\n"), 5);
  setTimeout(() => input.write("System design\n"), 10);
  setTimeout(() => input.end("2\n"), 15);
  await run(["setup"], { home, configDir: path.join(home, ".dura-mater"), input, output });
  assert.equal((shown.match(/\?/g) || []).length, 3);
  assert.doesNotMatch(shown, /Agent actions|Important decisions|Coverage/);
  assert.match(shown.trimEnd(), /You're set\. Start Codex\.$/);
});

test("normal insight and share use defensible facts", () => {
  const result = { total: { categories: { data: { sessions: 9, reviewed: 0, unreviewed: 9, corrected: 0 } } }, previous: { categories: { data: { sessions: 4 } } } };
  assert.equal(formatInsight(result), "You missed 9 Database follow-ups this week.\nDatabase showed up in 9 agent sessions.");
  const share = formatShare(result, false, "database design");
  assert.match(share, /^AI worked on database in 9 sessions this week\.\nI didn't follow up in 9\./);
  assert.match(share, /- Dura Mater/);
  assert.doesNotMatch(share, /—/);
  assert.doesNotMatch(share, /score|confidence|coverage/i);
});

test("declared craft outranks a larger unrelated category", () => {
  const result = { total: { categories: {
    access: { sessions: 20, reviewed: 2, unreviewed: 18, corrected: 0 },
    architecture: { sessions: 12, reviewed: 7, unreviewed: 5, corrected: 1 },
  } } };
  assert.equal(formatInsight(result, false, "system design"), "You missed 5 system design follow-ups this week.\nArchitecture showed up in 12 agent sessions.");
});

test("review queue is bounded and evidence is sanitized", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dura-review-"));
  const files = [];
  for (let index = 0; index < 7; index += 1) {
    const file = path.join(root, `${index}.jsonl`);
    fs.writeFileSync(file, JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: `Change database password=secret-${index} schema` } }));
    files.push(file);
  }
  const queue = analyzeFiles(files).categories.data.evidence;
  assert.equal(queue.length, 5);
  assert.ok(queue.every((item) => item.prompt.includes("password=[secret]")));
  assert.ok(queue.every((item) => !item.prompt.includes("secret-")));
  assert.equal(queue.length, Math.min(5, analyzeFiles(files).categories.data.unreviewed));
});

test("ignores injected history and keeps evidence when category comes from a command", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dura-evidence-"));
  const meta = path.join(root, "meta.jsonl");
  fs.writeFileSync(meta, [
    { type: "event_msg", payload: { type: "user_message", message: "The following is the Codex agent history with database architecture" } },
    { type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: "interface schema" } },
  ].map(JSON.stringify).join("\n"));
  const real = path.join(root, "real.jsonl");
  fs.writeFileSync(real, [
    { type: "event_msg", payload: { type: "user_message", message: "Build the dashboard" } },
    { type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "run prisma migration" } },
  ].map(JSON.stringify).join("\n"));
  const result = analyzeFiles([meta, real]);
  assert.equal(result.important, 1);
  assert.equal(result.categories.data.unreviewed, 1);
  assert.equal(result.categories.data.evidence[0].prompt, "Build the dashboard");
  assert.equal(result.categories.architecture, undefined);
});
