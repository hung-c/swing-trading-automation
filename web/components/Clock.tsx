"use client";

import { useEffect, useState } from "react";

type Zone = "et" | "local";

const STORAGE_KEY = "swing-clock-zone";

function zoneLabel(now: Date, zone: Zone): string {
  if (zone === "et") return "ET";
  const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "Local";
}

function formatClock(now: Date, zone: Zone): { date: string; time: string; label: string } {
  const timeZone = zone === "et" ? "America/New_York" : undefined;
  return {
    date: now.toLocaleDateString("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    time: now.toLocaleTimeString("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }),
    label: zoneLabel(now, zone),
  };
}

export function Clock() {
  const [zone, setZone] = useState<Zone>("et");
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "local" || saved === "et") setZone(saved);
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  function toggle() {
    const next: Zone = zone === "et" ? "local" : "et";
    setZone(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  const shown = now ? formatClock(now, zone) : null;
  const hint = zone === "et" ? "Click to show local time." : "Click to show Eastern Time.";
  const label = shown ? `${shown.date} ${shown.time} ${shown.label}. ${hint}` : hint;

  return (
    <button type="button" className="nav-clock" onClick={toggle} title={label} aria-label={label}>
      <span className="nav-clock-date">{shown?.date ?? "\u00a0"}</span>
      <span className="nav-clock-time mono">{shown?.time ?? "--:--:--"}</span>
      <span className="nav-clock-zone">{shown?.label ?? "ET"}</span>
    </button>
  );
}
