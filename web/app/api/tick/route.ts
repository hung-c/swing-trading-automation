import { NextResponse } from "next/server";

import { loadTickStatus } from "@/lib/load-tick-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await loadTickStatus();
  return NextResponse.json(status);
}
