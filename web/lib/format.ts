import type { PlanCard, Sizing } from "./types";

export function usd(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits });
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function patternName(p: string): string {
  return p.replaceAll("_", " ");
}

export function sizingLabel(s: Sizing | undefined): string {
  if (s === "full") return "Full size";
  if (s === "half") return "Half size";
  if (s === "none") return "No new entries";
  return "Sizing n/a";
}

export function etTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });
}

export function etDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T16:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
}

export function distanceToEntry(plan: PlanCard, price?: number): { pct: number; label: string; tone: "ok" | "warn" | "chase" } | null {
  if (price == null || !plan.entry) return null;
  const p = ((price - plan.entry) / plan.entry) * 100;
  if (p > 1) return { pct: p, label: `${pct(p)} above entry — no chase`, tone: "chase" };
  if (p >= 0) return { pct: p, label: `${pct(p)} through entry`, tone: "warn" };
  return { pct: p, label: `${pct(p)} to entry`, tone: "ok" };
}

export function openR(entry: number, stop: number, initialStop: number, price?: number): number | null {
  const risk = entry - initialStop;
  if (!risk) return null;
  const px = price ?? entry;
  return (px - entry) / risk;
}
