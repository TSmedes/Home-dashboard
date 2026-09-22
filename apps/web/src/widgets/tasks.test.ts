import { describe, expect, it } from "vitest";
import type { TaskItem } from "@home-dash/shared";
import { assigneeLabel, dueLabel, groupTasks } from "./tasks.js";

const LA = "America/Los_Angeles";
// Monday 21 September 2026, noon in Los Angeles.
const NOW = new Date("2026-09-21T19:00:00Z");

const task = (over: Partial<TaskItem>): TaskItem => ({
  id: "t",
  projectId: "p",
  title: "Task",
  dueAllDay: false,
  priority: 0,
  assignee: null,
  assigneeId: null,
  tags: [],
  ...over,
});

describe("dueLabel", () => {
  it("returns nothing for an undated task", () => {
    expect(dueLabel(task({}), NOW, LA, "12h")).toBeNull();
  });

  it("flags an all-day task due before today as overdue", () => {
    expect(dueLabel(task({ dueDate: "2026-09-20", dueAllDay: true }), NOW, LA, "12h")).toEqual({
      text: "Overdue",
      tone: "overdue",
    });
  });

  it("flags a timed task whose time has passed as overdue", () => {
    expect(dueLabel(task({ dueDate: "2026-09-21T16:00:00.000Z" }), NOW, LA, "12h")?.tone).toBe("overdue");
  });

  it("calls an all-day task due today 'Today'", () => {
    expect(dueLabel(task({ dueDate: "2026-09-21", dueAllDay: true }), NOW, LA, "12h")).toEqual({
      text: "Today",
      tone: "today",
    });
  });

  it("shows the time for a timed task later today", () => {
    expect(dueLabel(task({ dueDate: "2026-09-21T22:30:00.000Z" }), NOW, LA, "12h")).toEqual({
      text: "3:30 pm",
      tone: "today",
    });
  });

  it("uses the dashboard's timezone to decide what 'today' is", () => {
    // 05:00Z on the 22nd is still 22:00 on Monday the 21st in Los Angeles.
    expect(dueLabel(task({ dueDate: "2026-09-22T05:00:00.000Z" }), NOW, LA, "12h")?.tone).toBe("today");
  });

  it("says Tomorrow, then the weekday this week, then the date", () => {
    const label = (dueDate: string) => dueLabel(task({ dueDate, dueAllDay: true }), NOW, LA, "12h")?.text;
    expect(label("2026-09-22")).toBe("Tomorrow");
    expect(label("2026-09-24")).toBe("Thu");
    expect(label("2026-10-05")).toBe("Oct 5");
  });

  it("respects a 24-hour clock", () => {
    expect(dueLabel(task({ dueDate: "2026-09-21T22:30:00.000Z" }), NOW, LA, "24h")?.text).toBe("15:30");
  });
});

describe("assigneeLabel", () => {
  it("uses the first name from the display name", () => {
    expect(assigneeLabel(task({ assignee: "Alex Smith" }))).toBe("Alex");
  });

  it("uses the part before the @ when only an email is known", () => {
    expect(assigneeLabel(task({ assignee: "former@example.com" }))).toBe("former");
  });

  it("returns nothing for an unassigned task", () => {
    expect(assigneeLabel(task({}))).toBeNull();
  });
});

describe("groupTasks", () => {
  it("splits tasks into overdue, today, upcoming and undated, dropping empty groups", () => {
    const groups = groupTasks(
      [
        task({ id: "later", dueDate: "2026-09-25", dueAllDay: true }),
        task({ id: "none" }),
        task({ id: "late", dueDate: "2026-09-19", dueAllDay: true }),
        task({ id: "soon", dueDate: "2026-09-22", dueAllDay: true }),
        task({ id: "now", dueDate: "2026-09-21T22:00:00Z" }),
      ],
      NOW,
      LA,
    );
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ["Overdue", ["late"]],
      ["Today", ["now"]],
      ["Upcoming", ["soon", "later"]],
      ["No date", ["none"]],
    ]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupTasks([], NOW, LA)).toEqual([]);
  });
});
