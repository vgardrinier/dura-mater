import fs from "node:fs";
import path from "node:path";

const CATEGORIES = {
  access: /\b(auth(?:entication|orization)?|security|permissions?|credentials?|access)\b/i,
  data: /\b(database|migration|schema|delete|data model)\b/i,
  release: /\b(deploy|production|publish|release)\b/i,
  money: /\b(payment|billing|invoice|subscription)\b/i,
  architecture: /\b(architecture|interface|api boundary|system design)\b/i,
};
const REVIEW = /\b(why|explain|verify|check|test|review|show me|open the diff|wrong|instead|revert)\b/i;

function promptText(row) {
  if (row?.payload?.type === "user_message") return row.payload.message || "";
  if (row?.type !== "user" && row?.message?.role !== "user") return "";
  const content = row.message?.content ?? row.content ?? "";
  return typeof content === "string" ? content : Array.isArray(content) ? content.map((item) => item?.text || "").join(" ") : "";
}

function safeEvidence(text) {
  return text.replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[secret]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [secret]")
    .replace(/\b(password|api[_-]?key|token)\s*[:=]\s*\S+/gi, "$1=[secret]")
    .replace(/\s+/g, " ").trim().slice(0, 100);
}

export function extractDecisions(files, max = 200) {
  const decisions = [];
  for (const file of files) {
    let rows;
    try { rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse); } catch { continue; }
    const prompts = rows.map(promptText).filter(Boolean);
    if (!prompts.length) continue;
    const toolContext = rows.filter((row) => ["function_call", "custom_tool_call"].includes(row?.payload?.type)).map((row) => JSON.stringify(row.payload)).join(" ");
    const context = `${prompts.join(" ")} ${toolContext}`;
    const reviewed = prompts.slice(1).some((text) => REVIEW.test(text));
    let observedAt;
    try { observedAt = fs.statSync(file).mtime.toISOString(); } catch { continue; }
    for (const [category, pattern] of Object.entries(CATEGORIES)) {
      if (pattern.test(context)) decisions.push({ category, reviewed, observedAt, evidence: safeEvidence(prompts[0]), file: path.basename(file) });
    }
  }
  return decisions.sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, max);
}

export function reviewSessions(decisions, category, now = Date.now(), max = 5) {
  const cutoff = now - 7 * 86400000;
  return decisions.filter((item) => item.category === category && !item.reviewed && Date.parse(item.observedAt) >= cutoff).slice(0, max);
}

function atomicWrite(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function updateLearnedProfile(configDir, files) {
  const ignoredFile = path.join(configDir, "ignored.json");
  let ignored = [];
  try { ignored = JSON.parse(fs.readFileSync(ignoredFile, "utf8")); } catch {}
  const decisions = extractDecisions(files, 200).filter((item) => !ignored.includes(item.category));
  const groups = Object.groupBy ? Object.groupBy(decisions, (item) => item.category) : decisions.reduce((out, item) => ((out[item.category] ||= []).push(item), out), {});
  const seen = Object.entries(groups).map(([category, items]) => {
    const reviewed = items.filter((item) => item.reviewed).length;
    const confidence = items.length >= 5 ? "medium" : "low";
    return `- I may be seeing repeated **${category}** decisions: ${items.length}; ${reviewed} showed review. Confidence: ${confidence}. Evidence: “${items[0].evidence}”`;
  });
  const learning = Object.entries(groups).filter(([, items]) => items.length < 5).map(([category]) => `- Is **${category}** something you want to stay good at? Not confirmed; never used for a strong intervention.`);
  const text = `# Learned profile\n\nGenerated locally from ${decisions.length} meaningful decisions (maximum 200). Edit USER.md to correct identity; use \`dura-mater forget <topic>\` to remove an observation.\n\n## You told me\n\nUSER.md is authoritative. Stated facts always win.\n\n## I've seen\n\n${seen.join("\n") || "Nothing reliable yet."}\n\n## Still learning\n\n${learning.join("\n") || "No open hypotheses."}\n`;
  atomicWrite(path.join(configDir, "decisions.json"), `${JSON.stringify(decisions, null, 2)}\n`);
  atomicWrite(path.join(configDir, "LEARNED.md"), text);
  return { decisions, text };
}

export function forgetObservation(configDir, category) {
  const file = path.join(configDir, "ignored.json");
  let ignored = [];
  try { ignored = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  if (!ignored.includes(category)) ignored.push(category);
  atomicWrite(file, `${JSON.stringify(ignored.sort(), null, 2)}\n`);
}
