import type { ConfigChange, DashboardConfig, PathSegment } from "@home-dash/shared";

/**
 * An edit session, written down as the smallest set of changes that says it.
 *
 * Two things make this worth its own file. Moving and resizing must come out
 * as plain numbers at addressed paths, because that is the only shape the
 * server can write as a few characters - anything else re-prints config.yaml
 * and reflows every comment in it. And the changes have to be emitted in an
 * order that is safe to apply one after another, which is not the order they
 * were made in.
 */

/**
 * Why order matters: the server resolves every path against the config as it
 * is *before* the patch (see ConfigStore.patch), then applies the changes in
 * turn to a document that is changing under them. So:
 *
 *   1. field edits, addressed by `{ id }` - the list has not moved yet
 *   2. removals, by index, highest first - so earlier indexes stay valid
 *   3. insertions, by index, lowest first - counted against the shortened list
 *
 * A widget that merely moved within the list is deleted and re-inserted whole
 * rather than edited in place, because its fields would otherwise be written
 * at an index it is about to leave.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const hasIds = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => isObject(item) && typeof item.id === "string");

/**
 * The value that means "leave this out of the file".
 *
 * Writing a setting that is already the default adds a line saying nothing -
 * `colSpan: 1` on every tile - so it is sent as null and the key is dropped.
 * The settings screen has always done this; edit mode writes far more, so it
 * matters more.
 */
function defaultAt(path: PathSegment[]): unknown {
  const key = path.at(-1);
  const parent = path.at(-2);

  if (parent === "grid") {
    if (key === "colSpan" || key === "rowSpan") return 1;
    if (key === "share") return false;
  }
  if (path.at(-3) === "widgets") {
    if (key === "enabled") return true;
    if (key === "page") return 1;
  }
  if (path.at(-2) === "profiles" || path.at(-3) === "profiles") {
    if (key === "returnToFirstPage") return 120;
  }
  return undefined;
}

/** Strip the defaults out of a value about to be written into the file whole. */
function lean(value: unknown, path: PathSegment[]): unknown {
  if (Array.isArray(value)) return value.map((item) => lean(item, [...path, 0]));
  if (!isObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === undefined) continue;
    const here = [...path, key];
    if (same(inner, defaultAt(here))) continue;
    if (isObject(inner)) {
      const nested = lean(inner, here) as Record<string, unknown>;
      // An empty `options: {}` says nothing; leave the key out entirely.
      if (Object.keys(nested).length > 0) out[key] = nested;
      continue;
    }
    out[key] = lean(inner, here);
  }
  return out;
}

/** The elements of `a` that can stay put while `a` is rearranged into `b`. */
function longestCommon(a: string[], b: string[]): Set<string> {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const keep = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      keep.add(a[i]!);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return keep;
}

interface Parts {
  fields: ConfigChange[];
  removals: ConfigChange[];
  insertions: ConfigChange[];
}

/** Compare two values, emitting scalar edits and recursing into objects. */
function diffValue(path: PathSegment[], base: unknown, next: unknown, parts: Parts): void {
  if (same(base, next)) return;

  if (hasIds(base) && hasIds(next)) {
    diffList(path, base, next, parts);
    return;
  }

  if (Array.isArray(base) || Array.isArray(next)) {
    // A list of plain values is small and has no identity to address, so it
    // goes in whole. The list that would hurt - widgets - is handled above.
    parts.fields.push({ path, value: lean(next, path) });
    return;
  }

  if (isObject(base) && isObject(next)) {
    for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
      const here = [...path, key];
      if (!(key in next) || next[key] === undefined) {
        if (key in base) parts.fields.push({ path: here, value: null });
        continue;
      }
      diffValue(here, base[key], next[key], parts);
    }
    return;
  }

  if (base === undefined && next !== undefined && isObject(next)) {
    parts.fields.push({ path, value: lean(next, path) });
    return;
  }

  // Back at its default, so the key comes out rather than being written.
  parts.fields.push({ path, value: same(next, defaultAt(path)) ? null : (next ?? null) });
}

/**
 * Compare two lists whose items have ids: edit what stayed, remove what went,
 * insert what arrived, and treat anything that changed places as both.
 */
function diffList(
  path: PathSegment[],
  base: Record<string, unknown>[],
  next: Record<string, unknown>[],
  parts: Parts,
): void {
  const baseIds = base.map((item) => item.id as string);
  const nextIds = next.map((item) => item.id as string);
  const nextById = new Map(next.map((item) => [item.id as string, item]));

  const surviving = baseIds.filter((id) => nextById.has(id));
  const arriving = nextIds.filter((id) => baseIds.includes(id));
  const staying = longestCommon(surviving, arriving);

  // Anything not staying is written out and written back, so its fields travel
  // with it rather than being edited at a position it is about to leave.
  for (const [index, item] of base.entries()) {
    const id = item.id as string;
    if (staying.has(id)) {
      diffValue([...path, { id }], item, nextById.get(id), parts);
    } else {
      parts.removals.push({ path: [...path, index], value: null });
    }
  }

  // Insert positions are counted against the list once the removals are done,
  // which is exactly what walking the target order from the left gives.
  for (const [index, item] of next.entries()) {
    if (!staying.has(item.id as string)) {
      // Leaned against its own position, so `widgets[n].enabled` is recognised
      // as the key it is and a default is left out rather than written.
      parts.insertions.push({ path: [...path, index], value: lean(item, [...path, index]), op: "insert" });
    }
  }
}

/** The whole edit session as targeted config edits, in an order safe to apply in sequence. */
export function configChanges(base: DashboardConfig, next: DashboardConfig): ConfigChange[] {
  const parts: Parts = { fields: [], removals: [], insertions: [] };
  diffValue([], base, next, parts);

  // Highest index first, so the ones before it are still where they were.
  const removals = [...parts.removals].sort((a, b) => (b.path.at(-1) as number) - (a.path.at(-1) as number));
  const insertions = [...parts.insertions].sort((a, b) => (a.path.at(-1) as number) - (b.path.at(-1) as number));
  return [...parts.fields, ...removals, ...insertions];
}
