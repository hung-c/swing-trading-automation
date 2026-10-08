import { Empty, Nav, Setup } from "@/components/Nav";
import { PlanCard } from "@/components/PlanCard";
import { etDate } from "@/lib/format";
import { loadSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const snap = await loadSnapshot();
  const b = snap.brief;
  return (
    <>
      <Nav active="/plans" stamp={b ? etDate(b.date) : null} />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>Plan cards</h1>
            <p className="lede">Copy entry / stop / 2R into a Webull bracket. Do not chase more than 1% through entry.</p>
          </div>
        </div>
        {!snap.configured ? <Setup /> : null}
        {snap.configured && !b?.plans?.length && !b?.rejected?.length ? (
          <Empty title="No plans yet" body="The nightly job writes watch and rejected cards into the journal." />
        ) : null}
        {b?.plans?.length ? (
          <div className="grid grid-2">
            {b.plans.map((p) => (
              <PlanCard key={p.symbol} plan={p} price={snap.prices[p.symbol]} href={`/plans/${p.symbol}`} />
            ))}
          </div>
        ) : null}
        {b?.rejected?.length ? (
          <>
            <h3 style={{ margin: "28px 0 10px" }}>Rejected</h3>
            <div className="grid grid-2">
              {b.rejected.map((p) => (
                <PlanCard key={p.symbol} plan={p} />
              ))}
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
