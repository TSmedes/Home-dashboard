import { Document as YamlDocument, isMap, isScalar, isSeq, parseDocument, Scalar, type Document, type Node, type Pair } from "yaml";

/** A change whose `{ id }` path segments have already been turned into indexes. */
export interface ResolvedChange {
  path: (string | number)[];
  /** null removes the key. */
  value: unknown;
  /** Insert before this list position rather than replacing what is there. */
  op?: "insert";
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


/**
 * Write a nested map of plain values on one line.
 *
 * It is how this file is written by hand - `grid: { col: 1, row: 1 }`,
 * `schedule: { from: "06:30", to: "21:30" }` - and a widget added from the
 * dashboard that spread its grid over five lines would stand out as the one
 * the machine wrote.
 */
function inlineScalarMaps(node: unknown): void {
  if (isMap(node)) {
    for (const pair of node.items as Pair[]) {
      const value = pair.value;
      if (isMap(value) && value.items.length > 0 && (value.items as Pair[]).every((p) => isScalar(p.value))) {
        value.flow = true;
      } else {
        inlineScalarMaps(value);
      }
    }
    return;
  }
  if (isSeq(node)) for (const item of node.items) inlineScalarMaps(item);
}

/** One block-sequence entry, `- ` marker and all, indented to sit in its list. */
function renderItem(value: unknown, indent: number, newline: string): string | null {
  const doc = new YamlDocument(value);
  inlineScalarMaps(doc.contents as Node);
  const body = doc.toString({ lineWidth: 0 }).trimEnd();
  if (body === "") return null;
  const pad = " ".repeat(indent);
  return (
    body
      .split("\n")
      .map((line, i) => (i === 0 ? `${pad}- ${line}` : `${pad}  ${line}`))
      .join(newline) + newline
  );
}

/**
 * The text edit for adding, replacing or removing one entry of a block list.
 *
 * Without this a list can only be written back whole, which replaces the node
 * and takes every comment inside it - and `widgets:` is where the notes
 * explaining the dashboard live. Working in lines instead keeps the rest of
 * the list exactly as it was.
 */
function seqEdit(src: string, doc: Document, change: ResolvedChange, order: number, newline: string): Edit | null {
  const { path, value, op } = change;
  const index = path.at(-1);
  if (typeof index !== "number") return null;

  const parent = path.length === 1 ? doc.contents : doc.getIn(path.slice(0, -1), true);
  // Flow lists (`[ SNQW1, TANW1 ]`) are one line; leave those to the reprint.
  if (!isSeq(parent) || parent.flow) return null;
  const items = parent.items as Ranged[];
  const first = items[0];
  if (!first?.range) return null;

  // The `- ` marker sits two characters before the entry's own first token.
  const indent = first.range[0] - lineStart(src, first.range[0]) - 2;
  if (indent < 0) return null;

  /**
   * Where an entry really begins: at the comment written above it rather than
   * at its own first line, because that note explains this entry.
   *
   * `throughBlanks` also swallows the blank line separating it from the entry
   * before. Removing an entry wants that - otherwise the file collects blank
   * lines - but inserting one does not, because the new entry wants to land
   * below the blank and keep its own separation.
   */
  const blockStart = (at: number, floor: number, throughBlanks: boolean): number => {
    let start = lineStart(src, at);
    while (start > floor) {
      const previous = lineStart(src, start - 1);
      const line = src.slice(previous, start).trim();
      if (line === "" ? !throughBlanks : !line.startsWith("#")) break;
      start = previous;
    }
    return start;
  };

  // Does this list put a blank line between its entries? Matching it is the
  // difference between an added widget looking written and looking pasted.
  // An entry's range already ends past the newline of its last line, so
  // anything between that and the next entry's block is blank lines.
  const secondStart = items[1]?.range?.[0];
  const spaced =
    secondStart !== undefined &&
    src.slice(first.range[1], blockStart(secondStart, first.range[1], false)).includes("\n");
  const gap = spaced ? newline : "";

  if (op === "insert") {
    if (value === null) return null;
    const text = renderItem(value, indent, newline);
    if (text === null) return null;

    if (index < items.length) {
      // Before the entry it displaces, and before that entry's own comment.
      const floor = index === 0 ? 0 : items[index - 1]!.range![1];
      const at = blockStart(items[index]!.range![0], floor, false);
      return { start: at, end: at, text: `${text}${gap}`, order };
    }

    // Appending. A block entry's range already ends past the newline of its
    // last line, so this is the start of whatever follows the list - before
    // any blank line, which is why the new entry brings its own separator.
    const last = items.at(-1);
    if (!last?.range) return null;
    const at = Math.min(last.range[1], src.length);
    return at >= src.length
      ? { start: src.length, end: src.length, text: `${gap}${text}`, order }
      : { start: at, end: at, text: `${gap}${text}`, order };
  }

  const item = items[index];
  if (!item?.range) return null;

  // A removed entry takes the comment written above it: it explains that
  // entry, and leaving it behind would attach it to whatever follows.
  const start = blockStart(item.range[0], index === 0 ? 0 : lineEnd(src, items[index - 1]!.range![1]) + 1, true);

  const end = Math.min(lineEnd(src, item.range[1]) + 1, src.length);
  if (value === null) return { start, end, text: "", order };
  const text = renderItem(value, indent, newline);
  return text === null ? null : { start, end, text, order };
}

/** The text edit for one change, or null if it cannot be done as a small edit. */
function editFor(src: string, doc: Document, change: ResolvedChange, order: number, newline: string): Edit | null {
  const { path, value } = change;
  const key = path.at(-1);
  if (typeof key === "number") return seqEdit(src, doc, change, order, newline);
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
  if (Array.isArray(node) && typeof key === "number") {
    // A list position: insert before it, remove it, or replace it. Assigning
    // would overwrite the entry an insert is supposed to push along.
    if (change.op === "insert") node.splice(key, 0, change.value);
    else if (change.value === null) node.splice(key, 1);
    else node.splice(key, 1, change.value);
    return;
  }
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
