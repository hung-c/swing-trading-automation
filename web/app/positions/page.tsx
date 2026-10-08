import { Empty, Nav, Setup } from "@/components/Nav";
import { CloseButton, PositionForm } from "@/components/PositionForm";
import { openR, usd } from "@/lib/format";
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
              Execution stays on Webull. Record the fill here so heat, 2R, and the 8-EMA trail have something to manage.
            </p>
          </div>
        </div>
        {!snap.configured ? <Setup /> : null}
        {snap.configured && !snap.positions.length ? (
          <Empty title="No open positions" body="When you take a plan, log the fill below. Intraday jobs will then watch stop / 2R / failed breakout." />
        ) : null}
        {snap.positions.length ? (
          <div className="card" style={{ padding: 0 }}>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {snap.positions.map((p) => {
                  const last = snap.prices[p.symbol];
                  const r = openR(p.entry, p.stop, p.initial_stop, last);
                  return (
                    <tr key={p.symbol}>
                      <td>
                        {p.symbol}
                        {p.half_sold ? <span className="chip">half</span> : null}
                      </td>
                      <td>{p.opened}</td>
                      <td>{usd(p.entry)}</td>
                      <td>{usd(p.stop)}</td>
                      <td>{last != null ? usd(last) : "—"}</td>
                      <td className={r != null && r < 0 ? "neg" : "pos"}>{r != null ? `${r.toFixed(2)}R` : "—"}</td>
                      <td>{p.shares}</td>
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
        <PositionForm />
      </main>
    </>
  );
}
