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
  if (!task.assignee) return null;
  if (task.assignee.includes("@")) return task.assignee.split("@")[0] ?? task.assignee;
  return task.assignee.trim().split(/\s+/)[0] ?? task.assignee;
}
