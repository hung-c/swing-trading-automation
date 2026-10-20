import Link from "next/link";
import { Nav } from "@/components/Nav";
import { PlanCard } from "@/components/PlanCard";
import { PlanChart } from "@/components/PlanChart";
import { PositionPlanSwitch } from "@/components/PositionForm";
import { openR, stanceLabel, usd } from "@/lib/format";
import { loadSnapshot } from "@/lib/queries";
import type { ChartLevels } from "@/lib/chart-math";

export const dynamic = "force-dynamic";

export default async function PositionDetail({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  const snap = await loadSnapshot();
  const position = snap.positions.find((p) => p.symbol === sym);
  const plan = position?.originalPlan ?? null;
  const last = position ? snap.prices[position.symbol] : undefined;
  const r = position ? openR(position.entry, position.stop, position.initial_stop, last) : null;
  const label = stanceLabel(position?.stance);
  const levels: ChartLevels | null = position
    ? {
        resistance: plan?.resistance ?? position.resistance ?? position.entry,
        entry: position.entry,
        stop: position.stop,
        target2r: position.target_2r,
        target3r: plan?.target_3r ?? 0,
        alert: plan?.alert_level ?? 0,
      }
    : null;

  return (
    <>
      <Nav active="/positions" stamp={sym} />
      <main className="shell">
        <p className="lede" style={{ marginTop: 22 }}>
          <Link href="/positions">← Positions</Link>
        </p>
        {!position ? (
          <div className="card empty">
            <h2>{sym} is not an open position</h2>
          </div>
        ) : (
          <>
            <div className="page-head">
              <div>
                <h1 style={{ margin: 0 }}>{position.symbol}</h1>
                <p className="lede">The saved plan stays on the left. The chart uses your fill, stop, and target.</p>
              </div>
              {label ? (
                <span className={`chip ${position.stance === "exit" ? "bad" : position.stance === "keep" ? "ok" : "warn"}`}>
                  {label}
                </span>
              ) : null}
            </div>
            {position.stanceReason ? <p className="lede">{position.stanceReason}</p> : null}
            <div className="grid grid-2" style={{ marginTop: 16 }}>
              <section>
                <h3 style={{ margin: "0 0 8px" }}>Plan</h3>
                {plan ? (
                  <PlanCard plan={plan} price={last} />
                ) : (
                  <div className="card empty">
                    <h2>No saved plan</h2>
                    <p>This fill has no frozen plan. The chart still shows the stop and target you logged.</p>
                  </div>
                )}
              </section>
              <section className="card">
                <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Your position</h3>
                <div className="levels">
                  <div className="lv entry">
                    <div className="k">Fill</div>
                    <div className="v">{usd(position.entry)}</div>
                  </div>
                  <div className="lv stop">
                    <div className="k">SL</div>
                    <div className="v">{usd(position.stop)}</div>
                  </div>
                  <div className="lv tgt">
                    <div className="k">TP · {position.shares} sh</div>
                    <div className="v">{usd(position.target_2r)}</div>
                  </div>
                  <div className="lv">
                    <div className="k">Last · {r != null ? `${r.toFixed(2)}R` : "R"}</div>
                    <div className="v">{last != null ? usd(last) : "—"}</div>
                  </div>
                </div>
                <p className="notes" style={{ marginTop: 12 }}>
                  Opened {position.opened}
                  {position.half_sold ? " · half sold" : ""}
                  {position.pattern ? ` · ${position.pattern.replaceAll("_", " ")}` : ""}
                </p>
                <PositionPlanSwitch symbol={position.symbol} planId={position.planId} plans={snap.watchlist} />
              </section>
            </div>
            {levels ? (
              <div style={{ marginTop: 16 }}>
                <PlanChart
                  symbol={position.symbol}
                  pattern={plan?.pattern ?? position.pattern ?? "none"}
                  levels={levels}
                  names={{ entry: "Fill", stop: "SL", target2r: "TP", resistance: "Plan high", target3r: "3R", alert: "Alert" }}
                />
              </div>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
