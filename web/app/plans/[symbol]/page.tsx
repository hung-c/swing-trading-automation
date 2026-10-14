import Link from "next/link";
import { Nav } from "@/components/Nav";
import { PlanCard } from "@/components/PlanCard";
import { PlanChart } from "@/components/PlanChart";
import { loadPlan, loadSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlanDetail({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  const [found, snap] = await Promise.all([loadPlan(sym), loadSnapshot()]);
  const saved = snap.watchlist.find((w) => w.symbol === sym);
  const plan = saved?.plan ?? found?.plan;
  const day = found?.day ?? saved?.planDate ?? snap.planDate ?? snap.brief?.date;
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
            <PlanCard
              plan={plan}
              price={snap.prices[plan.symbol]}
              saved={saved || plan.status !== "rejected" ? Boolean(saved) : undefined}
            />
            <div style={{ marginTop: 16 }}>
              <PlanChart
                symbol={plan.symbol}
                pattern={plan.pattern}
                levels={{
                  resistance: plan.resistance,
                  entry: plan.entry,
                  stop: plan.stop,
                  target2r: plan.target_2r,
                  target3r: plan.target_3r,
                  alert: plan.alert_level,
                }}
              />
            </div>
            {day ? (
              <details className="card ichart-shots">
                <summary>Saved snapshots</summary>
                <div className="grid">
                  {kinds.map((kind) => (
                    <figure key={kind}>
                      <figcaption className="pat">{kind}</figcaption>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="chart" alt={`${plan.symbol} ${kind}`} src={`/api/chart/${day}/${plan.symbol}/${kind}`} />
                    </figure>
                  ))}
                </div>
              </details>
            ) : null}
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
