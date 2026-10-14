"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";

import { formatCountdown, type JobName, type PcState, type TickStatus } from "@/lib/tick-status";

const BANNER: Record<PcState, string> = {
  running: "banner live",
  stalled: "banner half",
  awake: "banner full",
  late: "banner none",
  asleep: "banner",
  silent: "banner",
};

function chip(reason: string, due: boolean): string {
  if (due) return "chip ok";
  if (reason === "Off" || reason === "Market is closed") return "chip";
  if (reason === "Already running" || reason.startsWith("Ran less")) return "chip warn";
  return "chip";
}

function statusChip(status: string): string {
  if (status === "ok" || status === "skipped") return "chip ok";
  if (status === "failed" || status === "stalled") return "chip bad";
  if (status === "running") return "chip warn";
  return "chip";
}

function statusLabel(status: string): string {
  if (status === "ok") return "OK";
  if (status === "failed") return "Failed";
  if (status === "running") return "Running";
  if (status === "stalled") return "Stalled";
  if (status === "skipped") return "Skipped";
  return status;
}

export function TickBoard({ initial }: { initial: TickStatus }) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState<number | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busyJob, setBusyJob] = useState<JobName | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  async function queueJob(job: JobName, queued: boolean) {
    setBusyJob(job);
    setQueueError(null);
    try {
      const res = await fetch("/api/tick", {
        method: queued ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const nextQueued = !queued;
      setData((prev) => ({
        ...prev,
        jobs: prev.jobs.map((row) => (row.job === job ? { ...row, queued: nextQueued } : row)),
        boards: prev.boards.map((board) => ({
          ...board,
          jobs: board.jobs.map((row) => (row.job === job ? { ...row, queued: nextQueued } : row)),
        })),
      }));
    } catch {
      setQueueError(queued ? "Could not cancel that job." : "Could not queue that job.");
    } finally {
      setBusyJob(null);
    }
  }

  useEffect(() => {
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const pull = window.setInterval(() => {
      fetch("/api/tick", { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.json() as Promise<TickStatus>;
        })
        .then((next) => {
          setData(next);
          setRefreshFailed(false);
        })
        .catch(() => setRefreshFailed(true));
    }, 20_000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(pull);
    };
  }, []);

  const countdown =
    data.nextAt && now != null ? formatCountdown(new Date(data.nextAt).getTime(), now) : data.countdown;
  const banner = data.waiting ? "banner half" : BANNER[data.state];

  return (
    <>
      <div className={banner} style={{ marginBottom: 16 }}>
        <div>
          <h2>{data.headline}</h2>
          <p className="lede">{data.detail}</p>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="k">Next tick</div>
          <div className="v">{data.nextLabel}</div>
          <div className="s remain">{countdown}</div>
        </div>
        <div className="stat">
          <div className="k">PC</div>
          <div className="v">{data.pcLabel}</div>
          <div className="s">{data.pcHint}</div>
        </div>
        <div className="stat">
          <div className="k">Jobs</div>
          <div className="v">{data.jobsLabel}</div>
          <div className="s">{data.jobsHint}</div>
        </div>
      </div>

      {data.configured && !data.readError ? (
        <>
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 6px" }}>On the next tick</h3>
          <p className="lede">
            {data.boards.length
              ? "Each strategy lists the jobs it joins. The clock is that strategy's own start."
              : "No strategy is active, so the tick will not start a job."}
            {data.sessionNote ? ` ${data.sessionNote}` : ""} Run next tick asks Swing Tick to start that job on its next wake-up.
          </p>
          {queueError ? <p className="warn-list">{queueError}</p> : null}
          {data.boards.length ? (
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Clock</th>
                  <th>Next tick</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.boards.map((board) => (
                  <Fragment key={board.id}>
                    <tr className="strategy-head">
                      <td colSpan={4}>
                        <span className="strategy-kicker">Strategy</span>
                        <Link href={`/strategies/${board.id}`}>{board.name}</Link>
                      </td>
                    </tr>
                    {board.jobs.length ? (
                      board.jobs.map((job) => (
                        <tr key={`${board.id}-${job.job}`}>
                          <td>{job.label}</td>
                          <td className="mono">{job.when}</td>
                          <td>
                            <span className={job.queued && !job.due ? "chip warn" : chip(job.reason, job.due)}>
                              {job.queued && !job.due ? "Queued" : job.due ? "Due" : job.reason}
                            </span>
                          </td>
                          <td>
                            <button
                              className="btn ghost tiny"
                              type="button"
                              disabled={busyJob === job.job}
                              onClick={() => queueJob(job.job, job.queued)}
                            >
                              {job.queued ? "Cancel" : "Run next tick"}
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr key={`${board.id}-empty`}>
                        <td colSpan={4} className="pc-note">
                          No jobs turned on.
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

      <section className="card">
        <h3 style={{ margin: "0 0 6px" }}>Recent jobs</h3>
        <p className="lede">
          Job-level runs from the last four days. The strategy column lists every active strategy that joins that job. This page refreshes every 20 seconds.
        </p>
        {refreshFailed ? <p className="warn-list">Refresh failed. Showing the last reading.</p> : null}
        {data.recent.length ? (
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Strategy</th>
                <th>Status</th>
                <th>When</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((run) => (
                <tr key={run.id}>
                  <td>{run.label}</td>
                  <td>{run.strategy}</td>
                  <td>
                    <span className={statusChip(run.status)}>{statusLabel(run.status)}</span>
                  </td>
                  <td>{run.when}</td>
                  <td className="pc-note">{run.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="lede" style={{ marginTop: 12 }}>
            No job has been recorded in the last four days.
          </p>
        )}
      </section>
        </>
      ) : null}
    </>
  );
}
