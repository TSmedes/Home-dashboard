import type { DashboardConfig } from "@home-dash/shared";
import type { Env } from "../../env.js";
import { TickTickTasks } from "./ticktick.js";

/** Null when no token is set, so the widget shows a setup prompt instead of failing. */
export function createTickTick(config: DashboardConfig, env: Env): TickTickTasks | null {
  if (!env.TICKTICK_API_TOKEN) return null;
  return new TickTickTasks(env.TICKTICK_API_TOKEN, config.ticktick.listName, config.location.timezone);
}

export { TickTickTasks } from "./ticktick.js";
