import { APIS, todayEt, type ApiRow, type ApiTest, type ApiUsage, type AvBudget } from "@/lib/apis";
import { Empty, Nav, Setup } from "@/components/Nav";
import { TestApisButton } from "@/components/TestApisButton";
import { etDate, etTime } from "@/lib/format";
import { loadApiUsage } from "@/lib/queries";

export const dynamic = "force-dynamic";

function groups(): string[] {
  const seen: string[] = [];
  for (const row of APIS) {
    if (!seen.includes(row.group)) seen.push(row.group);
  }
  return seen;
}

function keyChip(row: ApiRow, secrets: Record<string, boolean> | null) {
  if (row.keyless) return <span className="chip">Keyless</span>;
  if (!secrets) return <span className="chip">Unknown</span>;
  const on = Boolean(secrets[row.id]);
  if (row.id === "sec") return <span className={on ? "chip ok" : "chip"}>{on ? "Custom UA" : "Default UA"}</span>;
  if (on) return <span className="chip ok">Set</span>;
  return <span className={row.optional ? "chip warn" : "chip bad"}>{row.optional ? "Optional" : "Missing"}</span>;
}

function meterClass(used: number, cap: number): string {
  const pct = cap ? used / cap : 0;
  if (pct >= 0.9) return "meter hot";
  if (pct >= 0.6) return "meter warn";
  return "meter";
}

const WORKFLOWS = [
  ["nightly", "Nightly"],
  ["premarket", "Premarket"],
  ["intraday", "Intraday"],
] as const;

function jobCalls(usage: ApiUsage | null, job: string, id: string): number {
  return Number(usage?.jobs?.[job]?.calls?.[id] ?? 0);
}

function testCell(id: string, test: ApiTest | null) {
  const row = test?.results.find((r) => r.id === id);
  if (!row) return <td>—</td>;
  const cls = row.state === "ok" ? "chip ok" : row.state === "fail" ? "chip bad" : "chip";
  const label = row.state === "ok" ? "OK" : row.state === "fail" ? "Fail" : "Skip";
  return (
    <td>
      <span className={cls}>{label}</span>
      <div className="notes" style={{ marginTop: 4 }}>{row.detail}</div>
    </td>
  );
}

function todayCell(row: ApiRow, callsToday: number, last: { date: string; n: number } | null, av: AvBudget | null, today: string, recorded: boolean) {
  if (!recorded && !(row.id === "alphavantage" && av)) return <td>—</td>;
  if (row.id === "alphavantage") {
    const used = av?.used ?? 0;
    const when = av ? (av.date === today ? "today" : etDate(av.date)) : null;
    const width = Math.min(100, row.dailyCap ? (used / row.dailyCap) * 100 : 0);
    return (
      <td>
        <div>{av ? `${used} / ${row.dailyCap}` : "—"}</div>
        {av ? <div className={meterClass(used, row.dailyCap ?? 25)}><span style={{ width: `${width}%` }} /></div> : null}
        <div className="s" style={{ color: "var(--faint)", fontSize: 12, marginTop: 4 }}>
          {when ? `budget ${when}` : "no budget row"}
          {callsToday ? ` · ${callsToday} live` : ""}
        </div>
      </td>
    );
  }
  return (
    <td>
      <div>{callsToday}</div>
      {last && last.n ? (
        <div style={{ color: "var(--faint)", fontSize: 12 }}>{last.n} on {etDate(last.date)}</div>
      ) : null}
    </td>
  );
}

export default async function ApisPage() {
  const data = await loadApiUsage();
  const today = todayEt();
  const usage: ApiUsage | null = data.usage;
  const fresh = usage?.date === today;
  const calls = usage?.calls ?? {};
  const secrets = usage?.secrets ?? null;
  const keyed = APIS.filter((a) => !a.keyless && a.id !== "sec");
  const setCount = secrets ? keyed.filter((a) => secrets[a.id]).length : null;
  const liveToday = Object.values(calls).reduce((n, v) => n + (Number(v) || 0), 0);
  const avUsed = data.av?.used ?? null;
  const stamp = usage?.updatedAt ? `snapshot ${etDate(usage.updatedAt)}` : usage?.date ? `snapshot ${etDate(usage.date)}` : null;

  return (
    <>
      <Nav active="/apis" stamp={stamp} />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>APIs</h1>
            <p className="lede">
              Each outside service the pipeline calls, whether the last run had a key, and how many live requests each workflow made.
              GitHub Actions writes those counts into Neon when the job finishes. Cached responses are not counted.
              Alpha Vantage also tracks a 25-call daily budget, including calls served from cache.
            </p>
          </div>
          <TestApisButton />
        </div>
        {data.test?.at ? (
          <p className="notes" style={{ marginTop: -8 }}>Last test {etTime(data.test.at)} ET. Each probe is one live call and is added to Today.</p>
        ) : null}
        {!data.configured ? <Setup /> : null}
        {data.configured && !usage ? (
          <Empty title="No usage snapshot yet" body="Run uv run swing check, or wait for the next nightly job. That writes key status and call counts into Neon." />
        ) : null}

        <div className="grid grid-3" style={{ margin: "16px 0" }}>
          <div className="stat">
            <div className="k">Keys on last run</div>
            <div className="v">{setCount == null ? "—" : `${setCount} / ${keyed.length}`}</div>
            <div className="s">Alpaca and Finnhub are the ones the jobs expect</div>
          </div>
          <div className="stat">
            <div className="k">Live calls today</div>
            <div className="v">{usage ? liveToday : "—"}</div>
            <div className="s">{fresh ? "Since midnight ET" : usage ? `Last counted ${etDate(usage.date)}` : "Waiting for a pipeline run"}</div>
          </div>
          <div className="stat">
            <div className="k">Alpha Vantage</div>
            <div className="v">{avUsed == null ? "—" : `${avUsed} / 25`}</div>
            <div className="s">{data.av ? (data.av.date === today ? "Budget spent today" : `Budget on ${etDate(data.av.date)}`) : "No budget stored"}</div>
          </div>
        </div>

        <div className="card table-scroll" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>API</th>
                <th>Test</th>
                <th>Used for</th>
                <th>Key</th>
                <th>Limit</th>
                {WORKFLOWS.map(([id, label]) => {
                  const runs = Number(usage?.jobs?.[id]?.runs ?? 0);
                  return (
                    <th key={id}>
                      {label}
                      {runs ? <span className="th-sub">{runs === 1 ? "1 run" : `${runs} runs`}</span> : null}
                    </th>
                  );
                })}
                <th>{fresh || !usage ? "Today" : etDate(usage.date)}</th>
              </tr>
            </thead>
            {groups().map((group) => (
              <tbody key={group}>
                <tr>
                  <td className="api-group" colSpan={9}><span className="pin">{group}</span></td>
                </tr>
                {APIS.filter((row) => row.group === group).map((row) => {
                  const n = Number(calls[row.id] ?? 0);
                  const recorded = Boolean(usage);
                  return (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      {testCell(row.id, data.test)}
                      <td className="notes">{row.role}</td>
                      <td>{keyChip(row, secrets)}</td>
                      <td className="notes">{row.limit}</td>
                      {WORKFLOWS.map(([id]) => (
                        <td key={id}>{recorded ? jobCalls(usage, id, row.id) : "—"}</td>
                      ))}
                      {todayCell(row, n, null, data.av, today, recorded)}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </main>
    </>
  );
}
