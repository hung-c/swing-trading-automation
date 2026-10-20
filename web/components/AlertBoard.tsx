"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { etDateTime, usd } from "@/lib/format";
import type { AlertRow } from "@/lib/types";

type Props = {
  alerts: AlertRow[];
  total: number;
  page: number;
  pageSize: number;
  conditions: string[];
  symbol: string;
  condition: string;
};

function hrefFor(pathname: string, symbol: string, condition: string, page: number): string {
  const params = new URLSearchParams();
  if (symbol) params.set("symbol", symbol);
  if (condition) params.set("condition", condition);
  if (page > 1) params.set("page", String(page));
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

function pageWindow(page: number, pages: number): number[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const picked = [1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages);
  return [...new Set(picked)].sort((a, b) => a - b);
}

export function AlertBoard({ alerts, total, page, pageSize, conditions, symbol, condition }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [symbolDraft, setSymbolDraft] = useState(symbol);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const filtering = symbol.length > 0 || condition.length > 0;
  const options = conditions.includes(condition) || !condition ? conditions : [condition, ...conditions];

  useEffect(() => {
    setSymbolDraft(symbol);
  }, [symbol]);

  useEffect(() => {
    const next = symbolDraft.trim();
    if (next === symbol) return;
    const id = window.setTimeout(() => {
      router.replace(hrefFor(pathname, next, condition, 1));
    }, 250);
    return () => window.clearTimeout(id);
  }, [symbolDraft, symbol, condition, pathname, router]);

  function visit(next: { symbol?: string; condition?: string; page?: number }, mode: "push" | "replace") {
    const href = hrefFor(pathname, next.symbol ?? symbol, next.condition ?? condition, next.page ?? 1);
    if (mode === "push") router.push(href);
    else router.replace(href);
  }

  const numbers = pageWindow(page, pages);

  return (
    <>
      <div className="alert-filters">
        <label>
          Symbol
          <input
            type="search"
            value={symbolDraft}
            placeholder="Search symbols"
            autoComplete="off"
            onChange={(e) => setSymbolDraft(e.target.value)}
          />
        </label>
        <label>
          Condition
          <select
            value={condition}
            onChange={(e) => visit({ condition: e.target.value, symbol: symbolDraft.trim(), page: 1 }, "replace")}
          >
            <option value="">All conditions</option>
            {options.map((c) => (
              <option key={c} value={c}>
                {c.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        {filtering ? (
          <button
            type="button"
            className="btn ghost tiny"
            onClick={() => {
              setSymbolDraft("");
              visit({ symbol: "", condition: "", page: 1 }, "replace");
            }}
          >
            Clear
          </button>
        ) : null}
        <span className="alert-count">{total === 0 ? "0 alerts" : `${start}–${end} of ${total}`}</span>
      </div>
      <div className="card table-scroll" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Symbol</th>
              <th>Condition</th>
              <th>Price</th>
              <th>RVOL</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length ? (
              alerts.map((a) => (
                <tr key={`${a.day}-${a.symbol}-${a.condition}-${a.planId ?? ""}`}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{etDateTime(a.ts)}</td>
                  <td>{a.symbol}</td>
                  <td>
                    {a.condition}
                    {a.actionable ? <span className="chip ok">go</span> : null}
                  </td>
                  <td>{usd(a.price)}</td>
                  <td>{a.rvol != null ? a.rvol.toFixed(2) : "—"}</td>
                  <td className="notes" style={{ color: "var(--muted)" }}>
                    {a.message}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="notes" style={{ textAlign: "center", padding: "28px 10px" }}>
                  No alerts match this symbol and condition.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav className="alert-pager" aria-label="Alert pages">
          <button type="button" className="btn ghost tiny" disabled={page <= 1} onClick={() => visit({ page: page - 1 }, "push")}>
            Previous
          </button>
          {numbers.map((n, i) => {
            const gap = i > 0 && n - numbers[i - 1] > 1;
            return (
              <span key={n} className="alert-pager-slot">
                {gap ? <span className="alert-ellipsis">…</span> : null}
                <button
                  type="button"
                  className={`btn tiny${n === page ? "" : " ghost"}`}
                  aria-current={n === page ? "page" : undefined}
                  onClick={() => visit({ page: n }, "push")}
                >
                  {n}
                </button>
              </span>
            );
          })}
          <button type="button" className="btn ghost tiny" disabled={page >= pages} onClick={() => visit({ page: page + 1 }, "push")}>
            Next
          </button>
        </nav>
      ) : null}
    </>
  );
}
