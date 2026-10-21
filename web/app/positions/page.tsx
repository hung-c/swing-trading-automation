import Link from "next/link";
import { Empty, Nav, Setup } from "@/components/Nav";
import { HoverTip } from "@/components/HoverTip";
import { CloseButton, PositionForm, PositionPlanSwitch } from "@/components/PositionForm";
import { openR, stanceLabel, usd } from "@/lib/format";
import { loadSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const snap = await loadSnapshot();
  return (
    <>
      <Nav active="/positions" />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>Positions</h1>
            <p className="lede">
              Execution stays on Webull. Record the fill against one plan. Each update says keep, exit, sell half, raise stop, or decide.
            </p>
          </div>
        </div>
        {!snap.configured ? <Setup /> : null}
        {snap.configured && !snap.positions.length ? (
          <Empty title="No open positions" body="When you take a plan, log the fill below. Intraday jobs will then watch stop / 2R / failed breakout." />
        ) : null}
        {snap.positions.length ? (
          <div className="card table-scroll" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Opened</th>
                  <th>Entry</th>
                  <th>Stop</th>
                  <th>Last</th>
                  <th>R</th>
                  <th>Shares</th>
                  <th>Stance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {snap.positions.map((p) => {
                  const last = snap.prices[p.symbol];
                  const r = openR(p.entry, p.stop, p.initial_stop, last);
                  const label = stanceLabel(p.stance);
                  return (
                    <tr key={p.symbol}>
                      <td>
                        <Link href={`/positions/${p.symbol}`} className="pos-link">
                          {p.symbol}
                        </Link>
                        {p.half_sold ? <span className="chip">half</span> : null}
                      </td>
                      <td>{p.opened}</td>
                      <td>{usd(p.entry)}</td>
                      <td>{usd(p.stop)}</td>
                      <td>{last != null ? usd(last) : "—"}</td>
                      <td className={r != null && r < 0 ? "neg" : "pos"}>{r != null ? `${r.toFixed(2)}R` : "—"}</td>
                      <td>{p.shares}</td>
                      <td>
                        {label ? (
                          <HoverTip
                            className={`chip help ${p.stance === "exit" ? "bad" : p.stance === "keep" ? "ok" : "warn"}`}
                            tip={p.stanceReason ?? label}
                          >
                            {label}
                          </HoverTip>
                        ) : (
                          "—"
                        )}
                        <PositionPlanSwitch symbol={p.symbol} planId={p.planId} plans={snap.watchlist} />
                      </td>
                      <td>
                        <CloseButton symbol={p.symbol} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <h3 style={{ margin: "28px 0 0" }}>Log a fill</h3>
        <PositionForm plans={snap.watchlist} />
      </main>
    </>
  );
}
