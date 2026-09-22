import { describe, expect, it, vi } from "vitest";
import { TickTickTasks } from "./ticktick.js";

const TOKEN = "tp_secret_token_value_0123456789";
const TZ = "America/Los_Angeles";

// Shapes follow developer.ticktick.com/docs/openapi.md.
const projects = [
  { id: "inbox1", name: "Inbox", closed: false },
  { id: "todo1", name: "🏡To-Do", closed: false },
  { id: "work1", name: "Work", closed: false },
];

const members = [
  { username: "tobysmedes@gmail.com", displayName: "Toby", self: true },
  { username: "partner@example.com", displayName: "Alex", self: false },
];

const task = (over: Record<string, unknown>) => ({
  id: "t",
  projectId: "todo1",
  title: "Task",
  status: 0,
  priority: 0,
  sortOrder: 0,
  tags: [],
  ...over,
});

const data = {
  project: { id: "todo1", name: "🏡To-Do" },
  tasks: [
    task({ id: "a", title: "Take the bins out", assigneeUsername: "tobysmedes@gmail.com", sortOrder: 20 }),
    task({ id: "b", title: "Book the vet", assigneeUsername: "partner@example.com", priority: 5, sortOrder: 10 }),
    task({ id: "c", title: "Fix the fence", sortOrder: 30 }),
    task({ id: "d", title: "Pay water bill", dueDate: "2026-09-23T07:00:00+0000", isAllDay: true, timeZone: TZ }),
    task({ id: "e", title: "Call plumber", dueDate: "2026-09-22T22:30:00+0000", isAllDay: false, timeZone: TZ }),
    task({ id: "done", title: "Already done", status: 2 }),
    task({ id: "abandoned", title: "Won't do", status: -1 }),
    task({ id: "sub", title: "A subtask", parentId: "a" }),
    task({ id: "gone", title: "Ex-member's task", assigneeUsername: "former@example.com", sortOrder: 40 }),
  ],
};

type Route = (init?: RequestInit) => Response | Promise<Response>;

function api(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body?: unknown; auth?: string | null }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("https://api.ticktick.com/open/v1", "");
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init?.headers).get("Authorization"),
    });
    const route = routes[`${method} ${path}`];
    return route ? route(init) : new Response("", { status: 404 });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

const standard = () =>
  api({
    "GET /project": json(projects),
    "GET /project/todo1/data": json(data),
    "GET /project/todo1/members": json(members),
  });

describe("TickTickTasks.read", () => {
  it("sends the token as a Bearer header", async () => {
    const { calls, fetchImpl } = standard();
    await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read();
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("finds the configured list and reports its id", async () => {
    const { fetchImpl } = standard();
    const snapshot = await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read();
    expect(snapshot).toMatchObject({ listName: "🏡To-Do", projectId: "todo1", assigneesAvailable: true });
  });

  // Emoji are easy to mistype in YAML; "To-Do" should still find "🏡To-Do".
  it.each(["To-Do", "🏡 To-Do", "to-do", "todo"])("matches the list when configured as %j", async (name) => {
    const { fetchImpl } = standard();
    expect((await new TickTickTasks(TOKEN, name, TZ, fetchImpl).read()).projectId).toBe("todo1");
  });

  it("names the lists that do exist when the configured one is missing", async () => {
    const { fetchImpl } = standard();
    await expect(new TickTickTasks(TOKEN, "Groceries", TZ, fetchImpl).read()).rejects.toThrow(
      /no TickTick list called "Groceries".*Inbox, 🏡To-Do, Work/,
    );
  });

  it("keeps only open, top-level tasks", async () => {
    const { fetchImpl } = standard();
    const ids = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks.map((t) => t.id);
    expect(ids).not.toContain("done");
    expect(ids).not.toContain("abandoned");
    expect(ids).not.toContain("sub");
    expect(ids).toHaveLength(6);
  });

  it("names each assignee from the list's members", async () => {
    const { fetchImpl } = standard();
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "a")).toMatchObject({ assignee: "Toby", assigneeId: "tobysmedes@gmail.com" });
    expect(tasks.find((t) => t.id === "b")).toMatchObject({ assignee: "Alex", assigneeId: "partner@example.com" });
    expect(tasks.find((t) => t.id === "c")).toMatchObject({ assignee: null, assigneeId: null });
  });

  it("falls back to the username for an assignee who has left the list", async () => {
    const { fetchImpl } = standard();
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "gone")?.assignee).toBe("former@example.com");
  });

  it("returns the members, marking which one owns the token", async () => {
    const { fetchImpl } = standard();
    const snapshot = await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read();
    expect(snapshot.members).toEqual(members);
  });

  // Safari's Date parser rejects "+0000"; the iPad must get ISO it can read.
  it("normalises a timed due date to ISO with a Z", async () => {
    const { fetchImpl } = standard();
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "e")).toMatchObject({ dueDate: "2026-09-22T22:30:00.000Z", dueAllDay: false });
  });

  // The real API includes milliseconds, which the documentation examples omit.
  it("handles the millisecond form the live API actually returns", async () => {
    const { fetchImpl } = api({
      "GET /project": json(projects),
      "GET /project/todo1/data": json({
        tasks: [
          task({ id: "ms", dueDate: "2026-09-23T07:00:00.000+0000", isAllDay: true, timeZone: TZ }),
          task({ id: "ms-timed", dueDate: "2026-09-22T22:30:00.000+0000", isAllDay: false, timeZone: TZ }),
        ],
      }),
      "GET /project/todo1/members": json(members),
    });
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "ms")?.dueDate).toBe("2026-09-23");
    expect(tasks.find((t) => t.id === "ms-timed")?.dueDate).toBe("2026-09-22T22:30:00.000Z");
  });

  it("turns an all-day due date into the calendar date in the task's timezone", async () => {
    // Midnight in Los Angeles, stored by TickTick as 07:00 UTC.
    const { fetchImpl } = standard();
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "d")).toMatchObject({ dueDate: "2026-09-23", dueAllDay: true });
  });

  it("puts dated tasks first by due date, then the rest in list order", async () => {
    const { fetchImpl } = standard();
    const ids = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks.map((t) => t.id);
    expect(ids).toEqual(["e", "d", "b", "a", "c", "gone"]);
  });

  it("keeps TickTick's priority scale and passes tags through", async () => {
    const { fetchImpl } = standard();
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "b")?.priority).toBe(5);
    expect(tasks.find((t) => t.id === "a")?.tags).toEqual([]);
  });

  // The notes a task carries in TickTick, so the wall can show more than a title.
  it("reads a task's notes from content", async () => {
    const { fetchImpl } = api({
      "GET /project": json(projects),
      "GET /project/todo1/data": json({
        project: { id: "todo1", name: "🏡To-Do" },
        tasks: [task({ id: "n", content: "  Blue bin, kerb by 7am  " })],
      }),
      "GET /project/todo1/members": json(members),
    });
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "n")?.notes).toBe("Blue bin, kerb by 7am");
  });

  // A checklist task puts its description in desc, leaving content for the items.
  it("falls back to desc when a task has no content", async () => {
    const { fetchImpl } = api({
      "GET /project": json(projects),
      "GET /project/todo1/data": json({
        project: { id: "todo1", name: "🏡To-Do" },
        tasks: [task({ id: "n", desc: "Everything for the trip" })],
      }),
      "GET /project/todo1/members": json(members),
    });
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "n")?.notes).toBe("Everything for the trip");
  });

  // TickTick escapes markdown punctuation on the way out; the wall wants prose.
  it("unescapes the backslashes TickTick puts before punctuation", async () => {
    const { fetchImpl } = api({
      "GET /project": json(projects),
      "GET /project/todo1/data": json({
        project: { id: "todo1", name: "🏡To-Do" },
        tasks: [task({ id: "n", content: "Night vs\\. day\\, then \\(later\\) 50\\% off" })],
      }),
      "GET /project/todo1/members": json(members),
    });
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "n")?.notes).toBe("Night vs. day, then (later) 50% off");
  });

  it("keeps a backslash that is not escaping anything", async () => {
    const { fetchImpl } = api({
      "GET /project": json(projects),
      "GET /project/todo1/data": json({
        project: { id: "todo1", name: "🏡To-Do" },
        tasks: [task({ id: "n", content: "C:\\Users\\toby" })],
      }),
      "GET /project/todo1/members": json(members),
    });
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "n")?.notes).toBe("C:\\Users\\toby");
  });

  // Absent rather than empty, so the widget can test the field itself.
  it("leaves notes off a task whose content is empty or blank", async () => {
    const { fetchImpl } = api({
      "GET /project": json(projects),
      "GET /project/todo1/data": json({
        project: { id: "todo1", name: "🏡To-Do" },
        tasks: [task({ id: "blank", content: "   " }), task({ id: "none" })],
      }),
      "GET /project/todo1/members": json(members),
    });
    const tasks = (await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read()).tasks;
    expect(tasks.find((t) => t.id === "blank")).not.toHaveProperty("notes");
    expect(tasks.find((t) => t.id === "none")).not.toHaveProperty("notes");
  });

  // An unshared list has no members to read; tasks should still show.
  it("still returns tasks when the members cannot be read", async () => {
    const { fetchImpl } = api({
      "GET /project": json(projects),
      "GET /project/todo1/data": json(data),
      "GET /project/todo1/members": () => new Response("", { status: 403 }),
    });
    const snapshot = await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read();
    expect(snapshot.assigneesAvailable).toBe(false);
    expect(snapshot.members).toEqual([]);
    expect(snapshot.tasks.find((t) => t.id === "a")?.assignee).toBe("tobysmedes@gmail.com");
  });

  it("looks the list up once rather than on every poll", async () => {
    const { calls, fetchImpl } = standard();
    const tasks = new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl);
    await tasks.read();
    await tasks.read();
    expect(calls.filter((c) => c.path === "/project")).toHaveLength(1);
  });

  it("looks the list up again if it has been deleted or recreated", async () => {
    let dataStatus = 200;
    const { calls, fetchImpl } = api({
      "GET /project": json(projects),
      "GET /project/todo1/data": () => new Response(JSON.stringify(data), { status: dataStatus }),
      "GET /project/todo1/members": json(members),
    });
    const tasks = new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl);
    await tasks.read();
    dataStatus = 404;
    await expect(tasks.read()).rejects.toThrow();
    dataStatus = 200;
    await tasks.read();
    expect(calls.filter((c) => c.path === "/project")).toHaveLength(2);
  });

  it("says plainly when the token is rejected, without ever repeating it", async () => {
    const { fetchImpl } = api({ "GET /project": () => new Response("", { status: 401 }) });
    const error = await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).read().catch((e: Error) => e);
    expect(String(error)).toMatch(/rejected the API token/);
    expect(String(error)).not.toContain(TOKEN);
  });
});

describe("TickTickTasks writes", () => {
  it("creates a task in the configured list", async () => {
    const { calls, fetchImpl } = api({
      "GET /project": json(projects),
      "POST /task": json(task({ id: "new", title: "Buy milk" })),
    });
    await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).create("  Buy milk  ");
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/task", body: { title: "Buy milk", projectId: "todo1" } });
  });

  it("completes a task through its project", async () => {
    const { calls, fetchImpl } = api({ "POST /project/todo1/task/a/complete": () => new Response("", { status: 200 }) });
    await new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).complete("todo1", "a");
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/project/todo1/task/a/complete" });
  });

  it("reports a failed completion", async () => {
    const { fetchImpl } = api({ "POST /project/todo1/task/a/complete": () => new Response("", { status: 500 }) });
    await expect(new TickTickTasks(TOKEN, "🏡To-Do", TZ, fetchImpl).complete("todo1", "a")).rejects.toThrow(/500/);
  });
});
