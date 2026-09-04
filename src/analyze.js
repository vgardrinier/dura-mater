import fs from "node:fs";

const REVIEW = /\b(why|explain|verify|check|test|review|show me|open the diff|sure)\b/i;
const CORRECT = /\b(wrong|instead|revert|undo|not what|change that|fix that|you missed)\b/i;
const IMPORTANT = {
  access: /\b(auth(?:entication|orization)?|security|permissions?|credentials?|secrets?|access)\b/i,
  data: /\b(database|migration|schema|delete|drop|truncate)\b/i,
  release: /\b(deploy|production|publish|release)\b/i,
  money: /\b(payment|billing|invoice|subscription)\b/i,
  architecture: /\b(architecture|interface|api boundary|data model)\b/i,
};

function userText(row) {
  const payload = row?.payload || {};
  if (payload.type === "user_message") return payload.message || "";
  if (row?.type !== "user" && row?.message?.role !== "user") return "";
  const content = row.message?.content ?? row.content ?? "";
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((item) => item?.text || "").join(" ") : "";
}

function meaningfulUserText(row) {
  if (row?.toolUseResult || row?.sourceToolAssistantUUID) return "";
  const text = userText(row).trim();
  if (!text || text.length < 3) return "";
  if (/^(The following is the Codex agent history|<codex_internal_context|<environment_context|# AGENTS\.md instructions)/i.test(text)) return "";
  return text;
}

function toolDecisionCategories(row) {
  const payload = row?.payload || {};
  if (!["function_call", "custom_tool_call"].includes(payload.type)) return [];
  const name = String(payload.name || "");
  if (!/(exec|bash|shell|terminal|command)/i.test(name)) return [];
  const input = String(payload.arguments || payload.input || "");
  const patterns = {
    access: /\b(chmod|chown|oauth|iam|authentication|authorization)\b/i,
    data: /\b(psql|mysql|sqlite|prisma|drizzle|sequelize|alembic|migrat(?:e|ion)|schema\.sql|database)\b/i,
    release: /\b(deploy|npm publish|vercel|terraform apply|production)\b/i,
    money: /\b(stripe|billing|payment)\b/i,
  };
  return Object.entries(patterns).filter(([, pattern]) => pattern.test(input)).map(([category]) => category);
}

function isAction(row) {
  const payload = row?.payload || {};
  if (payload.type === "function_call" || payload.type === "custom_tool_call") return true;
  const content = row?.message?.content ?? row?.content;
  return Array.isArray(content) && content.some((item) => item?.type === "tool_use");
}

export function analyzeFiles(files, now = Date.now()) {
  const weekAgo = now - 7 * 86400000;
  const total = { sessions: 0, actions: 0, important: 0, reviewed: 0, corrected: 0, unreviewed: 0, parsed: 0, malformed: 0, categories: {} };
  for (const file of files) {
    let modified;
    try { modified = fs.statSync(file).mtimeMs; if (modified < weekAgo || modified > now + 1000) continue; } catch { continue; }
    let actions = 0, reviews = 0, corrections = 0, users = 0;
    let firstPrompt = "";
    const decisions = new Set();
    const correctedDecisions = new Set();
    let lines;
    try { lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean); } catch { continue; }
    for (const line of lines) {
      let row;
      try { row = JSON.parse(line); total.parsed += 1; } catch { total.malformed += 1; continue; }
      const text = meaningfulUserText(row);
      if (text) {
        users += 1;
        if (!firstPrompt) firstPrompt = text;
        for (const [kind, pattern] of Object.entries(IMPORTANT)) {
          if (pattern.test(text)) decisions.add(kind);
        }
        if (users > 1 && (REVIEW.test(text) || CORRECT.test(text))) reviews += 1;
        if (users > 1 && CORRECT.test(text)) {
          corrections += 1;
          for (const [kind, pattern] of Object.entries(IMPORTANT)) if (pattern.test(text)) correctedDecisions.add(kind);
        }
      }
      if (isAction(row)) {
        actions += 1;
        for (const category of toolDecisionCategories(row)) decisions.add(category);
      }
    }
    total.sessions += 1;
    total.actions += actions;
    if (!firstPrompt) decisions.clear();
    total.important += decisions.size;
    for (const category of decisions) {
      const bucket = total.categories[category] ||= { sessions: 0, reviewed: 0, unreviewed: 0, corrected: 0, evidence: [] };
      bucket.sessions += 1;
      if (reviews > 0) bucket.reviewed += 1;
      else {
        bucket.unreviewed += 1;
        if (firstPrompt && bucket.evidence.length < 5) bucket.evidence.push({
          observedAt: new Date(modified).toISOString(),
          prompt: firstPrompt.replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[secret]").replace(/\b(password|api[_-]?key|token)\s*[:=]\s*\S+/gi, "$1=[secret]").replace(/\s+/g, " ").trim().slice(0, 100),
        });
      }
      if (correctedDecisions.has(category)) bucket.corrected += 1;
    }
    total.reviewed += reviews > 0 ? decisions.size : 0;
    total.corrected += [...correctedDecisions].filter((category) => decisions.has(category)).length;
    total.unreviewed += reviews > 0 ? 0 : decisions.size;
  }
  const known = total.parsed + total.malformed;
  total.confidence = known === 0 ? "low" : total.malformed / known > 0.1 ? "low" : "directional";
  total.coverage = known === 0 ? 0 : Math.round(100 * total.parsed / known);
  return total;
}
