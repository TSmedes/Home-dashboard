/**
 * Talking to the dashboard's own server.
 *
 * Errors come back as `{ error }` with a sentence in them - "commute: at most
 * 5 destinations", not "400" - so they are worth unwrapping once here and
 * showing to whoever is standing at the wall.
 */
export async function send(method: string, url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `the server returned ${response.status}`);
  return payload;
}

/** The message from a thrown error, ready to put on screen. */
export const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
