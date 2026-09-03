import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeFiles } from "./analyze.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultVoice = fs.readFileSync(path.join(here, "..", "templates", "VOICE.md"), "utf8");

export function detectSources(home = os.homedir()) {
  return [
    { agent: "Codex", sessions: path.join(home, ".codex", "sessions"), settings: path.join(home, ".codex", "config.toml") },
    { agent: "Claude Code", sessions: path.join(home, ".claude", "projects"), settings: path.join(home, ".claude", "settings.json") },
  ].map((item) => ({ ...item, available: fs.existsSync(item.sessions), settingsFound: fs.existsSync(item.settings) }));
}

function listJsonl(root, limit = 10000) {
  if (!fs.existsSync(root)) return [];
  const found = [], pending = [root];
  while (pending.length && found.length < limit) {
    const current = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.name.endsWith(".jsonl")) found.push(target);
    }
  }
  return found;
}

export function firstResult(sources, now = Date.now()) {
  const files = sources.filter((source) => source.available).flatMap((source) => listJsonl(source.sessions));
  return analyzeFiles(files, now);
}

function userMarkdown(a) {
  return `# You\n\n## Strengths\n\n${a.strengths}\n\n## Skills I want to keep\n\n${a.retain}\n\n## Delegate freely\n\n${a.delegate}\n\n## Current goal\n\n${a.goal}\n\n## Coaching intensity\n\n${a.intensity}\n`;
}

export async function install({ home = os.homedir(), configDir } = {}) {
  const target = configDir || path.join(home, ".dura-mater");
  const sources = detectSources(home);
  const answers = { strengths: "Not set yet", retain: "Not set yet", delegate: "Not set yet", goal: "Not set yet", intensity: "normal" };
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const userFile = path.join(target, "USER.md");
  const voiceFile = path.join(target, "VOICE.md");
  if (!fs.existsSync(userFile)) fs.writeFileSync(userFile, userMarkdown(answers), { mode: 0o600 });
  if (!fs.existsSync(voiceFile)) fs.writeFileSync(voiceFile, defaultVoice, { mode: 0o600 });
  fs.writeFileSync(path.join(target, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`, { mode: 0o600 });
  return { target, userFile, sources, result: firstResult(sources) };
}
