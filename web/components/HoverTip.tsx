"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

type Box = { x: number; y: number };

/** Hover note drawn on the page, so it does not widen a scrolling table. */
export function HoverTip({ tip, className, children }: { tip: string; className?: string; children: React.ReactNode }) {
  const [box, setBox] = useState<Box | null>(null);

  function show(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const width = 240;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setBox({ x, y: r.bottom + 6 });
  }

  return (
    <span className={className} onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={() => setBox(null)}>
      {children}
      {box
        ? createPortal(
            <span className="hover-tip" style={{ left: box.x, top: box.y }}>
              {tip}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
