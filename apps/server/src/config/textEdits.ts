import { isMap, isScalar, parseDocument, Scalar, type Document, type Pair } from "yaml";

/** A change whose `{ id }` path segments have already been turned into indexes. */
export interface ResolvedChange {
  path: (string | number)[];
  /** null removes the key. */
  value: unknown;
}

interface Edit {
  start: number;
  end: number;
  text: string;
  order: number;
}

type Ranged = { range?: [number, number, number] | null };

const lineStart = (src: string, pos: number) => src.lastIndexOf("\n", pos - 1) + 1;
const lineEnd = (src: string, pos: number) => {
  const at = src.indexOf("\n", pos);
  return at === -1 ? src.length : at;
};

const isSimple = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/** Write a value the way the original was written: same quoting where there was one. */
function render(value: string | number | boolean, like?: Scalar): string {
  if (typeof value !== "string") return String(value);
  if (like?.type === Scalar.QUOTE_SINGLE) return `'${value.replace(/'/g, "''")}'`;
  if (like?.type !== Scalar.QUOTE_DOUBLE) {
    // Plain only if it would read back as this exact string ("yes", "12" and
    // "a: b" would not).
    try {
      if (value && value.trim() === value && parseDocument(`k: ${value}\n`).toJS()?.k === value) return value;
    } catch {
      /* fall through to quoting */
    }
  }
  return JSON.stringify(value);
}

/** The text edit for one change, or null if it cannot be done as a small edit. */
function editFor(src: string, doc: Document, change: ResolvedChange, order: number, newline: string): Edit | null {
  const { path, value } = change;
  const key = path.at(-1);
  if (typeof key !== "string" || (value !== null && !isSimple(value))) return null;

  const parent = path.length === 1 ? doc.contents : doc.getIn(path.slice(0, -1), true);
  if (!isMap(parent)) return null;
  const items = parent.items as Pair[];
  const index = items.findIndex((pair) => isScalar(pair.key) && pair.key.value === key);
  const pair = items[index];

  if (pair) {
    const node = pair.value;
    const keyRange = (pair.key as Ranged).range;
    if (!isScalar(node) || !node.range || !keyRange) return null;

    // Replace just the value's characters; the comment after it is untouched.
    if (value !== null) return { start: node.range[0], end: node.range[1], text: render(value, node), order };

    if (parent.flow) {
      // `{ a: 1, key: 2 }` -> `{ a: 1 }`: drop the separator with it.
      const previous = (items[index - 1]?.value as Ranged | undefined)?.range;
      if (previous) return { start: previous[1], end: node.range[1], text: "", order };
      const next = (items[index + 1]?.key as Ranged | undefined)?.range;
      return next ? { start: keyRange[0], end: next[0], text: "", order } : null;
    }
    // Block map: remove the key's own line, but only when it has the line to itself.
    const start = lineStart(src, keyRange[0]);
    if (src.slice(start, keyRange[0]).trim() !== "") return null;
    return { start, end: Math.min(lineEnd(src, node.range[1]) + 1, src.length), text: "", order };
  }

  if (value === null) return { start: 0, end: 0, text: "", order }; // nothing to remove
  const lastValue = (items.at(-1)?.value as Ranged | undefined)?.range;
  const firstKey = (items[0]?.key as Ranged | undefined)?.range;
  if (!lastValue || !firstKey) return null;

  if (parent.flow) return { start: lastValue[1], end: lastValue[1], text: `, ${key}: ${render(value)}`, order };

  // Block map: a new line after the map's last line, at the map's own indent -
  // before any comment that belongs to whatever comes next.
  const indent = " ".repeat(firstKey[0] - lineStart(src, firstKey[0]));
  const end = lineEnd(src, lastValue[1]);
  const line = `${indent}${key}: ${render(value)}`;
  return end === src.length
    ? { start: end, end, text: `${newline}${line}`, order }
    : { start: end + 1, end: end + 1, text: `${line}${newline}`, order };
}

function applyToPlain(target: unknown, change: ResolvedChange): void {
  let node = target as Record<string | number, unknown>;
  for (const segment of change.path.slice(0, -1)) node = node[segment] as Record<string | number, unknown>;
  const key = change.path.at(-1)!;
  if (change.value === null) delete node[key];
  else node[key] = change.value;
}

/**
 * Make `changes` as small, surgical edits to the file's text, leaving every
 * other character - spacing, aligned comment columns, blank lines, quoting -
 * exactly as it was. Re-printing the document instead would realign comments
 * on lines nowhere near the edit.
 *
 * Returns null when a change can't be done this way, or when the edited text
 * doesn't mean exactly what the changes intended; the caller then falls back
 * to re-printing, which is always correct, just less tidy.
 */
export function editText(src: string, doc: Document, changes: ResolvedChange[]): string | null {
  const newline = src.includes("\r\n") ? "\r\n" : "\n";
  const edits: Edit[] = [];
  for (const [order, change] of changes.entries()) {
    const edit = editFor(src, doc, change, order, newline);
    if (!edit) return null;
    if (edit.start !== edit.end || edit.text) edits.push(edit);
  }

  // Apply from the end of the file backwards so earlier offsets stay valid;
  // at the same spot, later changes first, so the text reads in change order.
  edits.sort((a, b) => b.start - a.start || b.order - a.order);
  let text = src;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of edits) {
    if (edit.end > floor) return null; // overlapping edits; not worth being clever
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    floor = edit.start;
  }

  // The safety net: the edited file must mean exactly what was intended.
  const edited = parseDocument(text);
  if (edited.errors.length > 0) return null;
  const expected = structuredClone(doc.toJS()) as unknown;
  for (const change of changes) applyToPlain(expected, change);
  return JSON.stringify(edited.toJS()) === JSON.stringify(expected) ? text : null;
}
