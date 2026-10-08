import { readFileSync } from "fs";
import { join } from "path";
import {
  REVIEW_SECTIONS,
  dedupeFindings,
  ruleFindings,
  thesisFindings,
  type ReviewFinding,
  type ReviewSection,
  type ReviewSeverity,
  type StrategyReview,
} from "./strategy-review";
import type { Strategy } from "./strategy";

const SYSTEM = [
  "You review a swing-trading strategy document for a human.",
  "The thesis is one sentence. It will not mention every parameter. Do not flag a rule just because the thesis omits it.",
  "Flag a conflict only when the thesis claims something the rules contradict.",
  "Flag a gap only when a gate the thesis depends on is missing, or the evaluator text is too vague to judge one ticker.",
  "Do not rewrite the document and do not invent numbers. Only refer to values that appear in the document.",
  'Return ONLY JSON: {"notes":[{"severity":"conflict"|"gap"|"note","section":"Profile"|"Scanner"|"Technical"|"Risk"|"Regime"|"News"|"Alerts"|"Management"|"Evaluator","message":"..."}]}',
  "At most 4 notes. Each message at most 220 characters. If the rules fit the thesis, return {\"notes\":[]}.",
].join(" ");

const GROQ_MODELS = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"];
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

function rootKey(name: string): string | null {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  try {
    const text = readFileSync(join(process.cwd(), "..", ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith(`${name}=`)) continue;
      let v = line.slice(name.length + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v) return v;
    }
  } catch {
    /* Vercel has no repo-root .env; process.env is the source there. */
  }
  return null;
}

function asNotes(raw: string): ReviewFinding[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json");
  const data = JSON.parse(raw.slice(start, end + 1)) as { notes?: unknown };
  if (!Array.isArray(data.notes)) return [];
  const sections = new Set<string>(REVIEW_SECTIONS);
  const severities = new Set<string>(["conflict", "gap", "note"]);
  const out: ReviewFinding[] = [];
  for (const item of data.notes) {
    if (!item || typeof item !== "object") continue;
    const row = item as { severity?: unknown; section?: unknown; message?: unknown };
    const severity = String(row.severity ?? "");
    const section = String(row.section ?? "");
    const message = String(row.message ?? "").trim().slice(0, 280);
    if (!severities.has(severity) || !sections.has(section) || !message) continue;
    out.push({ severity: severity as ReviewSeverity, section: section as ReviewSection, message });
  }
  return out.slice(0, 6);
}

async function chat(url: string, apiKey: string, model: string, strategy: Strategy): Promise<ReviewFinding[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(strategy) },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? "";
  return asNotes(content);
}

async function modelNotes(strategy: Strategy): Promise<{ provider: string; notes: ReviewFinding[] } | null> {
  const groq = rootKey("GROQ_KEY");
  if (groq) {
    for (const model of GROQ_MODELS) {
      try {
        return { provider: "groq", notes: await chat("https://api.groq.com/openai/v1/chat/completions", groq, model, strategy) };
      } catch {
        /* try the next model, then Gemini */
      }
    }
  }
  const gemini = rootKey("GEMINI_KEY");
  if (gemini) {
    for (const model of GEMINI_MODELS) {
      try {
        return {
          provider: "gemini",
          notes: await chat("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", gemini, model, strategy),
        };
      } catch {
        /* next model */
      }
    }
  }
  return null;
}

/** Rule pass first. The model only adds thesis-versus-rules notes, and nothing is written back. */
export async function buildReview(strategy: Strategy): Promise<StrategyReview> {
  const rules = ruleFindings(strategy);
  const model = await modelNotes(strategy);
  if (!model) {
    return { findings: dedupeFindings([...rules, ...thesisFindings(strategy)]), provider: "rules" };
  }
  return { findings: dedupeFindings([...rules, ...model.notes]), provider: model.provider };
}
