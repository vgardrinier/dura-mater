import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { detectSources, firstResult, install, installProject, profileNeedsSetup, uninstallProject } from "../src/install.js";
import { analyzeFiles } from "../src/analyze.js";
import { formatResult, onboard, run } from "../src/cli.js";
import { extractDecisions, forgetObservation, updateLearnedProfile } from "../src/profile.js";

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
  assert.equal(state.result.total.reviewed, 1);
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
    { type: "event_msg", payload: { type: "user_message", message: "Wrong, revert that instead" } },
  ].map(JSON.stringify).join("\n"));
  fs.writeFileSync(blind, [
    { type: "event_msg", payload: { type: "user_message", message: "Update database" } },
    { type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: "database schema" } },
  ].map(JSON.stringify).join("\n"));
  const result = analyzeFiles([reviewed, blind]);
  assert.equal(result.important, 3);
  assert.equal(result.corrected, 1);
  assert.equal(result.unreviewed, 2);
});

test("parses Codex custom tool calls and counts decision topics once", () => {
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "codex-session.jsonl");
  const result = analyzeFiles([fixture]);
  assert.equal(result.actions, 2);
  assert.equal(result.important, 3);
  assert.equal(result.reviewed, 2);
  assert.equal(result.corrected, 1);
  assert.equal(result.unreviewed, 1);
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dura-profile-"));
  fs.writeFileSync(path.join(profile, "USER.md"), "## Becoming great at\n\nSecurity architecture\n");
  const installed = installProject(project);
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
  assert.match(call(fixture("hook-pre-tool.json")), /Who should have access/);
  assert.equal(call(fixture("hook-pre-tool.json")), "");
  uninstallProject(project);
  assert.equal(fs.existsSync(installed.configFile), false);
  assert.equal(fs.existsSync(installed.handlerFile), false);
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
  assert.match(invoke("stated", { hook_event_name: "PreToolUse", tool_name: "apply_patch" }), /Okay, your call\. How would you design this\?/);
});

test("non-TTY first run skips questions and ends with spoken activation", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dura-nontty-"));
  let shown = "";
  const output = new Writable({ write(chunk, _encoding, done) { shown += chunk.toString(); done(); } });
  output.isTTY = false;
  const input = Readable.from([]);
  input.isTTY = false;
  await run([], { home, configDir: path.join(home, ".dura-mater"), input, output });
  assert.doesNotMatch(shown, /What are you working on/);
  assert.match(shown.trimEnd(), /Alright\. Get to work\. I'll call you out when you're coasting\.$/);
});
