import Link from "next/link";
import { Nav } from "@/components/Nav";
import { PlanCard } from "@/components/PlanCard";
import { loadPlan, loadSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlanDetail({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const [found, snap] = await Promise.all([loadPlan(symbol), loadSnapshot()]);
  const plan = found?.plan;
  const day = found?.day ?? snap.planDate ?? snap.brief?.date;
  const kinds = plan?.chart_paths ? Object.keys(plan.chart_paths) : ["weekly", "daily", "intraday"];

  return (
    <>
      <Nav active="/plans" stamp={plan?.symbol} />
      <main className="shell">
        <p className="lede" style={{ marginTop: 22 }}>
          <Link href="/plans">← Plans</Link>
        </p>
        {plan ? (
          <>
            <div className="page-head">
              <h1 style={{ margin: 0 }}>{plan.symbol}</h1>
            </div>
            <PlanCard plan={plan} price={snap.prices[plan.symbol]} />
            <div className="grid" style={{ marginTop: 16 }}>
              {kinds.map((kind) => (
                <figure key={kind} className="card" style={{ padding: 10 }}>
                  <figcaption className="pat" style={{ margin: "4px 8px 8px" }}>
                    {kind}
                  </figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="chart"
                    alt={`${plan.symbol} ${kind}`}
                    src={`/api/chart/${day}/${plan.symbol}/${kind}`}
                  />
                </figure>
              ))}
            </div>
          </>
        ) : (
          <div className="card empty">
            <h2>{symbol.toUpperCase()} not in the journal</h2>
          </div>
        )}
      </main>
    </>
  );
}
