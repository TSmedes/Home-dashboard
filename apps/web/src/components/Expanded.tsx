import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DashboardConfig, WidgetEnvelope, WidgetInstance } from "@home-dash/shared";
import { LiveConfigEditor } from "../edit/LiveConfigEditor.js";
import { WIDGET_NAMES } from "../widgets/names.js";
import type { WidgetDefinition } from "../widgets/types.js";
import { WidgetErrorBoundary } from "./ErrorBoundary.js";
import { clipInset } from "./expandGeometry.js";
import { WidgetFrame } from "./WidgetFrame.js";

/** An expanded widget shrinks back onto the wall after this long untouched. */
const IDLE_CLOSE_MS = 60_000;

const GROW_MS = 480;
const SHRINK_MS = 340;
const GROW_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SHRINK_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

interface ExpandApi {
  /** The widget showing full screen, if any. */
  expandedId: string | null;
  /** Grow a widget out of its grid cell. */
  expand: (id: string, cell: HTMLElement) => void;
}

export const ExpandContext = createContext<ExpandApi>({ expandedId: null, expand: () => {} });

export const useExpand = () => useContext(ExpandContext);

/**
 * What a tap on the tile should ignore: anything the tile already does
 * something with, so ticking a task or dimming a bulb does not also open it.
 */
export const OWN_CONTROLS = "button, a, input, label, select, textarea, form, [data-no-expand]";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Props {
  instance: WidgetInstance;
  definition: WidgetDefinition & { detail: NonNullable<WidgetDefinition["detail"]> };
  config: DashboardConfig;
  envelope: WidgetEnvelope<unknown> | null;
  /** The grid cell it grew from, and shrinks back into. */
  /** What it needs before it has anything to show, when that is the case. */
  setupHint?: string;
  source: HTMLElement;
  onClosed: () => void;
}

/**
 * A widget's detail view, grown out of its tile.
 *
 * The shell is laid out once, at its full size, and starts clipped to the
 * tile's rectangle; the animation only unclips it. Nothing inside is resized
 * or re-laid out while it moves, which is what keeps it smooth on an iPad.
 * The tile's own content is hidden meanwhile, so the tint looks like the
 * card itself lifting out of the grid.
 */
export function ExpandedWidget({ instance, definition, config, envelope, setupHint, source, onClosed }: Props) {
  // Set while its settings sheet is open, so the view does not close itself
  // out from under someone part-way through adding something.
  const [editing, setEditing] = useState(false);
  const backdrop = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);

  /** The tile's corner, read from the stylesheet rather than repeated here. */
  const radius = () => {
    const tile = shell.current?.querySelector(".widget");
    return tile ? parseFloat(getComputedStyle(tile).borderTopLeftRadius) || 0 : 0;
  };
  const inner = () => shell.current?.querySelector<HTMLElement>(".widget__inner") ?? null;

  useLayoutEffect(() => {
    const el = shell.current;
    if (!el) return;
    source.style.opacity = "0";
    // Focus for keyboards and screen readers, without a ring after a tap.
    closeButton.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);

    backdrop.current?.animate({ opacity: [0, 1] }, { duration: 300, easing: "ease-out" });
    if (reducedMotion()) {
      el.animate({ opacity: [0, 1] }, { duration: 150, easing: "ease-out" });
      return;
    }
    const box = el.getBoundingClientRect();
    const r = radius();
    el.animate(
      { clipPath: [clipInset(source.getBoundingClientRect(), box, r), clipInset(box, box, r)] },
      { duration: GROW_MS, easing: GROW_EASE },
    );
    // The detail arrives once the card is most of the way there.
    inner()?.animate(
      { opacity: [0, 1], transform: ["translateY(8px)", "none"] },
      { duration: 220, delay: GROW_MS * 0.55, easing: "ease-out", fill: "backwards" },
    );
    // Once, on open: the source and shell do not change while it is showing.
  }, []);

  // Unmounted without closing, as when the profile switches: show the tile again.
  useEffect(() => () => void (source.style.opacity = ""), [source]);

  const close = useCallback(async () => {
    const el = shell.current;
    if (closing.current || !el) return;
    closing.current = true;

    const fadeBack = { duration: 180, easing: "ease-out", fill: "forwards" } as const;
    backdrop.current?.animate({ opacity: [1, 0] }, { duration: SHRINK_MS + 180, easing: "ease-in", fill: "forwards" });

    if (reducedMotion() || !source.isConnected) {
      source.style.opacity = "";
      await el.animate({ opacity: [1, 0] }, { duration: 150, easing: "ease-in", fill: "forwards" }).finished;
      onClosed();
      return;
    }

    await inner()?.animate({ opacity: [1, 0] }, { duration: 120, easing: "ease-in", fill: "forwards" }).finished;
    const box = el.getBoundingClientRect();
    const r = radius();
    await el.animate(
      { clipPath: [clipInset(box, box, r), clipInset(source.getBoundingClientRect(), box, r)] },
      { duration: SHRINK_MS, easing: SHRINK_EASE, fill: "forwards" },
    ).finished;

    // Same tint, same place: fading the tile's content in under the empty
    // shell reads as the card settling back.
    const settle = source.animate({ opacity: [0, 1] }, fadeBack);
    await el.animate({ opacity: [1, 0] }, fadeBack).finished;
    source.style.opacity = "";
    settle.cancel();
    onClosed();
  }, [source, onClosed]);

  // Escape, for a desk browser.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Back onto the wall after a spell untouched, like Settings - but not while
  // someone is part-way through adding a countdown.
  useEffect(() => {
    if (editing) return;
    let timer = window.setTimeout(() => void close(), IDLE_CLOSE_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void close(), IDLE_CLOSE_MS);
    };
    const events = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
    for (const type of events) window.addEventListener(type, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const type of events) window.removeEventListener(type, reset);
    };
  }, [close, editing]);

  const Detail = definition.detail;
  const title = definition.detailTitle ?? instance.title ?? WIDGET_NAMES[instance.type] ?? instance.type;

  return (
    <div className="expanded" role="dialog" aria-modal="true" aria-label={title}>
      <div ref={backdrop} className="expanded__backdrop" onClick={() => void close()} />
      <div ref={shell} className="expanded__shell">
        <WidgetFrame
          type={instance.type}
          title={title}
          chrome
          envelope={envelope}
          timezone={config.location.timezone}
          clock={config.units.clock}
          expanded={{ onClose: () => void close(), closeRef: closeButton }}
        >
          <WidgetErrorBoundary name={`${instance.id} (expanded)`}>
            {setupHint ? (
              <div className="widget-message">
                <p>Not connected yet.</p>
                <p className="widget-message__detail">{setupHint}</p>
              </div>
            ) : (
              <Detail instance={instance} config={config} envelope={envelope as never} />
            )}
          </WidgetErrorBoundary>
        </WidgetFrame>
      </div>
      {/* Outside the shell, which is clipped while it grows, so the sheet is
          not clipped with it. */}
      <LiveConfigEditor instance={instance} definition={definition} onBusy={setEditing} />
    </div>
  );
}
