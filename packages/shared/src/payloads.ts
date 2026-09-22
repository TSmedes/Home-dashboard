/**
 * Wire shapes shared by server and client. The server produces these; widgets
 * consume them. Keeping them here means a provider change that alters a shape
 * breaks the client at compile time rather than at 6am on the wall.
 */

/**
 * Every widget's data arrives wrapped in this. `stale` is the core of the
 * resilience story: a failed refresh keeps serving the last good `data` with
 * `stale: true`, so one dead API degrades one tile instead of blanking it.
 */
export interface WidgetEnvelope<T> {
  key: string;
  data: T | null;
  /** ISO timestamp of the last *successful* fetch, or null if never. */
  fetchedAt: string | null;
  stale: boolean;
  error: { message: string; at: string } | null;
}

export interface WeatherNow {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  precipitation: number;
  isDay: boolean;
  /** WMO weather interpretation code. */
  code: number;
  /** 0-11+, to one decimal. */
  uvIndex: number;
}

export interface WeatherHour {
  time: string;
  temperature: number;
  precipitationProbability: number;
  code: number;
  /** Rain in the hour, in `units.precipitation`. */
  precipitation: number;
  humidity: number;
  windSpeed: number;
  uvIndex: number;
}

export interface WeatherDay {
  date: string;
  min: number;
  max: number;
  precipitationProbability: number;
  code: number;
  sunrise: string;
  sunset: string;
  /** Total for the day, in `units.precipitation`. */
  precipitationSum: number;
  windSpeedMax: number;
  /** Where the wind mostly comes from, in degrees. */
  windDirection: number;
  uvIndexMax: number;
}

export interface WeatherSnapshot {
  now: WeatherNow;
  hourly: WeatherHour[];
  daily: WeatherDay[];
  units: { temperature: string; wind: string; precipitation: string };
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  /** ISO datetime, or YYYY-MM-DD when allDay. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  colour?: string;
}

export interface CalendarSnapshot {
  events: CalendarEvent[];
  /** One per feed. `id` is safe to display; it never contains the secret address. */
  calendars: { id: string; name: string }[];
}

export interface TaskItem {
  id: string;
  projectId: string;
  title: string;
  /** The task's notes in TickTick. Absent when it has none. */
  notes?: string;
  /** ISO instant, or YYYY-MM-DD when `dueAllDay`. Absent when undated. */
  dueDate?: string;
  dueAllDay: boolean;
  /** TickTick's scale: none 0, low 1, medium 3, high 5. */
  priority: 0 | 1 | 3 | 5;
  /** The assigned member's display name, or null when unassigned. */
  assignee: string | null;
  /** The assigned member's TickTick username - what a widget filter matches on. */
  assigneeId: string | null;
  tags: string[];
}

export interface TaskMember {
  username: string;
  displayName: string;
  /** Whether this member is the account the API token belongs to. */
  self: boolean;
}

export interface TasksSnapshot {
  listName: string;
  projectId: string;
  tasks: TaskItem[];
  members: TaskMember[];
  /** False when the list's members could not be read, e.g. an unshared list. */
  assigneesAvailable: boolean;
}

export interface LightState {
  id: string;
  name: string;
  reachable: boolean;
  on: boolean;
  /** 1-100. */
  brightness: number;
  /** Kelvin; 0 when the bulb is in colour mode. */
  colourTemp: number;
  hue: number;
  saturation: number;
}

export interface LightsSnapshot {
  lights: LightState[];
}

export type FloodCategory = "none" | "action" | "minor" | "moderate" | "major";

/** One reading, in whichever unit the gauge's flood thresholds use. */
export interface RiverPoint {
  time: string;
  value: number;
}

/** Every gauge any river widget shows. A widget picks its own out by id. */
export interface RiverSnapshot {
  gauges: RiverGauge[];
  /** Gauges that could not be read this time, with the reason. */
  failed: { gauge: string; message: string }[];
}

export interface RiverGauge {
  /** NWS location id, upper case, e.g. SQUW1. */
  gauge: string;
  name: string;
  /** Which measure the flood thresholds, and therefore this snapshot, are in. */
  measure: "flow" | "stage";
  /** "cfs" for flow, "ft" for stage. */
  unit: string;
  /** Latest observation, or null when the gauge has not reported. */
  current: RiverPoint | null;
  /** Change over the last 6 hours of observations, in `unit`. */
  change6h: number | null;
  category: FloodCategory;
  /** Thresholds that exist for this gauge, in `unit`. */
  thresholds: Partial<Record<Exclude<FloodCategory, "none">, number>>;
  /** Highest forecast value, when the gauge is forecast. */
  forecastPeak: RiverPoint | null;
  /** Observations over the last 48 hours, oldest first. */
  observed: RiverPoint[];
  /** Forecast values, oldest first. */
  forecast: RiverPoint[];
}

export interface Countdown {
  id: string;
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  emoji?: string;
  source: "config" | "calendar";
}

export interface CountdownsSnapshot {
  countdowns: Countdown[];
}

export interface CommuteRoute {
  id: string;
  name: string;
  /** Door to door with current traffic. */
  travelSeconds: number;
  /** How much of that is traffic, compared with an empty road. */
  delaySeconds: number;
  lengthMeters: number;
  /** ISO instant of arrival if leaving when this was fetched. */
  arrival: string;
}

export interface CommuteSnapshot {
  routes: CommuteRoute[];
  /** Destinations that could not be routed, by id, with the reason. */
  failed: { id: string; name: string; message: string }[];
}

export interface SpotifyTrack {
  title: string;
  /** Artists joined, e.g. "Khruangbin, Leon Bridges"; the show for a podcast. */
  artist: string;
  album: string;
  /** Largest album image, or null. */
  artwork: string | null;
  durationMs: number;
}

export interface SpotifySnapshot {
  /**
   * Why nothing can be shown, when that is the account's doing rather than a
   * network blip. `premium-required`: Spotify only serves developer apps whose
   * owner has Premium. `reconnect`: the sign-in was revoked or has expired.
   */
  problem: "premium-required" | "reconnect" | null;
  /** From GET /me. Controls only work on "premium". */
  product: string | null;
  playing: boolean;
  track: SpotifyTrack | null;
  /** Progress when fetched; the client advances it while playing. */
  progressMs: number;
  device: string | null;
}

/** The machine the dashboard runs on, read from /proc and /sys. */
export interface SystemSnapshot {
  hostname: string;
  uptimeSeconds: number;
  cpu: {
    /** Percent busy across every core since the previous sample, 0-100. */
    usage: number;
    cores: number;
    /** 1, 5 and 15 minute load averages. */
    load: [number, number, number];
    /** Recent `usage` samples, oldest first. */
    history: number[];
  };
  /** Bytes. `used` is what applications hold: total less available. */
  memory: {
    total: number;
    used: number;
    available: number;
    swapTotal: number;
    swapUsed: number;
    /** Recent used percentages, oldest first. */
    history: number[];
  };
  /** One per sensor, hottest first. */
  temps: SystemTemp[];
  disks: SystemDisk[];
  /** Null when no interface could be found. */
  network: SystemNetwork | null;
  /** ISO instant the sample was taken. */
  sampledAt: string;
}

export interface SystemTemp {
  label: string;
  celsius: number;
}

export interface SystemDisk {
  path: string;
  name: string;
  /** Bytes. Null when the mount could not be read. */
  total: number | null;
  used: number | null;
  free: number | null;
}

export interface SystemNetwork {
  iface: string;
  /** Bytes per second since the previous sample. */
  rxBps: number;
  txBps: number;
  rxHistory: number[];
  txHistory: number[];
}

export type ContainerHealth = "healthy" | "unhealthy" | "starting" | null;

/** A port the container publishes on the host, so it can be reached. */
export interface ContainerPort {
  /** The port on the Docker host, which is the one you type. */
  host: number;
  container: number;
  /** "tcp" or "udp"; udp is worth saying out loud, tcp is assumed. */
  protocol: string;
}

export interface ContainerStatus {
  name: string;
  image: string;
  /** Docker's state: running, exited, restarting, paused, created, dead. */
  state: string;
  /** Docker's own phrase, e.g. "Up 3 days (healthy)". */
  status: string;
  health: ContainerHealth;
  /** Published ports, lowest first. Empty when nothing is published. */
  ports: ContainerPort[];
  /** com.docker.compose.project, which groups a stack's containers together. */
  project: string | null;
}

export interface ServiceCheckResult {
  id: string;
  name: string;
  url: string;
  ok: boolean;
  /** HTTP status, when there was an answer. */
  status: number | null;
  latencyMs: number | null;
  error: string | null;
}

export interface ServicesSnapshot {
  /** Null when Docker is switched off or could not be reached. */
  containers: ContainerStatus[] | null;
  /** Why Docker could not be read, when it is switched on. */
  dockerError: string | null;
  checks: ServiceCheckResult[];
}

/** A path into config.yaml. `{ id }` picks the list item with that id. */
export type PathSegment = string | number | { id: string };

/** One targeted edit, as sent to PATCH /api/config. */
export interface ConfigChange {
  path: PathSegment[];
  /** null removes the key, returning that setting to its default. */
  value: unknown;
  /**
   * "insert" puts `value` before the list position the path ends at, instead
   * of replacing what is there. Without it a list can only be rewritten whole,
   * which costs every comment inside it - and the widget list is where the
   * comments explaining the dashboard live.
   */
  op?: "insert";
}

/** A place from the settings location search. */
export interface Place {
  /** Short name saved as the dashboard's location, e.g. "Snoqualmie, Washington". */
  label: string;
  /** Extra line to tell same-named places apart, e.g. "United States". */
  detail: string;
  lat: number;
  lon: number;
  /** IANA zone, e.g. America/Los_Angeles. */
  timezone: string;
}

/** A manual switch of profile, lasting until the next scheduled switch. */
export interface ProfileOverride {
  profile: string;
  /** ISO instant when the schedule takes over again. */
  until: string;
}

/** Server-sent events pushed over the single /api/stream connection. */
export type StreamEvent =
  | { type: "widget-data"; key: string; envelope: WidgetEnvelope<unknown> }
  | { type: "profile-changed"; profile: string; override: ProfileOverride | null }
  | { type: "config-changed" }
  | { type: "hello"; profile: string; override: ProfileOverride | null; serverTime: string }
  | { type: "ping"; at: string };
