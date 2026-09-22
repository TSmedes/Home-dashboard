import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isScalar, isSeq, parseDocument, type Document } from "yaml";
import { editText, type ResolvedChange } from "./textEdits.js";
import type { ZodIssue } from "zod";
import {
  DashboardConfigSchema,
  type ConfigChange,
  type DashboardConfig,
  type PathSegment,
} from "@home-dash/shared";

export type { ConfigChange, PathSegment } from "@home-dash/shared";

/**
 * Turn `{ id }` segments into array indexes against the config as it is right
 * now, so a save addresses "the agenda widget", not "whatever is third".
 */
function resolvePath(config: unknown, path: PathSegment[]): (string | number)[] {
  const resolved: (string | number)[] = [];
  let node: unknown = config;
  for (const segment of path) {
    if (typeof segment === "object") {
      if (!Array.isArray(node)) {
        throw new Error(`${resolved.join(".") || "(root)"} is not a list, so "${segment.id}" cannot be found in it`);
      }
      const index = node.findIndex((item) => (item as { id?: unknown })?.id === segment.id);
      if (index === -1) throw new Error(`nothing with id "${segment.id}" at ${resolved.join(".")}`);
      resolved.push(index);
      node = node[index];
    } else {
      resolved.push(segment);
      node = (node as Record<string | number, unknown> | undefined)?.[segment];
    }
  }
  return resolved;
}

export function formatConfigError(issues: ZodIssue[]): string {
  const lines = issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
  return `config.yaml is not valid:\n${lines.join("\n")}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Write `next` into `doc`, touching only what actually changed.
 *
 * Nodes whose value is unchanged are left alone entirely, so their comments and
 * formatting survive. For a changed scalar we mutate the existing node's value
 * rather than replacing the node, which keeps the comment attached to that line
 * too - the difference between the settings UI being safe to use on a
 * hand-annotated file and quietly eating the owner's notes.
 */
export function applyToDocument(doc: Document, next: unknown, path: (string | number)[] = []): void {
  if (isPlainObject(next)) {
    const existing = path.length === 0 ? doc.contents : doc.getIn(path);
    if (existing && typeof (existing as { has?: unknown }).has === "function") {
      const keys = (existing as { items: { key: { value: string } }[] }).items
        .map((item) => item.key?.value)
        .filter((k): k is string => typeof k === "string");
      for (const key of keys) {
        if (!(key in next)) doc.deleteIn([...path, key]);
      }
    }
    for (const [key, value] of Object.entries(next)) {
      applyToDocument(doc, value, [...path, key]);
    }
    return;
  }

  const current = path.length === 0 ? doc.contents : doc.getIn(path, true);
  if (isScalar(current) && !isPlainObject(next) && !Array.isArray(next)) {
    if (current.value !== next) current.value = next as never;
    return;
  }
  if (JSON.stringify(doc.getIn(path)) === JSON.stringify(next)) return;
  doc.setIn(path, next);
}

/**
 * Owns config.yaml: parsing, validation, and comment-preserving write-back.
 *
 * The in-memory config is only replaced once a new version validates, so a
 * broken hand edit over SSH leaves the running dashboard on its last good
 * configuration instead of taking the display down.
 */
export class ConfigStore {
  #doc: Document;
  #config: DashboardConfig;

  private constructor(
    readonly path: string,
    doc: Document,
    config: DashboardConfig,
  ) {
    this.#doc = doc;
    this.#config = config;
  }

  static async open(path: string): Promise<ConfigStore> {
    const { doc, config } = await ConfigStore.#read(path);
    return new ConfigStore(path, doc, config);
  }

  get current(): DashboardConfig {
    return this.#config;
  }

  get document(): Document {
    return this.#doc;
  }

  static async #read(path: string): Promise<{ doc: Document; config: DashboardConfig }> {
    const raw = await readFile(path, "utf8");
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      throw new Error(`config.yaml could not be parsed: ${doc.errors[0]!.message}`);
    }
    const parsed = DashboardConfigSchema.safeParse(doc.toJS());
    if (!parsed.success) throw new Error(formatConfigError(parsed.error.issues));
    return { doc, config: parsed.data };
  }

  /** Re-read from disk. Throws and keeps the previous config if the file is bad. */
  async reload(): Promise<DashboardConfig> {
    const { doc, config } = await ConfigStore.#read(this.path);
    this.#doc = doc;
    this.#config = config;
    return config;
  }

  /**
   * Apply a few targeted edits - what the settings screen saves through.
   *
   * Only the addressed values change: formatting, ordering and comments are
   * untouched, and defaults are never written into the file (replace() would
   * add `options: {}` to every widget). A null value removes the key, so
   * returning a setting to its default leaves no trace. The file is re-read first, so a hand
   * edit made moments before is kept rather than overwritten by a stale copy.
   */
  async patch(changes: ConfigChange[]): Promise<DashboardConfig> {
    const source = await readFile(this.path, "utf8");
    const original = parseDocument(source);
    if (original.errors.length > 0) {
      throw new Error(`config.yaml could not be parsed: ${original.errors[0]!.message}`);
    }

    const plain = original.toJS();
    const resolved: ResolvedChange[] = changes.map((change) => ({
      path: resolvePath(plain, change.path),
      value: change.value,
      ...(change.op ? { op: change.op } : {}),
    }));

    // Small text edits first; re-printing the document only if they can't do it.
    const text = editText(source, original, resolved) ?? ConfigStore.#reprint(source, resolved);

    const doc = parseDocument(text);
    const parsed = DashboardConfigSchema.safeParse(doc.toJS());
    if (!parsed.success) throw new Error(formatConfigError(parsed.error.issues));

    const tmp = join(dirname(this.path), `.config.yaml.${process.pid}.tmp`);
    await writeFile(tmp, text, "utf8");
    await rename(tmp, this.path);

    this.#doc = doc;
    this.#config = parsed.data;
    return parsed.data;
  }

  /**
   * The fallback: apply the changes to the parsed document and print it again.
   * Always correct and keeps comments, but the YAML library re-spaces some of
   * them, so it is only used when a small text edit cannot express a change.
   */
  static #reprint(source: string, changes: ResolvedChange[]): string {
    const doc = parseDocument(source);
    for (const { path, value, op } of changes) {
      if (op === "insert") {
        // Push the rest of the list along rather than overwriting an entry.
        const seq = doc.getIn(path.slice(0, -1), true);
        if (isSeq(seq)) seq.items.splice(path.at(-1) as number, 0, doc.createNode(value));
        continue;
      }
      // null means "back to the default": drop the key rather than write it.
      if (value === null) {
        // A list entry is removed from the list; deleteIn would leave a hole.
        const parent = doc.getIn(path.slice(0, -1), true);
        if (isSeq(parent) && typeof path.at(-1) === "number") parent.items.splice(path.at(-1) as number, 1);
        else doc.deleteIn(path);
        continue;
      }
      const node = doc.getIn(path, true);
      // Mutating the existing scalar keeps its quoting and trailing comment.
      if (isScalar(node) && typeof value !== "object") node.value = value as never;
      else doc.setIn(path, value);
    }
    return doc.toString();
  }

  /** Validate and persist a whole new config, preserving comments. */
  async replace(next: unknown): Promise<DashboardConfig> {
    const parsed = DashboardConfigSchema.safeParse(next);
    if (!parsed.success) throw new Error(formatConfigError(parsed.error.issues));

    const doc = parseDocument(this.#doc.toString());
    applyToDocument(doc, JSON.parse(JSON.stringify(parsed.data)));

    // Temp file + rename, so a crash mid-write cannot leave a truncated config.
    const tmp = join(dirname(this.path), `.config.yaml.${process.pid}.tmp`);
    await writeFile(tmp, doc.toString(), "utf8");
    await rename(tmp, this.path);

    this.#doc = doc;
    this.#config = parsed.data;
    return parsed.data;
  }
}
