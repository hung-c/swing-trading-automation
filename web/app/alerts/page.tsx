import { redirect } from "next/navigation";
import { AlertBoard } from "@/components/AlertBoard";
import { Empty, Nav, Setup } from "@/components/Nav";
import { loadAlertList } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Search = { page?: string; symbol?: string; condition?: string };

function alertHref(symbol: string, condition: string, page: number): string {
  const params = new URLSearchParams();
  if (symbol) params.set("symbol", symbol);
  if (condition) params.set("condition", condition);
  if (page > 1) params.set("page", String(page));
  const q = params.toString();
  return q ? `/alerts?${q}` : "/alerts";
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const requested = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const symbol = (q.symbol ?? "").trim();
  const condition = (q.condition ?? "").trim();
  const data = await loadAlertList({ page: requested, symbol, condition });
  if (data.configured && data.total > 0 && requested !== data.page) {
    redirect(alertHref(symbol, condition, data.page));
  }
  const filtering = symbol.length > 0 || condition.length > 0;

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
        {!data.configured ? <Setup /> : null}
        {data.configured && data.total === 0 && !filtering ? (
          <Empty title="No alerts yet" body="Save a plan to the watchlist. The 15-minute job then writes one row per saved symbol, condition, and day." />
        ) : null}
        {data.configured && (data.total > 0 || filtering) ? (
          <AlertBoard
            alerts={data.alerts}
            total={data.total}
            page={data.page}
            pageSize={data.pageSize}
            conditions={data.conditions}
            symbol={symbol}
            condition={condition}
          />
        ) : null}
      </main>
    </>
  );
}
