import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav, Setup } from "@/components/Nav";
import { StrategyForm } from "@/components/StrategyForm";
import { getSql } from "@/lib/db";
import { loadStrategy } from "@/lib/strategies";

export const dynamic = "force-dynamic";

export default async function EditStrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSql()) {
    return (
      <>
        <Nav active="/strategies" />
        <main className="shell">
          <Setup />
        </main>
      </>
    );
  }
  const row = await loadStrategy(id);
  if (!row) notFound();

  return (
    <>
      <Nav active="/strategies" />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>{row.name}</h1>
            <p className="lede">Edit any section. Evaluate reviews the rules without saving them. Saving replaces the stored rule set.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link className="btn ghost" href={`/strategies/new?from=${row.id}`}>
              Duplicate
            </Link>
            <Link className="btn ghost" href="/strategies">
              Back
            </Link>
          </div>
        </div>
        <StrategyForm initial={row.strategy} id={row.id} />
      </main>
    </>
  );
}
