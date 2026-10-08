import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let cached: Sql | null | undefined;

export function getSql(): Sql | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  cached = url ? neon(url) : null;
  return cached;
}

export function rows<T extends Record<string, unknown>>(result: unknown): T[] {
  return (Array.isArray(result) ? result : []) as T[];
}

export function first<T extends Record<string, unknown>>(result: unknown): T | undefined {
  return rows<T>(result)[0];
}

export function asObj<T>(v: unknown): T {
  if (v == null) throw new Error("expected json value");
  if (typeof v === "string") return JSON.parse(v) as T;
  return v as T;
}

export function asDate(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export function toPngBuffer(png: unknown): Buffer {
  if (Buffer.isBuffer(png)) return png;
  if (png instanceof Uint8Array) return Buffer.from(png);
  if (typeof png === "string") {
    const hex = png.startsWith("\\x") || png.startsWith("\\\\x") ? png.replace(/^\\+x/, "") : png;
    return Buffer.from(hex, hex.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hex.slice(0, 16)) ? "hex" : "base64");
  }
  if (png && typeof png === "object" && "data" in (png as { data?: unknown })) {
    return Buffer.from((png as { data: number[] }).data);
  }
  throw new Error("unexpected chart payload type");
}
