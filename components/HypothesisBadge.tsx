"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TEST_SETUP_ID, hypothesisAnchor } from "../lib/content/hypothesisLinks";

/** Matches the tooltip's w-72 class. */
const TOOLTIP_WIDTH = 288;

/** Opens the collapsed "How the test was set up" area, scrolls to one hypothesis and highlights it briefly. */
export function revealHypothesis(id: string) {
  const details = document.getElementById(TEST_SETUP_ID);
  if (details instanceof HTMLDetailsElement) details.open = true;
  const item = document.getElementById(hypothesisAnchor(id));
  if (!item) return;
  history.replaceState(null, "", `#${hypothesisAnchor(id)}`);
  item.scrollIntoView({ behavior: "smooth", block: "start" });
  item.dataset.highlight = "true";
  window.setTimeout(() => delete item.dataset.highlight, 2500);
}

/**
 * A chart's hypothesis badge (e.g. EXP1-H3). Hovering, keyboard focus or a tap shows the
 * hypothesis right away, with a link to its place in the "How the test was set up" area.
 * The badge itself doesn't navigate.
 */
export function HypothesisBadge({ id, text }: { id: string; text: string }) {
  const [open, setOpen] = useState(false);
  // Tooltip's left edge, relative to the badge. Starts right-aligned (badges sit at the top right of charts).
  const [offset, setOffset] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  // Keep the tooltip fully on screen: line it up with the badge's left edge if it fits, otherwise
  // its right edge, then nudge it inside an 8px margin of the viewport.
  const measure = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const width = Math.min(TOOLTIP_WIDTH, window.innerWidth - 2 * margin);
    const preferred = rect.left + width <= window.innerWidth - margin ? 0 : rect.width - width;
    setOffset(Math.min(Math.max(preferred, margin - rect.left), window.innerWidth - margin - width - rect.left));
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <span ref={ref} className="group relative inline-block" onMouseEnter={measure}>
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={tooltipId}
        onFocus={measure}
        onClick={() => {
          measure();
          setOpen((v) => !v);
        }}
        className="whitespace-nowrap rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-300 hover:border-indigo-400 hover:bg-indigo-500/20"
      >
        {id}
      </button>
      {/* pt-2 bridges the gap so the pointer can move from the badge into the tooltip without it closing. */}
      <span
        id={tooltipId}
        role="tooltip"
        style={offset === null ? { right: 0 } : { left: offset }}
        className={`absolute top-full z-20 w-72 max-w-[calc(100vw-16px)] pt-2 ${open ? "block" : "hidden"} group-hover:block group-focus-within:block`}
      >
        <span className="block rounded-lg border border-slate-700 bg-slate-900 p-3 text-left text-sm font-normal leading-snug text-slate-200 shadow-lg">
          <span className="mb-1 block text-xs font-semibold text-indigo-300">{id}</span>
          {text}
          <a
            href={`#${hypothesisAnchor(id)}`}
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              revealHypothesis(id);
            }}
            className="mt-2 block text-xs font-medium text-indigo-300 hover:text-indigo-200"
          >
            See all hypotheses →
          </a>
        </span>
      </span>
    </span>
  );
}

/** Inside the collapsed area: if the page loads with a #hypothesis-… link, open the area and show that item. */
export function OpenOnHypothesisHash() {
  useEffect(() => {
    const prefix = "#hypothesis-";
    if (location.hash.startsWith(prefix)) revealHypothesis(decodeURIComponent(location.hash.slice(prefix.length)));
  }, []);
  return null;
}
