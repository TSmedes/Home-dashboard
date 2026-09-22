import type { TaskItem } from "@home-dash/shared";
import { clockTime, dateKey, daysBetween, noonOf } from "../lib/zoned.js";

export type DueTone = "overdue" | "today" | "later";

export interface DueLabel {
  text: string;
  tone: DueTone;
}

/**
 * A short, glanceable due label. Overdue and due-today are called out, because
 * those are the tasks worth noticing while walking past; anything later is
 * just a day name or a date.
 */
export function dueLabel(task: TaskItem, now: Date, timezone: string, clock: "12h" | "24h"): DueLabel | null {
  if (!task.dueDate) return null;
  const today = dateKey(now, timezone);

  let key: string;
  if (task.dueAllDay) {
    key = task.dueDate;
    if (key < today) return { text: "Overdue", tone: "overdue" };
  } else {
    const at = new Date(task.dueDate);
    if (at.getTime() <= now.getTime()) return { text: "Overdue", tone: "overdue" };
    key = dateKey(at, timezone);
    if (key === today) {
      const { time, meridiem } = clockTime(at, timezone, clock);
      return { text: meridiem ? `${time} ${meridiem}` : time, tone: "today" };
    }
  }

  const days = daysBetween(today, key);
  if (days === 0) return { text: "Today", tone: "today" };
  if (days === 1) return { text: "Tomorrow", tone: "later" };
  const date = noonOf(key);
  if (days < 7) {
    return { text: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date), tone: "later" };
  }
  return {
    text: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date),
    tone: "later",
  };
}

/**
 * A first name rather than initials: two people in one household often share
 * an initial, and there is room on the line for a short name.
 */
export function assigneeLabel(task: TaskItem): string | null {
  return task.assignee ? firstName(task.assignee) : null;
}

/** "Toby" from "Toby Smedes", or from "toby@example.com" when only an email is known. */
export function firstName(name: string): string {
  if (name.includes("@")) return name.split("@")[0] ?? name;
  return name.trim().split(/\s+/)[0] ?? name;
}

export interface TaskGroup {
  key: "overdue" | "today" | "upcoming" | "undated";
  label: string;
  tasks: TaskItem[];
}

/**
 * Tasks in the order they need doing: overdue, due today, upcoming by date,
 * then anything undated. Groups with nothing in them are left out.
 */
export function groupTasks(tasks: TaskItem[], now: Date, timezone: string): TaskGroup[] {
  const groups: TaskGroup[] = [
    { key: "overdue", label: "Overdue", tasks: [] },
    { key: "today", label: "Today", tasks: [] },
    { key: "upcoming", label: "Upcoming", tasks: [] },
    { key: "undated", label: "No date", tasks: [] },
  ];
  const [overdue, today, upcoming, undated] = groups as [TaskGroup, TaskGroup, TaskGroup, TaskGroup];

  for (const task of tasks) {
    const due = dueLabel(task, now, timezone, "24h");
    if (!due) undated.tasks.push(task);
    else if (due.tone === "overdue") overdue.tasks.push(task);
    else if (due.tone === "today") today.tasks.push(task);
    else upcoming.tasks.push(task);
  }
  // An all-day date parses as UTC midnight, early enough to sort before that day's timed tasks.
  upcoming.tasks.sort((a, b) => Date.parse(a.dueDate!) - Date.parse(b.dueDate!));

  return groups.filter((group) => group.tasks.length > 0);
}
