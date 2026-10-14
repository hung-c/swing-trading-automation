import Link from "next/link";
import { WatchButton } from "@/components/WatchButton";
import { distanceToEntry, num, patternName, usd } from "@/lib/format";
import type { PlanCard as Plan } from "@/lib/types";

export function PlanCard({ plan, price, href, saved }: { plan: Plan; price?: number; href?: string; saved?: boolean }) {
  const dist = distanceToEntry(plan, price);
  const strategies = (plan.strategy_name ?? "")
    .split("·")
    .map((name) => name.trim())
    .filter(Boolean);
  const inner = (
    <>
      <div className="plan-top">
        <div className="plan-id">
          <div className="sym">{plan.symbol}</div>
          <div className="pat">
            {strategies.length ? <span className="plan-strategy">{strategies.join(" · ")}</span> : null}
            {strategies.length ? " · " : ""}
            {patternName(plan.pattern)} · q {num(plan.pattern_quality, 1)}/10 · trend {plan.trend_score}/8
            {plan.sector ? ` · ${plan.sector}` : ""}
          </div>
        </div>
        <div className="pills">
          <span className="chip">{plan.status}</span>
          {plan.earnings?.trading_days_away != null ? (
            <span className={`chip ${plan.earnings.trading_days_away <= 5 ? "warn" : ""}`}>
              ern {plan.earnings.trading_days_away}d
            </span>
          ) : null}
          {dist ? <span className={`chip ${dist.tone === "chase" ? "bad" : dist.tone === "ok" ? "ok" : "warn"}`}>{dist.label}</span> : null}
        </div>
      </div>
      <div className="levels">
        <div className="lv">
          <div className="k">Resistance</div>
          <div className="v">{usd(plan.resistance)}</div>
        </div>
        <div className="lv entry">
          <div className="k">Entry</div>
          <div className="v">{usd(plan.entry)}</div>
        </div>
        <div className="lv stop">
          <div className="k">Stop {num(plan.stop_pct, 1)}%</div>
          <div className="v">{usd(plan.stop)}</div>
        </div>
        <div className="lv tgt">
          <div className="k">2R · {plan.shares} sh</div>
          <div className="v">{usd(plan.target_2r)}</div>
        </div>
      </div>
    </>
  );
  const extra = (
    <>
      {plan.rejected_reason ? <p className="notes">{plan.rejected_reason}</p> : null}
      {plan.notes?.length ? (
        <details className="plan-drop">
          <summary>
            Notes
            <span className="plan-drop-count">{plan.notes.length}</span>
          </summary>
          <ul className="plan-notes">
            {plan.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {plan.evaluations?.map((ev) => (
        <details key={ev.gate} className="plan-drop">
          <summary>
            AI note
            <span className={`chip ${ev.verdict === "take" ? "ok" : ev.verdict === "skip" ? "bad" : "warn"}`}>{ev.verdict}</span>
          </summary>
          <div className="plan-drop-body">
            <div className="pills">
              <span className="chip">{ev.gate === "plan_card" ? "plan card" : ev.gate === "actionable_alert" ? "alert" : "management"}</span>
              {ev.prompt_version ? <span className="chip">prompt {ev.prompt_version}</span> : null}
              {ev.model ? <span className="chip">{ev.model}</span> : null}
            </div>
            {ev.reasons?.length ? (
              <ul className="plan-notes">
                {ev.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            {ev.open_questions?.length ? <p className="notes">Open: {ev.open_questions.join(" ")}</p> : null}
          </div>
        </details>
      ))}
    </>
  );
  const watch = saved != null ? <WatchButton symbol={plan.symbol} saved={saved} /> : null;
  if (href) {
    return (
      <article className="plan">
        {watch}
        <Link href={href} className="plan-main">
          {inner}
        </Link>
        {extra}
      </article>
    );
  }
  return (
    <article className="plan">
      {watch}
      {inner}
      {extra}
    </article>
  );
}
