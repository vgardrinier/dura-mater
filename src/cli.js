import { install } from "./install.js";
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

async function askOneQuestion(state, input, output) {
  if (!input.isTTY || !output.isTTY || !state.result.actions) return;
  const profile = fs.readFileSync(state.userFile, "utf8");
  if (!profile.includes("## Skills I want to keep\n\nNot set yet")) return;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question("\nOne question: what skill do you refuse to lose? ")).trim();
    if (answer) fs.writeFileSync(state.userFile, profile.replace("## Skills I want to keep\n\nNot set yet", `## Skills I want to keep\n\n${answer}`), { mode: 0o600 });
  } finally { rl.close(); }
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
  output.write("\nEverything stays local.\n");
  await askOneQuestion(state, input, output);
  return state;
}
