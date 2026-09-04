import fs from "node:fs";
import path from "node:path";

export function loadJudgments(configDir) {
  const file = path.join(configDir, "judgments.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export function loadRecalls(configDir) {
  const file = path.join(configDir, "recalls.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export function appendRecall(configDir, recall) {
  fs.appendFileSync(path.join(configDir, "recalls.jsonl"), `${JSON.stringify(recall)}\n`, { mode: 0o600 });
}

const stop = new Set(["a", "an", "and", "are", "be", "can", "for", "i", "in", "is", "it", "me", "my", "of", "on", "only", "should", "the", "to", "we"]);

export function contentWords(text) {
  return [...new Set(String(text || "").toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length >= 3 && !stop.has(word)) || [])];
}

export function isStrongRecall(saved, attempted) {
  const expected = contentWords(saved);
  const actual = new Set(contentWords(attempted));
  if (expected.length < 2 || actual.size < 2) return false;
  return expected.filter((word) => actual.has(word)).length / expected.length >= 0.8;
}

export function judgmentTopic(item) {
  const question = String(item.question || "").toLowerCase();
  if (/email|account/.test(question)) return "account linking";
  if (/grant access/.test(question)) return "permissions";
  if (/migration/.test(question)) return "migration";
  if (/recoverable/.test(question)) return "deletion";
  if (/payment/.test(question)) return "payments";
  if (/boundary/.test(question)) return "architecture";
  return ({ access: "permissions", data: "data", architecture: "architecture" })[item.category] || item.category || "an important decision";
}

function elapsedPhrase(item, recall) {
  const start = Date.parse(item.answeredAt || item.askedAt || "");
  const end = Date.parse(recall.recalledAt || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 5 * 60000) return "A minute later";
  const days = Math.floor((end - start) / 86400000);
  if (days < 1) return "The same day";
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return `${words[days] ? words[days][0].toUpperCase() + words[days].slice(1) : days} day${days === 1 ? "" : "s"} later`;
}

export function formatRecallShare(configDir) {
  const recall = loadRecalls(configDir).at(-1);
  if (!recall || typeof recall.matched !== "boolean") return null;
  const item = loadJudgments(configDir).find((candidate) => candidate.id === recall.judgmentId);
  if (!item) return null;
  const result = recall.matched ? "I still remembered it." : "I gave a different answer.";
  return `AI worked on ${judgmentTopic(item)}.\nI wrote down the rule. ${elapsedPhrase(item, recall)}, ${result}\n- Dura Mater`;
}

export async function recall(configDir, input, output) {
  const item = loadJudgments(configDir).at(-1);
  if (!item) {
    output.write("Nothing to recall yet. Answer the next question Dura Mater asks in Codex.\n");
    return null;
  }
  const interactive = Boolean(input.isTTY && output.isTTY);
  let answer = "";
  if (interactive) {
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({ input, output });
    try { answer = (await rl.question(`${item.question}\nYour call now: `)).trim(); }
    finally { rl.close(); }
    output.write("\n");
  }
  const matched = interactive ? isStrongRecall(item.answer, answer) : null;
  if (interactive) appendRecall(configDir, { judgmentId: item.id, answer, matched, recalledAt: new Date().toISOString() });
  if (!interactive) output.write(`You said: ${item.answer}\n`);
  else if (matched) output.write("Yep. You remembered it.\n");
  else output.write(`Not the same answer. Last time you said:\n${item.answer}\n`);
  if (item.implementation) output.write(`The agent then started with: ${item.implementation}\n`);
  return item;
}
