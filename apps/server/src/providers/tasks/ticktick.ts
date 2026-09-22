import type { TaskItem, TaskMember, TasksSnapshot } from "@home-dash/shared";
import { dateKeyInZone } from "../../lib/zonedTime.js";

/**
 * The shared TickTick list, through the official Open API and a personal API
 * token (TickTick > Settings > Account > API Token). TickTick documents that
 * token for exactly this: personal use, no OAuth app, no sign-in flow.
 *
 * Assignees come from the API too - each task carries `assigneeUsername`, and
 * the list's members endpoint turns that into a display name.
 */

const API = "https://api.ticktick.com/open/v1";

interface RawProject {
  id: string;
  name: string;
}

interface RawTask {
  id: string;
  projectId: string;
  title?: string;
  /** The task's notes. A checklist task keeps its description in `desc` instead. */
  content?: string;
  desc?: string;
  /** Abandoned -1, open 0, completed 2. */
  status?: number;
  priority?: number;
  tags?: string[];
  dueDate?: string;
  isAllDay?: boolean;
  timeZone?: string;
  sortOrder?: number;
  parentId?: string;
  assigneeUsername?: string;
}

/**
 * TickTick writes notes as markdown and escapes its punctuation, so a plain
 * sentence comes back as "Night vs\. day". The wall shows the text as written,
 * not as markdown, so the escapes are dropped. Only the characters markdown
 * actually escapes are touched, which leaves a Windows path like C:\Users
 * alone.
 */
function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!>|~%,:;"'])/g, "$1");
}

export class TickTickError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TickTickError";
  }
}

/** Case, spacing, punctuation and emoji ignored: "To-Do" finds "🏡To-Do". */
const loose = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();

/**
 * TickTick writes offsets as "+0000". Safari's Date parser rejects that form,
 * so dates are normalised here and the iPad only ever sees ISO it can read.
 */
function toInstant(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeDateKey(at: Date, timezone: string | undefined, fallback: string): string {
  try {
    return dateKeyInZone(at, timezone || fallback);
  } catch {
    return dateKeyInZone(at, fallback); // an unknown zone name in the task
  }
}

const PRIORITIES = new Set([0, 1, 3, 5]);

export class TickTickTasks {
  readonly #token: string;
  readonly #listName: string;
  readonly #timezone: string;
  readonly #fetch: typeof fetch;
  #projectId: string | null = null;

  constructor(token: string, listName: string, timezone: string, fetchImpl: typeof fetch = fetch) {
    this.#token = token;
    this.#listName = listName;
    this.#timezone = timezone;
    this.#fetch = fetchImpl;
  }

  async read(): Promise<TasksSnapshot> {
    const projectId = await this.#resolveProject();

    const [data, members] = await Promise.all([
      this.#request<{ tasks?: RawTask[] }>("GET", `/project/${encodeURIComponent(projectId)}/data`).catch(
        (error: unknown) => {
          // A deleted or recreated list: look it up afresh on the next poll.
          if (error instanceof TickTickError && error.status === 404) this.#projectId = null;
          throw error;
        },
      ),
      // An unshared list has no members to read. Tasks still show without names.
      this.#request<TaskMember[]>("GET", `/project/${encodeURIComponent(projectId)}/members`).catch(() => null),
    ]);

    const names = new Map((members ?? []).map((m) => [m.username, m.displayName]));
    const sortKey = new Map<string, number>();

    const tasks: TaskItem[] = (data.tasks ?? [])
      .filter((t) => (t.status ?? 0) === 0 && !t.parentId)
      .map((t) => {
        const due = toInstant(t.dueDate);
        const allDay = Boolean(t.isAllDay && due);
        sortKey.set(t.id, due ? due.getTime() : Number.POSITIVE_INFINITY);
        const username = t.assigneeUsername || null;
        const notes = unescapeMarkdown((t.content || t.desc || "").trim());
        return {
          id: t.id,
          projectId: t.projectId,
          title: t.title?.trim() || "(Untitled)",
          ...(notes ? { notes } : {}),
          ...(due ? { dueDate: allDay ? safeDateKey(due, t.timeZone, this.#timezone) : due.toISOString() } : {}),
          dueAllDay: allDay,
          priority: (PRIORITIES.has(t.priority ?? 0) ? (t.priority ?? 0) : 0) as TaskItem["priority"],
          assignee: username ? (names.get(username) ?? username) : null,
          assigneeId: username,
          tags: t.tags ?? [],
        };
      });

    const order = new Map((data.tasks ?? []).map((t) => [t.id, t.sortOrder ?? 0]));
    tasks.sort(
      (a, b) =>
        sortKey.get(a.id)! - sortKey.get(b.id)! ||
        order.get(a.id)! - order.get(b.id)! ||
        a.title.localeCompare(b.title),
    );

    return {
      listName: this.#listName,
      projectId,
      tasks,
      members: members ?? [],
      assigneesAvailable: members !== null,
    };
  }

  async create(title: string): Promise<void> {
    const projectId = await this.#resolveProject();
    await this.#request("POST", "/task", { title: title.trim(), projectId });
  }

  async complete(projectId: string, taskId: string): Promise<void> {
    await this.#request(
      "POST",
      `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
    );
  }

  async #resolveProject(): Promise<string> {
    if (this.#projectId) return this.#projectId;

    const projects = await this.#request<RawProject[]>("GET", "/project");
    const wanted = this.#listName.normalize("NFC").trim();
    const match =
      projects.find((p) => p.name.normalize("NFC").trim() === wanted) ??
      projects.find((p) => loose(p.name) === loose(wanted));

    if (!match) {
      const available = projects.map((p) => p.name).join(", ");
      throw new Error(
        `no TickTick list called "${this.#listName}". Lists on the account: ${available}. ` +
          "Set ticktick.listName in config.yaml.",
      );
    }
    this.#projectId = match.id;
    return match.id;
  }

  async #request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await this.#fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });

    // Messages name the request, never the token.
    if (response.status === 401) {
      throw new TickTickError(401, "TickTick rejected the API token; create a new one and run npm run setup");
    }
    if (!response.ok) throw new TickTickError(response.status, `TickTick returned ${response.status} for ${method} ${path}`);

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
