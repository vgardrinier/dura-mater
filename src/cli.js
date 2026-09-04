import { install, installProject, uninstallProject, userMarkdown } from "./install.js";
import fs from "node:fs";
import readline from "node:readline/promises";
import path from "node:path";
import { forgetObservation } from "./profile.js";

const paint = (code, text, color) => color ? `\u001b[${code}m${text}\u001b[0m` : text;

function metricBlock(result, color = false) {
  if (!result.sessions) return "No sessions this week. Dura Mater is active.";
  const line = (label, value) => `${paint("2", label.padEnd(30), color)} ${paint("1", String(value), color)}`;
  const categories = Object.entries(result.categories || {}).sort(([, a], [, b]) => b.sessions - a.sessions).map(([category, facts]) => `${categoryNames[category] || category}: ${facts.sessions} sessions · ${facts.reviewed} reviewed · ${facts.unreviewed} no visible review · ${facts.corrected} corrected`);
  return [
    line("Agent actions", result.actions),
    line("Important decisions", result.important),
    line("Reviewed", result.reviewed),
    line("Corrected by you", result.corrected),
    line("Accepted without review", result.unreviewed),
    "",
    paint("2", `Coverage: ${result.coverage}% of readable events · confidence: ${result.confidence}`, color),
    ...(categories.length ? ["", ...categories] : []),
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

const categoryNames = { access: "Access", data: "Database", release: "Shipping", money: "Payments", architecture: "Architecture" };

const craftCategories = [
  [/\b(system design|architecture|backend|engineering)\b/i, ["architecture"]],
  [/\b(product|building|shipping)\b/i, ["architecture", "release"]],
  [/\b(database|data|sql)\b/i, ["data"]],
  [/\b(security|auth|access)\b/i, ["access"]],
  [/\b(payment|billing|money)\b/i, ["money"]],
  [/\b(deploy|release)\b/i, ["release"]],
];

function statedCraft(profile) {
  return profile.match(/^###? Becoming great at\s*\n+\s*([^\n]+)/mi)?.[1]?.trim() || "";
}

function preferredCategory(craft, categories) {
  const matches = craftCategories.find(([pattern]) => pattern.test(craft))?.[1] || [];
  return matches.filter((category) => (categories[category]?.sessions || 0) >= 2)
    .sort((a, b) => categories[b].unreviewed - categories[a].unreviewed)[0];
}

export function formatInsight(result, color = false, craft = "") {
  const ranked = Object.entries(result.total.categories || {}).sort(([, a], [, b]) => b.unreviewed - a.unreviewed || b.sessions - a.sessions);
  if (!ranked.length) return "Nothing useful yet. Do one real Codex session, then come back.";
  const preferred = preferredCategory(craft, result.total.categories || {});
  const [category, facts] = preferred ? [preferred, result.total.categories[preferred]] : ranked[0];
  const name = paint("1", categoryNames[category] || category, color);
  const goal = craft ? craft.replace(/[.?!]+$/, "") : categoryNames[category] || category;
  if (facts.unreviewed) {
    return `You missed ${facts.unreviewed} ${goal} follow-up${facts.unreviewed === 1 ? "" : "s"} this week.\n${name} showed up in ${facts.sessions} agent session${facts.sessions === 1 ? "" : "s"}.`;
  }
  const followed = facts.sessions === 1 ? "You followed up." : facts.sessions === 2 ? "You followed up both times." : `You followed up all ${facts.sessions} times.`;
  const changed = facts.corrected === facts.sessions && facts.sessions > 1 ? " You changed course every time." : facts.corrected ? ` You changed course in ${facts.corrected}.` : "";
  return `You're still in the loop on ${goal}.\n${name} showed up in ${facts.sessions} agent session${facts.sessions === 1 ? "" : "s"}. ${followed}${changed}`;
}

export function formatShare(result, color = false, craft = "") {
  const ranked = Object.entries(result.total.categories || {}).sort(([, a], [, b]) => b.unreviewed - a.unreviewed || b.sessions - a.sessions);
  if (!ranked.length) return formatInsight(result, color, craft);
  const category = preferredCategory(craft, result.total.categories || {}) || ranked[0][0];
  const facts = result.total.categories[category];
  const name = categoryNames[category] || category;
  const first = `AI worked on ${name.toLowerCase()} in ${facts.sessions} session${facts.sessions === 1 ? "" : "s"} this week.`;
  const checked = facts.sessions === 1 ? "it" : facts.sessions === 2 ? "both" : `all ${facts.sessions}`;
  const changed = facts.sessions === 1 ? "it" : facts.sessions === 2 ? "both" : "every one";
  const second = facts.unreviewed ? `I didn't follow up in ${facts.unreviewed}.` : `I checked ${checked}.${facts.corrected === facts.sessions && facts.sessions > 0 ? ` I changed ${changed}.` : ""}`;
  return `${first}\n${second}\n${paint("2", "- Dura Mater", color)}`;
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

export async function run(args, options = {}) {
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "install";
  if (!["install", "setup", "uninstall", "profile", "forget", "details", "share", "review"].includes(command)) throw new Error("run `npx dura-mater`, `setup`, `details`, `share`, `review`, `profile`, `forget`, or `uninstall`");
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
  if (command === "review") {
    const category = args[1]?.toLowerCase();
    if (!category) throw new Error("review needs a topic, for example `review architecture`");
    const sessions = state.result.total.categories?.[category]?.evidence || [];
    if (!sessions.length) output.write(`No unreviewed ${category} sessions found this week.\n`);
    else sessions.forEach((item, index) => output.write(`${index + 1}. ${item.observedAt.slice(0, 10)} - ${item.prompt}\n`));
    return state;
  }
  const projectState = project ? installProject(project) : null;
  const color = Boolean(output.isTTY && !process.env.NO_COLOR);
  if (command === "setup" || state.needsSetup) {
    if (projectState) output.write(`Codex hook installed in ${projectState.project}.\n`);
    const profile = await onboard(state, input, output, command === "setup");
    if (!profile) output.write("Setup is unfinished. Run `dura-mater setup` in a terminal.\n");
    else output.write("\nYou're set. Start Codex.\n");
    return state;
  }
  if (command === "details") {
    const found = state.sources.filter((source) => source.available).map((source) => source.agent);
    output.write(`${found.length ? `Sources: ${found.join(" and ")}\n\n` : "No session sources found.\n\n"}${formatResult(state.result, color)}\n`);
    return state;
  }
  if (command === "share") {
    const craft = statedCraft(fs.readFileSync(state.userFile, "utf8"));
    output.write(`${formatShare(state.result, color, craft)}\n`);
    return state;
  }
  const craft = statedCraft(fs.readFileSync(state.userFile, "utf8"));
  const insight = formatInsight(state.result, color, craft);
  output.write(`\n${paint("1;36", "DURA MATER", color)}\n\n${insight}\n`);
  if (projectState) output.write(`\nCodex hook installed in ${projectState.project}.\n`);
  const category = preferredCategory(craft, state.result.total.categories || {}) || Object.entries(state.result.total.categories || {}).sort(([, a], [, b]) => b.unreviewed - a.unreviewed)[0]?.[0];
  if (category && state.result.total.categories[category].evidence?.length) {
    const count = Math.min(5, state.result.total.categories[category].evidence.length);
    output.write(`\nWant the ${count} session${count === 1 ? "" : "s"}? Run \`dura-mater review ${category}\`.\n`);
  }
  return state;
}
