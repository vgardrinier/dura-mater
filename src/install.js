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
  const seen = new Set();
  const bySource = sources.filter((source) => source.available).map((source) => {
    const files = listJsonl(source.sessions).filter((file) => {
      let key;
      try { key = fs.realpathSync(file); } catch { key = path.resolve(file); }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { agent: source.agent, ...analyzeFiles(files, now) };
  });
  const fields = ["sessions", "actions", "important", "reviewed", "corrected", "unreviewed", "parsed", "malformed"];
  const total = Object.fromEntries(fields.map((field) => [field, bySource.reduce((sum, source) => sum + source[field], 0)]));
  const known = total.parsed + total.malformed;
  total.coverage = known ? Math.round(100 * total.parsed / known) : 0;
  total.confidence = known && total.coverage >= 90 ? "directional" : "low";
  return { bySource, total };
}

export function userMarkdown(a) {
  return `# You\n\n## Working on\n\n${a.project}\n\n## Becoming great at\n\n${a.craft}\n\n## Coaching\n\n${a.frequency}\n\n## Intervention sensitivity\n\n${a.sensitivity}\n\n## Intervention threshold\n\n${a.threshold}\n`;
}

export async function install({ home = os.homedir(), configDir } = {}) {
  const target = configDir || path.join(home, ".dura-mater");
  const sources = detectSources(home);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const userFile = path.join(target, "USER.md");
  const voiceFile = path.join(target, "VOICE.md");
  const isFirstRun = !fs.existsSync(userFile);
  if (isFirstRun) fs.writeFileSync(userFile, userMarkdown({ project: "Not set yet", craft: "Not set yet", frequency: "only when it really matters", sensitivity: "critical", threshold: "0.90" }), { mode: 0o600 });
  if (!fs.existsSync(voiceFile)) fs.writeFileSync(voiceFile, defaultVoice, { mode: 0o600 });
  fs.writeFileSync(path.join(target, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`, { mode: 0o600 });
  return { target, userFile, isFirstRun, sources, result: firstResult(sources) };
}
