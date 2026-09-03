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

function isAction(row) {
  const payload = row?.payload || {};
  if (payload.type === "function_call" || payload.type === "custom_tool_call") return true;
  const content = row?.message?.content ?? row?.content;
  return Array.isArray(content) && content.some((item) => item?.type === "tool_use");
}

export function analyzeFiles(files, now = Date.now()) {
  const weekAgo = now - 7 * 86400000;
  const total = { sessions: 0, actions: 0, important: 0, reviewed: 0, corrected: 0, unreviewed: 0, parsed: 0, malformed: 0 };
  for (const file of files) {
    try { if (fs.statSync(file).mtimeMs < weekAgo) continue; } catch { continue; }
    let actions = 0, reviews = 0, corrections = 0, users = 0;
    const decisions = new Set();
    let lines;
    try { lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean); } catch { continue; }
    for (const line of lines) {
      let row;
      try { row = JSON.parse(line); total.parsed += 1; } catch { total.malformed += 1; continue; }
      const text = userText(row);
      if (text) {
        users += 1;
        for (const [kind, pattern] of Object.entries(IMPORTANT)) {
          if (pattern.test(text)) decisions.add(kind);
        }
        if (users > 1 && (REVIEW.test(text) || CORRECT.test(text))) reviews += 1;
        if (users > 1 && CORRECT.test(text)) corrections += 1;
      }
      if (isAction(row)) {
        actions += 1;
        const action = JSON.stringify(row);
        for (const [kind, pattern] of Object.entries(IMPORTANT)) {
          if (pattern.test(action)) decisions.add(kind);
        }
      }
    }
    total.sessions += 1;
    total.actions += actions;
    total.important += decisions.size;
    total.reviewed += Math.min(decisions.size, reviews);
    total.corrected += corrections;
    total.unreviewed += Math.max(0, decisions.size - reviews);
  }
  const known = total.parsed + total.malformed;
  total.confidence = known === 0 ? "low" : total.malformed / known > 0.1 ? "low" : "directional";
  total.coverage = known === 0 ? 0 : Math.round(100 * total.parsed / known);
  return total;
}
