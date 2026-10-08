import Link from "next/link";
import { Nav, Setup } from "@/components/Nav";
import { StrategyForm } from "@/components/StrategyForm";
import { swingTemplate, type Strategy } from "@/lib/strategy";
import { loadStrategy, loadStrategies } from "@/lib/strategies";

export const dynamic = "force-dynamic";

export default async function NewStrategyPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const { configured } = await loadStrategies();
  let initial: Strategy = swingTemplate();
  if (from) {
    const source = await loadStrategy(from);
    if (source) {
      initial = {
        ...source.strategy,
        profile: {
          ...source.strategy.profile,
          name: `Copy of ${source.strategy.profile.name}`.slice(0, 80),
          status: "draft",
        },
      };
    }
  }

  return (
    <>
      <Nav active="/strategies" />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>{from ? "Copy strategy" : "Add strategy"}</h1>
            <p className="lede">
              Ten sections, in the order the desk works: universe, scanner, technicals, risk, regime, news, alerts, management, then the evaluator.
            </p>
          </div>
          <Link className="btn ghost" href="/strategies">
            Back
          </Link>
        </div>
        {!configured ? <Setup /> : <StrategyForm initial={initial} />}
      </main>
    </>
  );
}
