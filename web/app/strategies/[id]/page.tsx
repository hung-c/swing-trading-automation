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
    <div className="flow-screen">
      <Nav active="/strategies" />
      <StrategyForm initial={row.strategy} id={row.id} />
    </div>
  );
}
