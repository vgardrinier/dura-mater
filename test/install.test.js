import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import test from "node:test";
import { detectSources, install } from "../src/install.js";
import { analyzeFiles } from "../src/analyze.js";
import { formatResult, onboard, run } from "../src/cli.js";

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
  assert.match(fs.readFileSync(path.join(target, "VOICE.md"), "utf8"), /sharp, warm, and direct/i);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, "sources.json"), "utf8"))[0].available, true);
  assert.equal(state.result.important, 1);
  assert.equal(state.result.reviewed, 1);
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
  assert.equal(result.important, 2);
  assert.equal(result.corrected, 1);
  assert.equal(result.unreviewed, 1);
});

test("plain output explains raw metrics without a score", () => {
  const text = formatResult({ sessions: 2, actions: 8, important: 3, reviewed: 1, corrected: 1, unreviewed: 2, confidence: "directional" });
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
