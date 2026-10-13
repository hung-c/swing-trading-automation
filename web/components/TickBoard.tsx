"use client";

import { useEffect, useState } from "react";

import { formatCountdown, type PcState, type TickStatus } from "@/lib/tick-status";

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
            {data.strategies.length ? `Active ${data.strategies.join(", ")}.` : "No strategy is active, so the tick will not start a job."}
            {data.sessionNote ? ` ${data.sessionNote}` : ""}
          </p>
          {data.jobs.length ? (
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Clock</th>
                  <th>Next tick</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((job) => (
                  <tr key={job.job}>
                    <td>{job.label}</td>
                    <td className="mono">{job.when}</td>
                    <td>
                      <span className={chip(job.reason, job.due)}>{job.due ? "Due" : job.reason}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

      <section className="card">
        <h3 style={{ margin: "0 0 6px" }}>Recent jobs</h3>
        <p className="lede">Job-level runs from the last four days. This page refreshes every 20 seconds.</p>
        {refreshFailed ? <p className="warn-list">Refresh failed. Showing the last reading.</p> : null}
        {data.recent.length ? (
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>When</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((run) => (
                <tr key={run.id}>
                  <td>{run.label}</td>
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
