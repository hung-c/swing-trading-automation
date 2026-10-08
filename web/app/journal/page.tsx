import { Empty, Nav, Setup } from "@/components/Nav";
import { usd } from "@/lib/format";
import { loadSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const snap = await loadSnapshot();
  const rs = snap.trades.map((t) => t.r_multiple).filter((x): x is number => x != null);
  const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  const wins = rs.filter((r) => r > 0).length;
  return (
    <>
      <Nav active="/journal" />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>Trade journal</h1>
            <p className="lede">Closed trades from fills you recorded. Weekly expectancy still also prints from `swing report`.</p>
          </div>
        </div>
        {!snap.configured ? <Setup /> : null}
        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="k">Trades</div>
            <div className="v">{snap.trades.length}</div>
          </div>
          <div className="stat">
            <div className="k">Win rate</div>
            <div className="v">{rs.length ? `${Math.round((wins / rs.length) * 100)}%` : "—"}</div>
          </div>
          <div className="stat">
            <div className="k">Avg R</div>
            <div className="v">{avg != null ? avg.toFixed(2) : "—"}</div>
          </div>
        </div>
        {snap.configured && !snap.trades.length ? (
          <Empty title="No closed trades" body="Close a position from the Positions page to land it here." />
        ) : null}
        {snap.trades.length ? (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Closed</th>
                  <th>Symbol</th>
                  <th>Pattern</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>R</th>
                </tr>
              </thead>
              <tbody>
                {snap.trades.map((t) => (
                  <tr key={t.id}>
                    <td>{t.closed}</td>
                    <td>{t.symbol}</td>
                    <td>{t.pattern?.replaceAll("_", " ")}</td>
                    <td>{usd(t.entry)}</td>
                    <td>{usd(t.exit_price)}</td>
                    <td className={t.r_multiple != null && t.r_multiple < 0 ? "neg" : "pos"}>
                      {t.r_multiple != null ? `${t.r_multiple.toFixed(2)}R` : "—"}
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
