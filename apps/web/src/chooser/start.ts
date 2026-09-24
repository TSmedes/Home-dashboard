/**
 * Which app a device opens at "/". The wall iPad's Home Screen icon points at
 * "/", so once it has been told "always the dashboard" it should never stop on
 * the chooser again - but anyone must be able to get back with /?choose.
 */

export const START_KEY = "home-dash:start";

/** The apps "/" can send a device to. Anything else in storage is ignored. */
export const APPS = ["/kiosk/", "/lights/"] as const;
export type AppPath = (typeof APPS)[number];

/** Storage can be missing or throw (private browsing, blocked site data). */
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined;

const isApp = (value: unknown): value is AppPath => APPS.includes(value as AppPath);

/** Where to go instead of showing the chooser, or null to show it. */
export function savedStart(storage: Store, search: string): AppPath | null {
  if (new URLSearchParams(search).has("choose")) return null;
  try {
    const saved = storage?.getItem(START_KEY);
    return isApp(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Remember a choice, or forget it with null. Best effort: a failure just means the chooser shows next time. */
export function rememberStart(storage: Store, path: AppPath | null): void {
  try {
    if (path) storage?.setItem(START_KEY, path);
    else storage?.removeItem(START_KEY);
  } catch {
    // Nothing to do; the chooser still works.
  }
}

/** Storage when the browser will give it to us. */
export function localStore(): Store {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
