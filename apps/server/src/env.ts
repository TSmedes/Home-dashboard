import { z } from "zod";

/**
 * Secrets and deployment knobs live here; user preferences live in config.yaml.
 * The split matters: config.yaml is meant to be readable, diffable and editable
 * from the settings UI, so nothing secret may ever be written into it.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  HOST: z.string().default("0.0.0.0"),
  CONFIG_PATH: z.string().default("./config/config.yaml"),
  DATA_DIR: z.string().default("./data"),

  /**
   * Comma-separated secret iCal addresses, one per calendar. Each is a
   * credential in its own right - it grants read access to the calendar - so
   * it lives here rather than in config.yaml.
   */
  CALENDAR_ICAL_URLS: z.string().optional(),

  /**
   * Personal API token (TickTick > Settings > Account > API Token). It can read
   * and change the whole account, so it never leaves the server and is never
   * put into an error message or log line.
   */
  TICKTICK_API_TOKEN: z.string().optional(),

  /**
   * TomTom API key for the commute widget (developer.tomtom.com, free tier).
   * Sent in every routing URL, so it is scrubbed from errors.
   */
  TOMTOM_API_KEY: z.string().optional(),

  /**
   * Client id of a Spotify developer app. Public by design: sign-in uses PKCE,
   * so there is no client secret. The tokens themselves live in the database.
   */
  SPOTIFY_CLIENT_ID: z.string().optional(),

  KASA_USERNAME: z.string().optional(),
  KASA_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Environment is not valid:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
