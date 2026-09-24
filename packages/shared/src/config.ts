import { z } from "zod";

/** 24-hour wall-clock time, e.g. "06:30". Profile windows may cross midnight. */
export const TimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be a 24-hour HH:MM time, e.g. 06:30");

export const GRID_COLUMNS = 12;

export const GridPlacementSchema = z
  .object({
    /** Required unless `share` is set; a shared widget is placed by its order. */
    col: z.number().int().min(1).max(GRID_COLUMNS).optional(),
    row: z.number().int().min(1),
    colSpan: z.number().int().min(1).max(GRID_COLUMNS).default(1),
    rowSpan: z.number().int().min(1).default(1),
    /**
     * Share these rows with the other shared widgets on them: whichever are
     * switched on split the full width evenly, so turning one off never
     * leaves a gap.
     */
    share: z.boolean().default(false),
    /**
     * Share a column with the other widgets naming the same stack: whichever
     * are showing split their combined rectangle top to bottom, so one being
     * switched off - or hiding itself, as bin day does between collections -
     * gives its space to the rest instead of leaving a hole.
     */
    stack: z.string().min(1).optional(),
  })
  .refine((g) => g.share || g.col !== undefined, { message: "col is required unless share is true" })
  .refine((g) => g.col === undefined || g.col + g.colSpan - 1 <= GRID_COLUMNS, {
    message: `widget overflows the ${GRID_COLUMNS}-column grid`,
  });

/**
 * A widget placed on a profile. `type` is matched against the client-side
 * widget registry at render time rather than here, so adding a widget never
 * means editing this schema.
 */
export const WidgetInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().optional(),
  /** Switched off in settings. Keeps its place, so switching back on restores it. */
  enabled: z.boolean().default(true),
  /**
   * Which page of the profile it sits on. Pages sit side by side in order of
   * this number and are changed by swiping; each has its own grid.
   */
  page: z.number().int().min(1).default(1),
  grid: GridPlacementSchema,
  options: z.record(z.string(), z.unknown()).default({}),
});

export const ProfileSchema = z.object({
  schedule: z.object({ from: TimeOfDaySchema, to: TimeOfDaySchema }),
  theme: z.enum(["light", "dark"]),
  /**
   * Seconds without a touch before a swiped-away screen slides back to the
   * first page, so the wall never sits on page three all afternoon. 0 = never.
   */
  returnToFirstPage: z.number().int().min(0).default(120),
  widgets: z
    .array(WidgetInstanceSchema)
    .refine(
      (widgets) => new Set(widgets.map((w) => w.id)).size === widgets.length,
      { message: "duplicate widget id within a profile" },
    ),
});

export const LocationSchema = z.object({
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** IANA zone, e.g. America/Los_Angeles. Drives the clock and the profile scheduler. */
  timezone: z.string().min(1),
});

export const UnitsSchema = z.object({
  temperature: z.enum(["fahrenheit", "celsius"]),
  wind: z.enum(["mph", "kmh", "ms", "kn"]),
  clock: z.enum(["12h", "24h"]),
});

/**
 * Assignee names come from the list's members in TickTick itself, so there is
 * nothing to maintain here. To show one person's tasks, give a tasks widget an
 * `assignee` option instead of filtering the whole dashboard.
 */
export const TickTickSchema = z.object({
  /** Tasks are read from, and created in, this list. */
  listName: z.string().min(1).default("🏡To-Do"),
});

export const LightSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Reserved LAN address. Discovery by broadcast does not work from a container. */
  host: z.string().min(1),
  /**
   * Which of TP-Link's protocols the bulb speaks: kasa for the Kasa range
   * (KL135 and friends), tapo for Tapo bulbs, which need the TP-Link account
   * password in .env.
   */
  type: z.enum(["kasa", "tapo"]).default("kasa"),
  /** Hidden from the dashboard, and not polled. */
  hidden: z.boolean().default(false),
});

/**
 * Which calendars appear is not configured here: it is whichever secret iCal
 * addresses are in CALENDAR_ICAL_URLS, because each address is a credential.
 */
export const CalendarSchema = z.object({
  /**
   * How many days ahead the feed is fetched. The expanded month grid needs this
   * to reach the end of next month, so its arrows never land on a month drawn
   * with empty cells that would read as free days.
   */
  daysAhead: z.number().int().min(1).max(62).default(62),
});

const DateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date written YYYY-MM-DD");

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** One bin collection, repeating on a weekday every `every` weeks. */
export const BinSchema = z.object({
  name: z.string().min(1),
  day: z.enum(WEEKDAYS),
  /** Weeks between pickups. */
  every: z.number().int().min(1).max(8).default(1),
  /**
   * Any date the bin was (or will be) collected. Needed when `every` is more
   * than 1, to know which weeks are the pickup weeks.
   */
  anchor: DateKeySchema.optional(),
  /** Holiday shifts: collections that move to another date. */
  moved: z.array(z.object({ from: DateKeySchema, to: DateKeySchema })).default([]),
  /** Collections that simply don't happen. */
  skip: z.array(DateKeySchema).default([]),
})
  .refine((bin) => bin.every === 1 || bin.anchor !== undefined, {
    message: "anchor is required when every is more than 1",
  });

export const CountdownSchema = z.object({
  name: z.string().min(1),
  date: DateKeySchema,
  emoji: z.string().optional(),
});

export const CountdownsSchema = z.object({
  /** Calendar events whose title contains this appear as countdowns too. The tag is dropped from the name. */
  calendarTag: z.string().min(1).default("#countdown"),
  /** How far ahead tagged calendar events are looked for. */
  daysAhead: z.number().int().min(1).max(730).default(365),
  items: z.array(CountdownSchema).default([]),
});

/** An NWS location id as shown on water.noaa.gov, e.g. SQUW1. Case does not matter. */
export const GaugeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{3,8}$/, "must be an NWS gauge id from water.noaa.gov, e.g. SQUW1")
  .transform((id) => id.toUpperCase());

/**
 * River gauges from NOAA's National Water Prediction Service. These are the
 * gauges a river widget shows when it names none of its own in
 * `options.gauges`; every gauge any widget names is fetched.
 */
export const RiverSchema = z.object({
  gauges: z.array(GaugeIdSchema).min(1).max(8).default(["SQUW1"]),
});

/** Which gauges a river widget shows: its own `options.gauges`, else the config-wide list. */
export function riverGaugesFor(options: Record<string, unknown>, fallback: string[]): string[] {
  const parsed = z.array(GaugeIdSchema).min(1).safeParse(options.gauges);
  return parsed.success ? [...new Set(parsed.data)] : fallback;
}

export const CommuteDestinationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

/** Drive times from `location` to each destination, with live traffic. */
export const CommuteSchema = z.object({
  destinations: z
    .array(CommuteDestinationSchema)
    .max(5)
    .default([])
    .refine((d) => new Set(d.map((x) => x.id)).size === d.length, { message: "duplicate destination id" }),
});

/** A filesystem to watch, by its mount point on the host, e.g. /mnt/media. */
export const SystemDiskSchema = z.object({
  path: z.string().regex(/^\//, "must be an absolute mount point, e.g. /mnt/media"),
  name: z.string().min(1),
});

/**
 * The machine the dashboard runs on. In Docker, the host is mounted read-only
 * and HOST_ROOT / HOST_PROC / HOST_SYS in .env point at it, so these paths are
 * always written as the host sees them.
 */
export const SystemSchema = z.object({
  /** Shown instead of the host's own name. */
  name: z.string().min(1).optional(),
  disks: z.array(SystemDiskSchema).min(1).max(8).default([{ path: "/", name: "System" }]),
  /** Network interface to show, e.g. eth0. Defaults to the one carrying the default route. */
  interface: z.string().min(1).optional(),
  /** Temperatures, in °C, at which a sensor reads as warm and then hot. */
  tempWarn: z.number().min(20).max(150).default(75),
  tempCrit: z.number().min(20).max(150).default(90),
});

/** A URL checked for an answer, e.g. a web UI on the homelab. */
export const ServiceCheckSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  /** The status that counts as up. Defaults to any 2xx or 3xx. */
  expectStatus: z.number().int().min(100).max(599).optional(),
});

export const ServicesSchema = z.object({
  docker: z
    .object({
      /** List the host's containers. Needs the Docker socket mounted; see README. */
      enabled: z.boolean().default(true),
      /** Only these container names. Empty means all of them. */
      include: z.array(z.string().min(1)).default([]),
      /** Never these container names. */
      exclude: z.array(z.string().min(1)).default([]),
    })
    .default({}),
  checks: z
    .array(ServiceCheckSchema)
    .max(20)
    .default([])
    .refine((c) => new Set(c.map((x) => x.id)).size === c.length, { message: "duplicate check id" }),
});

/**
 * Pi-hole, read through its v6 API. The password is a credential, so it lives
 * in .env as PIHOLE_PASSWORD; only the address is here.
 */
export const PiholeSchema = z.object({
  /** Base address of the web interface, e.g. http://10.0.0.2. */
  url: z.string().url().optional(),
});

export const ServerSchema = z.object({
  port: z.number().int().min(1).max(65535).default(8080),
});

/** Poll intervals in seconds, per data source. */
export const RefreshSchema = z.object({
  weather: z.number().int().min(60).default(900),
  calendar: z.number().int().min(30).default(300),
  tasks: z.number().int().min(30).default(120),
  lights: z.number().int().min(5).default(30),
  river: z.number().int().min(300).default(900),
  countdowns: z.number().int().min(300).default(3600),
  /** TomTom's free tier allows 2,500 requests a day across every destination. */
  commute: z.number().int().min(120).default(600),
  spotify: z.number().int().min(3).default(10),
  system: z.number().int().min(5).default(10),
  services: z.number().int().min(10).default(30),
  pihole: z.number().int().min(10).default(60),
});

export const DashboardConfigSchema = z.object({
  location: LocationSchema,
  units: UnitsSchema,
  server: ServerSchema.default({}),
  refresh: RefreshSchema.default({}),
  calendar: CalendarSchema.default({}),
  ticktick: TickTickSchema.default({}),
  lights: z.array(LightSchema).default([]),
  bins: z.array(BinSchema).default([]),
  countdowns: CountdownsSchema.default({}),
  river: RiverSchema.default({}),
  commute: CommuteSchema.default({}),
  system: SystemSchema.default({}),
  services: ServicesSchema.default({}),
  pihole: PiholeSchema.default({}),
  profiles: z
    .record(z.string(), ProfileSchema)
    .refine((p) => Object.keys(p).length > 0, { message: "at least one profile is required" }),
});

export type GridPlacement = z.infer<typeof GridPlacementSchema>;
export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type Units = z.infer<typeof UnitsSchema>;
export type LightConfig = z.infer<typeof LightSchema>;
export type BinConfig = z.infer<typeof BinSchema>;
export type CountdownConfig = z.infer<typeof CountdownSchema>;
export type CommuteDestination = z.infer<typeof CommuteDestinationSchema>;
export type SystemDiskConfig = z.infer<typeof SystemDiskSchema>;
export type ServiceCheck = z.infer<typeof ServiceCheckSchema>;
export type PiholeConfig = z.infer<typeof PiholeSchema>;
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;
export type ProfileName = string;
