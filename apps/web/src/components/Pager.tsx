import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardConfig, Profile, WidgetEnvelope } from "@home-dash/shared";
import { widgetFor } from "../widgets/registry.js";
import { needsSetup } from "./WidgetTile.js";
import { DashboardGrid } from "./DashboardGrid.js";
import { ExpandContext, ExpandedWidget } from "./Expanded.js";
import { visiblePages } from "./pages.js";

interface Props {
  config: DashboardConfig;
  profile: Profile;
  envelopes: Record<string, WidgetEnvelope<unknown>>;
  availableSources: string[];
}

/**
 * A profile's pages side by side, changed by swiping.
 *
 * The track is a native horizontal scroller with mandatory snapping, not a
 * gesture library: Safari then supplies the momentum, the rubber-band edge
 * and the direction lock that lets a list inside a widget scroll vertically
 * without turning the page.
 *
 * Mount it with the profile name as its key, so a switch from day to night
 * starts again on the first page.
 */
export function Pager({ config, profile, envelopes, availableSources }: Props) {
  const pages = useMemo(() => visiblePages(profile.widgets), [profile.widgets]);
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [expanded, setExpanded] = useState<{ id: string; cell: HTMLElement } | null>(null);
  const expand = useCallback((id: string, cell: HTMLElement) => setExpanded((prev) => prev ?? { id, cell }), []);
  const collapse = useCallback(() => setExpanded(null), []);
  const expandApi = useMemo(() => ({ expandedId: expanded?.id ?? null, expand }), [expanded, expand]);

  const goTo = useCallback((index: number, smooth = true) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Which page is showing, read from the scroll position once it settles on
  // a page boundary. Cheap enough to do on every scroll event.
  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    setCurrent(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  // A page removed in settings must not leave the screen scrolled past the end.
  useEffect(() => {
    if (current > pages.length - 1) goTo(pages.length - 1, false);
  }, [pages.length, current, goTo]);

  // Rotating the tablet changes the page width; stay on the same page.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(() => goTo(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)), false));
    observer.observe(el);
    return () => observer.disconnect();
  }, [goTo]);

  // Back to the first page after a spell with no touch, so the wall does not
  // sit on page three all afternoon.
  const idleMs = profile.returnToFirstPage * 1000;
  useEffect(() => {
    // An open widget closes itself first; the countdown starts again after.
    if (idleMs === 0 || current === 0 || expanded) return;
    let timer = window.setTimeout(() => goTo(0), idleMs);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => goTo(0), idleMs);
    };
    const events = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
    for (const type of events) window.addEventListener(type, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const type of events) window.removeEventListener(type, reset);
    };
  }, [idleMs, current, goTo, expanded]);

  // Arrow keys, for a desk browser without a touch screen.
  useEffect(() => {
    if (pages.length < 2 || expanded) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable], .settings")) return;
      if (event.key === "ArrowRight") goTo(Math.min(current + 1, pages.length - 1));
      if (event.key === "ArrowLeft") goTo(Math.max(current - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, pages.length, goTo, expanded]);

  const many = pages.length > 1;

  // Looked up afresh on every render, so an open widget keeps getting live
  // data, and closes if Settings removes it or switches it off.
  const open = expanded && profile.widgets.find((w) => w.id === expanded.id && w.enabled);
  const openDefinition = open ? widgetFor(open.type) : undefined;
  useEffect(() => {
    if (expanded && !openDefinition?.detail) setExpanded(null);
  }, [expanded, openDefinition]);

  return (
    <ExpandContext.Provider value={expandApi}>
      <div
        ref={track}
        className={many ? "pager" : "pager pager--single"}
        onScroll={many ? onScroll : undefined}
        // Out of reach while a widget is open over it.
        inert={expanded !== null}
      >
        {pages.map((page, index) => (
          <div
            key={page.number}
            className="pager__page"
            // Off-screen pages are hidden from assistive tech, not unmounted:
            // their widgets keep their state and there is no reload flash.
            aria-hidden={many && index !== current ? true : undefined}
            aria-label={many ? `Page ${index + 1} of ${pages.length}` : undefined}
          >
            <DashboardGrid
              config={config}
              widgets={page.widgets}
              envelopes={envelopes}
              availableSources={availableSources}
            />
          </div>
        ))}
      </div>
      {many && (
        <nav className="pager__dots" aria-label="Pages">
          {pages.map((page, index) => (
            <button
              key={page.number}
              type="button"
              className="pager__dot"
              aria-label={`Page ${index + 1}`}
              aria-current={index === current ? "page" : undefined}
              onClick={() => goTo(index)}
            />
          ))}
        </nav>
      )}
      {open && openDefinition?.detail && expanded && (
        <ExpandedWidget
          key={open.id}
          instance={open}
          definition={{ ...openDefinition, detail: openDefinition.detail }}
          config={config}
          envelope={openDefinition.dataKey ? (envelopes[openDefinition.dataKey] ?? null) : null}
          setupHint={needsSetup(open, availableSources) ? (openDefinition.setupHint ?? "Run npm run setup to link this account.") : undefined}
          source={expanded.cell}
          onClosed={collapse}
        />
      )}
    </ExpandContext.Provider>
  );
}
