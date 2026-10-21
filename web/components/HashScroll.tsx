"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Marks the plan named in the URL so the card that fired the alert stands out. */
export function PlanAnchor({ id, children }: { id: string; children: ReactNode }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(decodeURIComponent(window.location.hash.replace(/^#/, "")) === id);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [id]);
  return (
    <div id={id} className={active ? "plan-anchor on" : "plan-anchor"}>
      {children}
    </div>
  );
}

/** Scroll to the plan named in the URL hash after the plan page has rendered. */
export function HashScroll() {
  useEffect(() => {
    let tries = 0;
    const timer = window.setInterval(() => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      const el = id ? document.getElementById(id) : null;
      tries += 1;
      if (el) {
        el.scrollIntoView({ block: "start" });
        window.clearInterval(timer);
      } else if (!id || tries > 10) {
        window.clearInterval(timer);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
