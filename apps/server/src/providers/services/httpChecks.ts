import type { ServiceCheck, ServiceCheckResult } from "@home-dash/shared";

/**
 * Whether each listed URL answers. A check that fails is a result, not an
 * error: the widget's job is to show which service is down, so one dead
 * service must never fail the whole refresh.
 */

const TIMEOUT_MS = 5000;

export async function runCheck(
  check: ServiceCheck,
  fetcher: typeof fetch = fetch,
  now: () => number = performance.now.bind(performance),
): Promise<ServiceCheckResult> {
  const base = { id: check.id, name: check.name, url: check.url };
  const started = now();
  try {
    const res = await fetcher(check.url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
    const latencyMs = Math.round(now() - started);
    // Draining the body lets the connection be reused and closed cleanly.
    await res.arrayBuffer().catch(() => undefined);
    const ok = check.expectStatus !== undefined ? res.status === check.expectStatus : res.status < 400;
    return { ...base, ok, status: res.status, latencyMs, error: ok ? null : `answered ${res.status}` };
  } catch (err) {
    return { ...base, ok: false, status: null, latencyMs: null, error: reason(err) };
  }
}

function reason(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "no answer in 5 s";
    // Node wraps the socket error, and when it tried several addresses the
    // errors sit one level further down, in an AggregateError.
    const cause = err.cause as (NodeJS.ErrnoException & { errors?: NodeJS.ErrnoException[] }) | undefined;
    const code = cause?.code ?? cause?.errors?.[0]?.code;
    if (code === "ECONNREFUSED") return "connection refused";
    if (code === "ENOTFOUND") return "host not found";
    if (code === "EHOSTUNREACH") return "host unreachable";
    // "fetch failed" says nothing; the cause usually does.
    return cause?.message || err.message;
  }
  return String(err);
}

export function runChecks(checks: ServiceCheck[], fetcher: typeof fetch = fetch): Promise<ServiceCheckResult[]> {
  return Promise.all(checks.map((check) => runCheck(check, fetcher)));
}
