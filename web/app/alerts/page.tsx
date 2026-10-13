import { Empty, Nav, Setup } from "@/components/Nav";
import { etTime, usd } from "@/lib/format";
import { loadSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const snap = await loadSnapshot();
  return (
    <>
      <Nav active="/alerts" />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>Intraday alerts</h1>
            <p className="lede">
              A ticker alerts only after you save it to the watchlist. It stays on that list until you remove it. Open positions still alert on stop and 2R.
            </p>
          </div>
        </div>
        {!snap.configured ? <Setup /> : null}
        {snap.configured && !snap.alerts.length ? (
          <Empty title="No alerts yet" body="Save a plan to the watchlist. The 15-minute job then writes one row per saved symbol, condition, and day." />
        ) : null}
        {snap.alerts.length ? (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Time ET</th>
                  <th>Symbol</th>
                  <th>Condition</th>
                  <th>Price</th>
                  <th>RVOL</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {snap.alerts.map((a) => (
                  <tr key={`${a.day}-${a.symbol}-${a.condition}`}>
                    <td className="mono">{etTime(a.ts)}</td>
                    <td>{a.symbol}</td>
                    <td>
                      {a.condition}
                      {a.actionable ? <span className="chip ok">go</span> : null}
                    </td>
                    <td>{usd(a.price)}</td>
                    <td>{a.rvol != null ? a.rvol.toFixed(2) : "—"}</td>
                    <td className="notes" style={{ color: "var(--muted)" }}>
                      {a.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </main>
    </>
  );
}
