import { BinDayWidget } from "./BinDayWidget.js";
import { binsDueSoon } from "./binDay.js";
import { CalendarWidget } from "./CalendarWidget.js";
import { ClockWidget } from "./ClockWidget.js";
import { CommuteWidget } from "./CommuteWidget.js";
import { CountdownsWidget } from "./CountdownsWidget.js";
import { CpuWidget } from "./CpuWidget.js";
import { CalendarDetail } from "./detail/CalendarDetail.js";
import { CommuteDetail } from "./detail/CommuteDetail.js";
import { CountdownsDetail } from "./detail/CountdownsDetail.js";
import { LightsDetail } from "./detail/LightsDetail.js";
import { PiholeDetail } from "./detail/PiholeDetail.js";
import { RiverDetail } from "./detail/RiverDetail.js";
import { ServicesDetail } from "./detail/ServicesDetail.js";
import { SunMoonDetail } from "./detail/SunMoonDetail.js";
import { SystemDetail } from "./detail/SystemDetail.js";
import { TasksDetail } from "./detail/TasksDetail.js";
import { WeatherDetail } from "./detail/WeatherDetail.js";
import { DisksWidget } from "./DisksWidget.js";
import { LightsWidget } from "./LightsWidget.js";
import { NetworkWidget } from "./NetworkWidget.js";
import { PiholeWidget } from "./PiholeWidget.js";
import { RiverWidget } from "./RiverWidget.js";
import { ServicesWidget } from "./ServicesWidget.js";
import { SpotifyWidget } from "./SpotifyWidget.js";
import { SunMoonWidget } from "./SunMoonWidget.js";
import { TasksWidget } from "./TasksWidget.js";
import { TempsWidget } from "./TempsWidget.js";
import { WeatherWidget } from "./WeatherWidget.js";
import type { TasksSnapshot } from "@home-dash/shared";
import { BinsEditor } from "../edit/editors/BinsEditor.js";
import { CommuteEditor } from "../edit/editors/CommuteEditor.js";
import { CountdownsEditor } from "../edit/editors/CountdownsEditor.js";
import type { OptionSpec } from "../edit/options.js";
import type { OptionContext, WidgetDefinition } from "./types.js";

/** The host stats widgets all read one source, which only exists on Linux. */
const SYSTEM_HINT = "Reads the Linux server it runs on; see README: Homelab monitoring.";

/**
 * Who a tasks widget can be narrowed to.
 *
 * The choices come from the tasks on the list rather than from its members,
 * because a task carries both the id the widget matches on and the name worth
 * showing, and the members list carries only the name.
 */
function assigneeOption({ envelope }: OptionContext): OptionSpec[] {
  const tasks = (envelope?.data as TasksSnapshot | undefined)?.tasks ?? [];
  const people = new Map<string, string>();
  for (const task of tasks) {
    if (task.assigneeId && task.assignee) people.set(task.assigneeId, task.assignee);
  }
  if (people.size === 0) return [];

  return [
    {
      key: "assignee",
      kind: "enum",
      label: "Whose tasks",
      detail: "Everyone's, or just one person's.",
      default: "",
      choices: [
        { value: "", label: "Everyone" },
        ...[...people].map(([id, name]) => ({ value: id, label: name })),
      ],
    },
  ];
}

/**
 * Every widget the dashboard knows how to draw.
 *
 * A `detail` view makes the tile open full screen when tapped. Clock, bin day
 * and Spotify say all they have to say on the tile, so they have none.
 *
 * Adding one is a new file plus an entry here - nothing else in the client
 * changes, and the server only needs a matching source in its own registry if
 * the widget reads remote data.
 */
export const widgetRegistry: Record<string, WidgetDefinition> = {
  clock: {
    type: "clock",
    component: ClockWidget as WidgetDefinition["component"],
    chrome: true,
    options: [
      {
        key: "size",
        kind: "enum",
        label: "Size",
        detail: "Extra large is the night treatment: the clock fills the screen.",
        default: "default",
        choices: [
          { value: "default", label: "Normal" },
          { value: "xl", label: "Extra large" },
        ],
      },
      { key: "showSeconds", kind: "boolean", label: "Show seconds", default: false },
      { key: "showDate", kind: "boolean", label: "Show the date", default: true },
    ],
  },
  weather: {
    type: "weather",
    component: WeatherWidget as WidgetDefinition["component"],
    detail: WeatherDetail as WidgetDefinition["detail"],
    dataKey: "weather",
    chrome: true,
    options: [
      {
        key: "hours",
        kind: "number",
        label: "Hours ahead",
        detail: "How far the hourly strip reaches.",
        default: 8,
        min: 3,
        max: 24,
      },
      { key: "compact", kind: "boolean", label: "Compact", detail: "Drops the hourly strip.", default: false },
    ],
  },
  calendar: {
    type: "calendar",
    component: CalendarWidget as WidgetDefinition["component"],
    detail: CalendarDetail as WidgetDefinition["detail"],
    dataKey: "calendar",
    chrome: true,
    // Capped at what the feed is actually fetched for, so the tile cannot be
    // asked for days it has no events for and would draw as free.
    options: ({ config }) => [
      {
        key: "days",
        kind: "number",
        label: "Days listed",
        detail: "Anything further off goes under Later, filling whatever room is left.",
        default: 3,
        min: 1,
        max: config.calendar.daysAhead,
      },
    ],
  },
  tasks: {
    type: "tasks",
    component: TasksWidget as WidgetDefinition["component"],
    detail: TasksDetail as WidgetDefinition["detail"],
    dataKey: "tasks",
    chrome: true,
    options: (context) => [
      ...assigneeOption(context),
      {
        key: "readOnly",
        kind: "boolean",
        label: "Read only",
        detail: "Hides the add-a-task box. Ticking a task still works.",
        default: false,
      },
    ],
  },
  lights: {
    type: "lights",
    component: LightsWidget as WidgetDefinition["component"],
    detail: LightsDetail as WidgetDefinition["detail"],
    dataKey: "lights",
    chrome: true,
  },
  sunmoon: {
    type: "sunmoon",
    component: SunMoonWidget as WidgetDefinition["component"],
    detail: SunMoonDetail as WidgetDefinition["detail"],
    chrome: true,
  },
  bins: {
    type: "bins",
    component: BinDayWidget as WidgetDefinition["component"],
    chrome: true,
    // A bin reminder is worth the wall the day before and the day itself, and
    // is clutter the rest of the week.
    relevant: ({ config, now }) => binsDueSoon(config.bins, now, config.location.timezone),
    configEditor: BinsEditor,
  },
  countdowns: {
    type: "countdowns",
    component: CountdownsWidget as WidgetDefinition["component"],
    detail: CountdownsDetail as WidgetDefinition["detail"],
    dataKey: "countdowns",
    chrome: true,
    configEditor: CountdownsEditor,
    options: [
      {
        key: "limit",
        kind: "number",
        label: "How many to show",
        detail: "The tile shows the next few; tapping it lists them all.",
        default: 1,
        min: 1,
        max: 6,
      },
    ],
  },
  river: {
    type: "river",
    component: RiverWidget as WidgetDefinition["component"],
    detail: RiverDetail as WidgetDefinition["detail"],
    dataKey: "river",
    chrome: true,
  },
  commute: {
    type: "commute",
    component: CommuteWidget as WidgetDefinition["component"],
    detail: CommuteDetail as WidgetDefinition["detail"],
    dataKey: "commute",
    chrome: true,
    setupHint: "Add TOMTOM_API_KEY to .env, then add where you drive to in this widget's settings.",
    configEditor: CommuteEditor,
  },
  spotify: {
    type: "spotify",
    component: SpotifyWidget as WidgetDefinition["component"],
    dataKey: "spotify",
    chrome: true,
    setupHint: "Add SPOTIFY_CLIENT_ID to .env, then choose Connect Spotify in Settings.",
  },
  cpu: {
    type: "cpu",
    component: CpuWidget as WidgetDefinition["component"],
    detail: SystemDetail as WidgetDefinition["detail"],
    detailTitle: "Server",
    dataKey: "system",
    chrome: true,
    setupHint: SYSTEM_HINT,
  },
  temps: {
    type: "temps",
    component: TempsWidget as WidgetDefinition["component"],
    detail: SystemDetail as WidgetDefinition["detail"],
    detailTitle: "Server",
    dataKey: "system",
    chrome: true,
    setupHint: SYSTEM_HINT,
    options: [
      { key: "limit", kind: "number", label: "Sensors shown", detail: "Hottest first.", default: 6, min: 1, max: 20 },
    ],
  },
  disks: {
    type: "disks",
    component: DisksWidget as WidgetDefinition["component"],
    detail: SystemDetail as WidgetDefinition["detail"],
    detailTitle: "Server",
    dataKey: "system",
    chrome: true,
    setupHint: SYSTEM_HINT,
  },
  network: {
    type: "network",
    component: NetworkWidget as WidgetDefinition["component"],
    detail: SystemDetail as WidgetDefinition["detail"],
    detailTitle: "Server",
    dataKey: "system",
    chrome: true,
    setupHint: SYSTEM_HINT,
  },
  services: {
    type: "services",
    component: ServicesWidget as WidgetDefinition["component"],
    detail: ServicesDetail as WidgetDefinition["detail"],
    dataKey: "services",
    chrome: true,
    setupHint: "Mount the Docker socket (see README: Homelab monitoring) or add URLs under services.checks in config.yaml.",
  },
  pihole: {
    type: "pihole",
    component: PiholeWidget as WidgetDefinition["component"],
    detail: PiholeDetail as WidgetDefinition["detail"],
    dataKey: "pihole",
    chrome: true,
    setupHint: "Set pihole.url in config.yaml and PIHOLE_PASSWORD in .env.",
  },
};

export function widgetFor(type: string): WidgetDefinition | undefined {
  return widgetRegistry[type];
}
