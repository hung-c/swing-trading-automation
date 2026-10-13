import { Empty, Nav, Setup } from "@/components/Nav";
import { PlanBoard } from "@/components/PlanBoard";
import { RegimeBanner } from "@/components/RegimeBanner";
import { etDate, num, usd } from "@/lib/format";
import { loadSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const snap = await loadSnapshot();
  const b = snap.brief;
  const regime = snap.premarket?.regime ?? b?.regime ?? null;
  const stamp = b ? `${etDate(b.date)} · ${b.kind}${b.llm_provider ? ` · ${b.llm_provider}` : ""}` : null;

  return (
    <>
      <Nav active="/" stamp={stamp} />
      <main className="shell">
        {!snap.configured ? <Setup /> : null}
        {snap.configured && !b ? (
          <Empty title="Waiting for the first nightly run" body="GitHub Actions writes briefs into Neon. After swing nightly finishes, this page fills in automatically." />
        ) : null}
        {b ? (
          <>
            <div className="page-head">
              <div>
                <h1>{b.prose?.headline ?? "Nightly brief"}</h1>
                <p className="lede">{b.prose?.market_summary}</p>
              </div>
            </div>
            {regime ? <RegimeBanner regime={regime} /> : null}

            <div className="grid grid-4" style={{ margin: "16px 0" }}>
              <div className="stat">
                <div className="k">Scan A</div>
                <div className="v">{b.screen_count_strict ?? "—"}</div>
                <div className="s">{b.screen_count_final ?? 0} after ladder {b.ladder_step_used ?? 0}</div>
              </div>
              <div className="stat">
                <div className="k">Plans</div>
                <div className="v">{b.plans?.length ?? 0}</div>
                <div className="s">{b.rejected?.length ?? 0} rejected · weekly {b.weekly_survivors ?? "—"}</div>
              </div>
              <div className="stat">
                <div className="k">Heat</div>
                <div className="v">{b.heat_pct != null ? `${num(b.heat_pct, 1)}%` : "—"}</div>
                <div className="s">{snap.positions.length} open · cap 6%</div>
              </div>
              <div className="stat">
                <div className="k">Alerts today</div>
                <div className="v">{snap.alerts.filter((a) => a.day === b.date).length}</div>
                <div className="s">{snap.alerts.filter((a) => a.actionable).length} actionable</div>
              </div>
            </div>

            {b.warnings?.length ? (
              <p className="warn-list">{b.warnings.join(" · ")}</p>
            ) : null}

            <PlanBoard
              plans={b.plans}
              rejected={b.rejected}
              watchlist={snap.watchlist}
              prices={snap.prices}
              scanDay={b.date}
              commentary={b.prose?.watchlist_commentary}
            />

            <div className="grid grid-2" style={{ marginTop: 18 }}>
              <section className="card prose">
                <h3>Risk</h3>
                <p>{b.prose?.risk_notes}</p>
                {(regime?.macro_today ?? []).length ? (
                  <>
                    <h3>Macro today</h3>
                    <p>{regime!.macro_today!.map((m) => `${m.name} ${m.time_et} ET`).join(" · ")}</p>
                  </>
                ) : null}
              </section>
              <section className="card">
                <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Tomorrow checklist</h3>
                <ul className="check">
                  {(b.prose?.tomorrow_checklist ?? []).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </section>
            </div>

            {(b.news ?? []).some((n) => (n.items?.length ?? 0) > 0 || (n.red_flags?.length ?? 0) > 0) ? (
              <section className="card" style={{ marginTop: 18 }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>News</h3>
                {(b.news ?? []).map((n) => (
                  <p key={n.symbol} className="notes">
                    <strong>{n.symbol}</strong>
                    {n.red_flags?.length ? ` · flags: ${n.red_flags.join(", ")}` : ""}
                    {n.items?.[0] ? ` — ${n.items[0].headline}` : ""}
                  </p>
                ))}
              </section>
            ) : null}

            {snap.positions.length ? (
              <section className="card" style={{ marginTop: 18 }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Open positions</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Entry</th>
                      <th>Stop</th>
                      <th>Last</th>
                      <th>Shares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.positions.map((p) => (
                      <tr key={p.symbol}>
                        <td>{p.symbol}</td>
                        <td>{usd(p.entry)}</td>
                        <td>{usd(p.stop)}</td>
                        <td>{snap.prices[p.symbol] != null ? usd(snap.prices[p.symbol]) : "—"}</td>
                        <td>{p.shares}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
