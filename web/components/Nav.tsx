import Link from "next/link";

const TABS = [
  ["/", "Today"],
  ["/strategies", "Strategies"],
  ["/plans", "Plans"],
  ["/positions", "Positions"],
  ["/alerts", "Alerts"],
  ["/journal", "Journal"],
  ["/apis", "APIs"],
] as const;

export function Nav({ active, stamp }: { active: string; stamp?: string | null }) {
  return (
    <header className="nav">
      <div className="nav-inner">
        <div className="brand">
          SWING
          <small>alerts only</small>
        </div>
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} className={`tab${active === href ? " active" : ""}`}>
            {label}
          </Link>
        ))}
        <div className="nav-space" />
        {stamp ? <div className="nav-meta">{stamp}</div> : null}
      </div>
    </header>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="card empty">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

export function Setup() {
  return (
    <div className="card empty">
      <h2>Connect Neon, then deploy</h2>
      <p>
        This app reads the same Postgres journal the GitHub Actions pipeline writes. Add{" "}
        <span className="mono">DATABASE_URL</span> in Vercel (and as a GitHub Actions secret), run{" "}
        <span className="mono">uv run swing db-init</span>, then{" "}
        <span className="mono">uv run swing nightly --force</span>.
      </p>
    </div>
  );
}
