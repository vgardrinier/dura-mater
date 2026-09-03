import { install, userMarkdown } from "./install.js";
import fs from "node:fs";
import readline from "node:readline/promises";

const paint = (code, text, color) => color ? `\u001b[${code}m${text}\u001b[0m` : text;

export function formatResult(result, color = false) {
  if (!result.sessions) return "No sessions this week. Dura Mater is active.";
  const line = (label, value) => `${paint("2", label.padEnd(30), color)} ${paint("1", String(value), color)}`;
  return [
    paint("1;36", "DURA MATER · LAST 7 DAYS", color),
    "",
    line("Agent actions", result.actions),
    line("Important decisions", result.important),
    line("Reviewed", result.reviewed),
    line("Corrected by you", result.corrected),
    line("Accepted without review", result.unreviewed),
    "",
    paint("2", `Data confidence: ${result.confidence}. These are behavioral signals, not a cognitive score.`, color),
  ].join("\n");
}

const modes = {
  "1": { frequency: "only when it really matters", sensitivity: "critical", threshold: "0.90" },
  "2": { frequency: "a few times per session", sensitivity: "balanced", threshold: "0.65" },
  "3": { frequency: "coach me hard", sensitivity: "intense", threshold: "0.40" },
};

export async function onboard(state, input, output) {
  if (!state.isFirstRun || !input.isTTY || !output.isTTY) return null;
  output.write("\nTell me what you're building and what you care about getting good at. Then I'll know when to leave you alone and when to push.\n\n");
  const rl = readline.createInterface({ input, output });
  try {
    const project = (await rl.question("What are you working on? ")).trim() || "Not set yet";
    const craft = (await rl.question("What do you want to become great at? ")).trim() || "Not set yet";
    output.write("How often should I step in?\n  1. only when it really matters\n  2. a few times per session\n  3. coach me hard\n");
    const mode = modes[(await rl.question("Choose 1, 2, or 3: ")).trim()] || modes["1"];
    fs.writeFileSync(state.userFile, userMarkdown({ project, craft, ...mode }), { mode: 0o600 });
    return { project, craft, ...mode };
  } finally { rl.close(); }
}

function firstName(profile) {
  const match = profile.match(/^## Name\s*\n+\s*([^\n]+)/mi);
  return match?.[1]?.trim().split(/\s+/)[0] || "";
}

export async function run(args, options = {}) {
  if (args[0] && args[0] !== "install") throw new Error("run `npx dura-mater`");
  const output = options.output || process.stdout;
  const input = options.input || process.stdin;
  const state = await install(options);
  const found = state.sources.filter((s) => s.available).map((s) => s.agent);
  const color = Boolean(output.isTTY && !process.env.NO_COLOR);
  output.write(`\n${found.length ? `Found ${found.join(" and ")}.` : "No Codex or Claude Code sessions found."}\n\n`);
  output.write(`${formatResult(state.result, color)}\n`);
  const profile = await onboard(state, input, output);
  const name = firstName(fs.readFileSync(state.userFile, "utf8"));
  const closing = profile?.sensitivity === "intense"
    ? "Good. Let's work. No hiding behind the agent."
    : profile?.sensitivity === "critical"
      ? "Alright. Go find the thing worth building. I won't bother you unless it matters."
    : name ? `Alright, ${name}. Get to work. I'll call you out when you're coasting.`
      : "Alright. Get to work. I'll call you out when you're coasting.";
  output.write(`\n${closing}\n`);
  return state;
}
