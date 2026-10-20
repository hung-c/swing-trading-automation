import { Nav, Setup } from "@/components/Nav";
import { PlanBoard } from "@/components/PlanBoard";
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
            <p className="lede">
              Save a plan to arm alerts. A ticker can keep several plans, and each update says whether that plan is still good to watch or out of plan. Names you leave unsaved are removed after that day.
            </p>
          </div>
        </div>
        {!snap.configured ? <Setup /> : null}
        {snap.configured ? (
          <PlanBoard
            plans={b?.plans}
            rejected={b?.rejected}
            watchlist={snap.watchlist}
            prices={snap.prices}
            scanDay={b?.date ?? null}
          />
        ) : null}
      </main>
    </>
  );
}
