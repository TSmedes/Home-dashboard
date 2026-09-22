import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * How many of a list's children fit inside it.
 *
 * The tile is a fixed cell on the wall, so a list that overflows is clipped
 * mid-row, which reads as a bug rather than as "there is more". This measures
 * instead: render everything, see where the container's edge falls, and keep
 * only the whole rows above it.
 *
 * Measuring in two phases is what stops it oscillating. While `limit` is null
 * every child is rendered, so the measurement always sees the full list; the
 * count it produces is then applied. Anything that could change the answer -
 * the card resizing, or the data changing - goes back to null and measures
 * again. The overflowing render is never seen, because the container clips.
 */
export function useFitCount<T extends HTMLElement>(dataKey: string): {
  ref: (node: T | null) => void;
  limit: number | null;
} {
  const [limit, setLimit] = useState<number | null>(null);
  const element = useRef<T | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  // A callback ref, so the first measurement happens as soon as the list is in
  // the DOM rather than a frame later.
  const ref = useCallback((node: T | null) => {
    element.current = node;
    observer.current?.disconnect();
    if (!node) return;
    observer.current = new ResizeObserver(() => setLimit(null));
    observer.current.observe(node);
  }, []);

  useLayoutEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    [],
  );

  // Back to measuring whenever the list's contents change.
  useLayoutEffect(() => setLimit(null), [dataKey]);

  useLayoutEffect(() => {
    const node = element.current;
    if (limit !== null || !node) return;
    const bottom = node.getBoundingClientRect().bottom;
    let fits = 0;
    for (const child of node.children) {
      // A row half over the edge does not count; better to drop it than to
      // slice it.
      if (child.getBoundingClientRect().bottom > bottom + 0.5) break;
      fits += 1;
    }
    setLimit(fits);
  }, [limit, dataKey]);

  return { ref, limit };
}
