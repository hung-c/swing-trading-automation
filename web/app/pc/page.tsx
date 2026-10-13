import { Nav } from "@/components/Nav";
import { TickBoard } from "@/components/TickBoard";
import { loadTickStatus } from "@/lib/load-tick-status";

export const dynamic = "force-dynamic";

export default async function PcPage() {
  const status = await loadTickStatus();
  return (
    <>
      <Nav active="/pc" />
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>Job PC</h1>
            <p className="lede">
              Swing Tick wakes the job PC every 15 minutes from 7:03 AM to 7:03 PM ET on weekdays, then starts whichever job is due.
            </p>
          </div>
        </div>
        <TickBoard initial={status} />
      </main>
    </>
  );
}
