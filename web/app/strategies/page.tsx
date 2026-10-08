import Link from "next/link";
import { Empty, Nav, Setup } from "@/components/Nav";
import { BUILTIN_STRATEGY_ID, gatesOn, STRATEGY_SECTIONS } from "@/lib/strategy";
import { loadStrategies } from "@/lib/strategies";

export const dynamic = "force-dynamic";

function when(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function StrategiesPage() {
  const { configured, strategies } = await loadStrategies();

  return (
    <>
      <Nav active="/strategies" />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>Strategies</h1>
            <p className="lede">
              A strategy is one complete rule set: who you trade, how you find them, how you size, and how you get out.
              Add as many as you want and edit any section later.
            </p>
          </div>
          <Link className="btn" href="/strategies/new">
            Add strategy
          </Link>
        </div>

        {!configured ? <Setup /> : null}

        <div className="grid grid-3" style={{ marginBottom: 22 }}>
          {STRATEGY_SECTIONS.map((s) => (
            <div key={s.id} className="stat">
              <div className="k">{s.title}</div>
              <div className="s" style={{ marginTop: 8, lineHeight: 1.4 }}>
                {s.summary}
              </div>
            </div>
          ))}
        </div>

        {configured && !strategies.length ? (
          <Empty
            title="No strategies saved"
            body="Add a strategy to store your own scanner, technical, news, and risk rules. The form starts from the swing routine already in this desk."
          />
        ) : null}

        {strategies.length ? (
          <div className="grid">
            {strategies.map((row) => (
              <Link key={row.id} href={`/strategies/${row.id}`} className="plan">
                <div className="plan-top">
                  <div>
                    <div className="sym" style={{ fontSize: 18 }}>
                      {row.name}
                    </div>
                    <div className="pat">
                      {row.strategy.profile.style} · {row.strategy.profile.horizon_days}d hold
                      {row.updatedAt ? ` · ${when(row.updatedAt)}` : ""}
                    </div>
                  </div>
                  <div className="pills">
                    {row.id === BUILTIN_STRATEGY_ID ? <span className="chip">built-in</span> : null}
                    <span className={`chip ${row.status === "active" ? "ok" : row.status === "paused" ? "warn" : ""}`}>
                      {row.status}
                    </span>
                  </div>
                </div>
                <p className="notes">{row.strategy.profile.thesis}</p>
                <div className="pills">
                  {gatesOn(row.strategy).map((g) => (
                    <span key={g} className="pill on">
                      {g}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </main>
    </>
  );
}
