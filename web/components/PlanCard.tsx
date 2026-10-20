import Link from "next/link";
import { PlanActions } from "@/components/PlanActions";
import { WatchButton } from "@/components/WatchButton";
import { distanceToEntry, num, patternName, usd } from "@/lib/format";
import type { PlanCard as Plan, PlanStatus, WatchItem } from "@/lib/types";

function statusTip(status: PlanStatus): string {
  if (status === "watch") return "Cleared the rules. A plan to watch, not an open trade.";
  if (status === "rejected") return "Failed a hard rule, so this is not a plan to take.";
  if (status === "triggered") return "Price hit the alert and this plan has triggered.";
  if (status === "open") return "This name is an open position.";
  return "This trade is closed.";
}

function distanceTip(tone: "ok" | "warn" | "chase", label: string): string {
  if (tone === "chase") return `${label}. More than 1% above the planned entry.`;
  if (tone === "warn") return `${label}. Price has crossed the entry and is still within 1%.`;
  return `${label}. Last price is still under the planned entry.`;
}

export function PlanCard({
  plan,
  price,
  href,
  saved,
  item,
  peers,
}: {
  plan: Plan;
  price?: number;
  href?: string;
  saved?: boolean;
  item?: WatchItem;
  peers?: WatchItem[];
}) {
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
          <span className="chip" data-tip={statusTip(plan.status)}>
            {plan.status}
          </span>
          {item?.role === "candidate" ? (
            <span className="chip warn" data-tip="A new plan for this ticker. Add it beside the ones you already watch, or switch to it.">
              new plan
            </span>
          ) : null}
          {item && item.role === "saved" && !item.active ? (
            <span className="chip" data-tip="This plan is off. It does not alert until you turn it on.">
              off
            </span>
          ) : null}
          {item?.verdict === "still_good" ? (
            <span className="chip ok" data-tip={item.verdictReason ?? "The latest price still respects this saved plan."}>
              still good to watch
            </span>
          ) : null}
          {item?.verdict === "out" ? (
            <span className="chip bad" data-tip={item.verdictReason ?? "The latest price no longer fits this saved plan."}>
              out of plan
            </span>
          ) : null}
          {plan.earnings?.trading_days_away != null ? (
            <span
              className={`chip ${plan.earnings.trading_days_away <= 5 ? "warn" : ""}`}
              data-tip={
                plan.earnings.trading_days_away <= 5
                  ? `Earnings in ${plan.earnings.trading_days_away} trading days. New entries are blocked this close to the report.`
                  : `Earnings in ${plan.earnings.trading_days_away} trading days.`
              }
            >
              ern {plan.earnings.trading_days_away}d
            </span>
          ) : null}
          {dist ? (
            <span className={`chip ${dist.tone === "chase" ? "bad" : dist.tone === "ok" ? "ok" : "warn"}`} data-tip={distanceTip(dist.tone, dist.label)}>
              {dist.label}
            </span>
          ) : null}
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
      {item?.verdictReason ? <p className="notes">{item.verdictReason}</p> : null}
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
            <span
              className={`chip ${ev.verdict === "take" ? "ok" : ev.verdict === "skip" ? "bad" : "warn"}`}
              data-tip={
                ev.verdict === "take"
                  ? "The judge says this name is worth taking. It does not change the entry, stop, or size."
                  : ev.verdict === "skip"
                    ? "The judge says skip this name. It does not change the entry, stop, or size."
                    : "The judge wants this name watched, not taken yet."
              }
            >
              {ev.verdict}
            </span>
          </summary>
          <div className="plan-drop-body">
            <div className="pills">
              <span
                className="chip"
                data-tip={
                  ev.gate === "plan_card"
                    ? "Judged when the nightly plan card was written."
                    : ev.gate === "actionable_alert"
                      ? "Judged when an actionable alert fired."
                      : "Judged while managing an open position."
                }
              >
                {ev.gate === "plan_card" ? "plan card" : ev.gate === "actionable_alert" ? "alert" : "management"}
              </span>
              {ev.prompt_version ? (
                <span className="chip" data-tip="Version of the written instructions used for this judgment.">
                  prompt {ev.prompt_version}
                </span>
              ) : null}
              {ev.model ? (
                <span className="chip" data-tip="Model that wrote this judgment.">
                  {ev.model}
                </span>
              ) : null}
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
  const watch = item ? null : saved != null ? <WatchButton symbol={plan.symbol} saved={saved} /> : null;
  const actions = item ? <PlanActions item={item} peers={peers ?? []} /> : null;
  if (href) {
    return (
      <article className="plan">
        {watch}
        <Link href={href} className="plan-main">
          {inner}
        </Link>
        {extra}
        {actions}
      </article>
    );
  }
  return (
    <article className="plan">
      {watch}
      {inner}
      {extra}
      {actions}
    </article>
  );
}
