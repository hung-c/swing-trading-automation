import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

let loaded = false;

/** Process env first, then the pipeline `.env` next to `web/` when running locally. */
export function pipelineEnv(name: string): string | undefined {
  loadPipelineEnv();
  const v = process.env[name];
  return v && v.length ? v : undefined;
}

function loadPipelineEnv() {
  if (loaded) return;
  loaded = true;
  const path = resolve(process.cwd(), "..", ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let value = t.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
