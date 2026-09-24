/**
 * Which built page answers a URL the static files do not. The frontend is
 * three pages - the chooser at "/", the wall at /kiosk/, the phone app at
 * /lights/ - and a path under either app is that app's to route.
 */
export type WebEntry = "api" | "index.html" | "kiosk/index.html" | "lights/index.html";

export function entryFor(url: string): WebEntry {
  const path = url.split(/[?#]/, 1)[0]!;
  if (path === "/api" || path.startsWith("/api/")) return "api";
  for (const app of ["kiosk", "lights"] as const) {
    if (path === `/${app}` || path.startsWith(`/${app}/`)) return `${app}/index.html`;
  }
  return "index.html";
}
