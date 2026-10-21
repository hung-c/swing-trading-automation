import Link from "next/link";
import { HashScroll, PlanAnchor } from "@/components/HashScroll";
import { Nav } from "@/components/Nav";
import { PlanCard } from "@/components/PlanCard";
import { PlanChart } from "@/components/PlanChart";
import { loadPlan, loadSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlanDetail({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  const [found, snap] = await Promise.all([loadPlan(sym), loadSnapshot()]);
  const saved = snap.watchlist.filter((w) => w.symbol === sym);
  const position = snap.positions.find((p) => p.symbol === sym && p.originalPlan && p.planId && !saved.some((item) => item.id === p.planId));
  const plan = saved[0]?.plan ?? position?.originalPlan ?? found?.plan;
  const day = found?.day ?? saved[0]?.planDate ?? snap.planDate ?? snap.brief?.date;
  const kinds = plan?.chart_paths ? Object.keys(plan.chart_paths) : ["weekly", "daily", "intraday"];

  return (
    <>
      <Nav active="/plans" stamp={plan?.symbol} />
      <main className="shell">
        <HashScroll />
        <p className="lede" style={{ marginTop: 22 }}>
          <Link href="/plans">← Plans</Link>
        </p>
        {plan ? (
          <>
            <div className="page-head">
              <h1 style={{ margin: 0 }}>{plan.symbol}</h1>
            </div>
            {saved.length || position ? (
              <>
                {saved.map((item) => (
                  <PlanAnchor key={item.id} id={`plan-${item.id}`}>
                    <PlanCard plan={item.plan} item={item} peers={saved} price={snap.prices[item.symbol]} />
                  </PlanAnchor>
                ))}
                {position?.originalPlan && position.planId ? (
                  <PlanAnchor id={`plan-${position.planId}`}>
                    <PlanCard plan={position.originalPlan} price={snap.prices[position.symbol]} />
                  </PlanAnchor>
                ) : null}
              </>
            ) : (
              <PlanCard plan={plan} price={snap.prices[plan.symbol]} saved={plan.status !== "rejected" ? false : undefined} />
            )}
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
