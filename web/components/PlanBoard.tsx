import { PlanCard } from "@/components/PlanCard";
import { WatchButton } from "@/components/WatchButton";
import { etDate, scanStillOpen } from "@/lib/format";
import type { PlanCard as Plan, WatchItem } from "@/lib/types";

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

  return (
    <>
      <h3 style={{ margin: "22px 0 8px" }}>Watchlist</h3>
      <p className="lede" style={{ marginBottom: 12 }}>
        Alerts run only for names you save here. A saved ticker stays until you remove it.
      </p>
      {watchlist.length ? (
        <div className="grid grid-2">
          {watchlist.map((w) => (
            <div className="plan-slot" key={w.symbol}>
              <PlanCard plan={w.plan} price={prices[w.symbol]} href={`/plans/${w.symbol}`} />
              <WatchButton symbol={w.symbol} saved />
            </div>
          ))}
        </div>
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
                <div className="plan-slot" key={p.symbol}>
                  <PlanCard plan={p} price={prices[p.symbol]} href={`/plans/${p.symbol}`} />
                  <WatchButton symbol={p.symbol} saved={false} />
                </div>
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
