import { PlanCard } from "@/components/PlanCard";
import { etDate, scanStillOpen } from "@/lib/format";
import type { PlanCard as Plan, WatchItem } from "@/lib/types";

function rank(item: WatchItem): number {
  if (item.role === "candidate") return 1;
  if (!item.active) return 2;
  return 0;
}

function groupWatch(items: WatchItem[]): { symbol: string; items: WatchItem[] }[] {
  const order: string[] = [];
  const bySymbol = new Map<string, WatchItem[]>();
  for (const item of items) {
    const list = bySymbol.get(item.symbol);
    if (list) list.push(item);
    else {
      order.push(item.symbol);
      bySymbol.set(item.symbol, [item]);
    }
  }
  return order.map((symbol) => ({
    symbol,
    items: (bySymbol.get(symbol) ?? []).slice().sort((a, b) => rank(a) - rank(b) || a.savedAt.localeCompare(b.savedAt)),
  }));
}

export function PlanBoard({
  plans,
  rejected,
  watchlist,
  prices,
  scanDay,
  commentary,
}: {
  plans?: Plan[];
  rejected?: Plan[];
  watchlist: WatchItem[];
  prices: Record<string, number>;
  scanDay: string | null;
  commentary?: string | null;
}) {
  const saved = new Set(watchlist.map((w) => w.symbol));
  const live = scanStillOpen(scanDay);
  const scan = live ? (plans ?? []).filter((p) => p.status !== "rejected" && !saved.has(p.symbol)) : [];
  const unsaved = (plans ?? []).filter((p) => p.status !== "rejected" && !saved.has(p.symbol));
  const rejectedLive = live ? (rejected ?? []).filter((p) => p.status === "rejected") : [];
  const groups = groupWatch(watchlist);

  return (
    <>
      <h3 style={{ margin: "22px 0 8px" }}>Watchlist</h3>
      <p className="lede" style={{ marginBottom: 12 }}>
        A ticker can hold several plans. Each one keeps the card from the day you saved it. Alerts run only for plans that are on.
      </p>
      {groups.length ? (
        groups.map((group) => (
          <section key={group.symbol} className="plan-group">
            <h3 style={{ margin: "8px 0" }}>{group.symbol}</h3>
            <div className="grid grid-2">
              {group.items.map((w) => (
                <PlanCard key={w.id} plan={w.plan} item={w} peers={group.items} price={prices[w.symbol]} href={`/plans/${w.symbol}`} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="card empty">
          <h2>Watchlist is empty</h2>
          <p>Save a ticker from today's scan. Until you do, that name does not alert.</p>
        </div>
      )}

      {commentary ? (
        <>
          <h3 style={{ margin: "28px 0 8px" }}>Scan notes</h3>
          <p className="lede" style={{ marginBottom: 12 }}>
            {commentary}
          </p>
        </>
      ) : null}

      {live ? (
        <>
          <h3 style={{ margin: "28px 0 8px" }}>Today's scan</h3>
          <p className="lede" style={{ marginBottom: 12 }}>
            These names leave after today unless you save them to the watchlist.
          </p>
          {scan.length ? (
            <div className="grid grid-2">
              {scan.map((p) => (
                <PlanCard key={p.symbol} plan={p} price={prices[p.symbol]} href={`/plans/${p.symbol}`} saved={false} />
              ))}
            </div>
          ) : (
            <p className="lede">No new names outside the watchlist.</p>
          )}
          {rejectedLive.length ? (
            <>
              <h3 style={{ margin: "28px 0 10px" }}>Rejected</h3>
              <div className="grid grid-2">
                {rejectedLive.map((p) => (
                  <PlanCard key={p.symbol} plan={p} />
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : unsaved.length && scanDay ? (
        <p className="lede" style={{ marginTop: 18 }}>
          Unsaved names from {etDate(scanDay)} were removed.
        </p>
      ) : null}
    </>
  );
}
