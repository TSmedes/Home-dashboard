import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { WidgetInstance } from "@home-dash/shared";
import { gridUnits, snapRect, type Units } from "./geometry.js";
import { blocksOf, dropOutcome, rowsOf, type Block, type Drop, type Rect } from "./grid.js";

/** How long a refused tile takes to slide back. Short: it is a correction, not an animation. */
const SPRING_MS = 180;

export interface Dragging {
  id: string;
  /** Where it would land, snapped to the grid. */
  rect: Rect;
  outcome: Drop;
}

interface Session {
  id: string;
  cell: HTMLElement;
  start: Rect;
  origin: { x: number; y: number };
  units: Units;
  rows: number;
  blocks: Block[];
  moved: boolean;
}

interface Args {
  grid: RefObject<HTMLDivElement | null>;
  /** The page's widgets, which decide what space is taken. */
  widgets: WidgetInstance[];
  onDrop: (id: string, rect: Rect, outcome: Drop) => void;
}

const sameRect = (a: Rect, b: Rect) =>
  a.col === b.col && a.row === b.row && a.colSpan === b.colSpan && a.rowSpan === b.rowSpan;

/**
 * Dragging a tile across the grid.
 *
 * Pointer events with capture, so the drag keeps arriving once the finger
 * leaves the handle, and so it works the same for touch, trackpad and pen. The
 * handle itself is what makes this safe on a touch screen: it carries
 * `touch-action: none`, which is what stops Safari deciding halfway through
 * that the gesture was really a scroll.
 *
 * The tile is moved with a transform written straight to the element, outside
 * React, because that is one composited property and never reflows the grid.
 * Only the snapped rectangle goes through state, so a render happens once per
 * cell crossed rather than once per frame.
 */
export function useDrag({ grid, widgets, onDrop }: Args) {
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const session = useRef<Session | null>(null);

  const finish = useCallback(() => {
    session.current = null;
    setDragging(null);
  }, []);

  const onPointerDown = useCallback(
    (widget: WidgetInstance) => (event: ReactPointerEvent<HTMLElement>) => {
      const gridEl = grid.current;
      const cell = event.currentTarget.closest<HTMLElement>(".grid__cell");
      if (!gridEl || !cell || session.current) return;

      // A second finger, or the right mouse button, is not a drag.
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      const box = gridEl.getBoundingClientRect();
      // The gap is part of the pitch, and it is in the stylesheet rather than
      // here so the two cannot drift apart.
      const gap = Number.parseFloat(getComputedStyle(gridEl).columnGap) || 0;
      const rows = rowsOf(widgets);

      session.current = {
        id: widget.id,
        cell,
        start: {
          col: widget.grid.col ?? 1,
          row: widget.grid.row,
          colSpan: widget.grid.colSpan,
          rowSpan: widget.grid.rowSpan,
        },
        origin: { x: event.clientX, y: event.clientY },
        units: gridUnits(box.width, box.height, rows, gap),
        rows,
        blocks: blocksOf(widgets),
        moved: false,
      };
    },
    [grid, widgets],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const live = session.current;
    if (!live) return;

    const dx = event.clientX - live.origin.x;
    const dy = event.clientY - live.origin.y;
    // Ignore the shake of a finger coming to rest on the handle.
    if (!live.moved && Math.hypot(dx, dy) < 4) return;
    live.moved = true;

    live.cell.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;

    const rect = snapRect(live.start, dx, dy, live.units, live.rows);
    const outcome = dropOutcome(live.blocks, live.id, rect);
    setDragging((prev) =>
      prev && sameRect(prev.rect, rect) && prev.outcome.kind === outcome.kind
        ? prev
        : { id: live.id, rect, outcome },
    );
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const live = session.current;
      if (!live) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const dx = event.clientX - live.origin.x;
      const dy = event.clientY - live.origin.y;
      const rect = snapRect(live.start, dx, dy, live.units, live.rows);
      const outcome = live.moved ? dropOutcome(live.blocks, live.id, rect) : ({ kind: "blocked" } as Drop);

      if (outcome.kind === "blocked") {
        // Slide back from where it was let go, so the refusal is legible
        // rather than the tile simply vanishing back to its place.
        const from = live.cell.style.transform;
        live.cell.style.transform = "";
        if (live.moved && from) {
          live.cell.animate?.({ transform: [from, "none"] }, { duration: SPRING_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" });
        }
        finish();
        return;
      }

      // Clearing the transform and committing the new placement in the same
      // turn means the tile never shows one frame at the old grid position.
      live.cell.style.transform = "";
      onDrop(live.id, rect, outcome);
      finish();
    },
    [onDrop, finish],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const live = session.current;
      if (!live) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      live.cell.style.transform = "";
      finish();
    },
    [finish],
  );

  return { dragging, handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
