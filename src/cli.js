import { install, installProject, uninstallProject, userMarkdown } from "./install.js";
import fs from "node:fs";
import readline from "node:readline/promises";
import path from "node:path";
import { forgetObservation } from "./profile.js";

const paint = (code, text, color) => color ? `\u001b[${code}m${text}\u001b[0m` : text;

function metricBlock(result, color = false) {
  if (!result.sessions) return "No sessions this week. Dura Mater is active.";
  const line = (label, value) => `${paint("2", label.padEnd(30), color)} ${paint("1", String(value), color)}`;
  return [
    line("Agent actions", result.actions),
    line("Important decisions", result.important),
    line("Reviewed", result.reviewed),
    line("Corrected by you", result.corrected),
    line("Accepted without review", result.unreviewed),
    "",
    paint("2", `Coverage: ${result.coverage}% of readable events · confidence: ${result.confidence}`, color),
  ].join("\n");
}

export function formatResult(result, color = false) {
  const sections = [paint("1;36", "DURA MATER · LAST 7 DAYS", color)];
  for (const source of result.bySource) {
    sections.push(`${paint("1", source.agent, color)}\n${metricBlock(source, color)}`);
  }
  if (result.bySource.length > 1) sections.push(`${paint("1", "Combined (sum of distinct session files)", color)}\n${metricBlock(result.total, color)}`);
  sections.push(paint("2", "Important decisions are topic signals, not a cognitive score.", color));
  return sections.join("\n\n");
}

const modes = {
  "1": { frequency: "only when it really matters", sensitivity: "critical", threshold: "0.90" },
  "2": { frequency: "a few times per session", sensitivity: "balanced", threshold: "0.65" },
  "3": { frequency: "coach me hard", sensitivity: "intense", threshold: "0.40" },
};

export async function onboard(state, input, output, force = false) {
  if ((!state.needsSetup && !force) || !input.isTTY || !output.isTTY) return null;
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
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "install";
  if (!["install", "setup", "uninstall", "profile", "forget"].includes(command)) throw new Error("run `npx dura-mater`, `setup`, `profile`, `forget`, or `uninstall`");
  const projectFlag = args.indexOf("--project");
  const project = projectFlag >= 0 ? args[projectFlag + 1] : null;
  if (projectFlag >= 0 && !project) throw new Error("--project needs a path");
  if (command === "uninstall") {
    if (!project) throw new Error("uninstall needs --project PATH");
    const removed = uninstallProject(project);
    (options.output || process.stdout).write(`Removed Dura Mater hooks from ${removed.project}.\n`);
    return removed;
  }
  const output = options.output || process.stdout;
  const input = options.input || process.stdin;
  let state = await install(options);
  if (command === "profile") {
    output.write(fs.readFileSync(path.join(state.target, "LEARNED.md"), "utf8"));
    return state;
  }
  if (command === "forget") {
    const category = args[1];
    if (!category) throw new Error("forget needs a topic, for example `forget data`");
    forgetObservation(state.target, category.toLowerCase());
    state = await install(options);
    output.write(`Forgot the ${category} observation. USER.md was not changed.\n`);
    return state;
  }
  const projectState = project ? installProject(project) : null;
  const found = state.sources.filter((s) => s.available).map((s) => s.agent);
  const color = Boolean(output.isTTY && !process.env.NO_COLOR);
  output.write(`\n${found.length ? `Found ${found.join(" and ")}.` : "No Codex or Claude Code sessions found."}\n\n`);
  output.write(`${formatResult(state.result, color)}\n`);
  if (projectState) output.write(`\nCodex hook installed in ${projectState.project}.\n`);
  const profile = await onboard(state, input, output, command === "setup");
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
