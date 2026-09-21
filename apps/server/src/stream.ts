import type { FastifyReply } from "fastify";
import type { StreamEvent } from "@home-dash/shared";

/**
 * Fan-out for server-sent events.
 *
 * One connection carries every update - widget data, profile switches, config
 * reloads - rather than each widget polling on its own. On an old iPad that is
 * the difference between one socket and a dozen timers, and it gives the client
 * a single thing to re-establish when the tablet wakes up.
 */
export class StreamHub {
  readonly #clients = new Set<FastifyReply>();
  #heartbeat: NodeJS.Timeout | null = null;

  add(reply: FastifyReply): () => void {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // Tell the browser to wait 3s before reconnecting a dropped stream.
    reply.raw.write("retry: 3000\n\n");
    this.#clients.add(reply);
    this.#ensureHeartbeat();

    const remove = () => {
      this.#clients.delete(reply);
      if (this.#clients.size === 0) this.#stopHeartbeat();
    };
    reply.raw.on("close", remove);
    reply.raw.on("error", remove);
    return remove;
  }

  send(reply: FastifyReply, event: StreamEvent): void {
    reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  broadcast(event: StreamEvent): void {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.#clients) {
      try {
        client.raw.write(frame);
      } catch {
        this.#clients.delete(client);
      }
    }
  }

  get size(): number {
    return this.#clients.size;
  }

  close(): void {
    this.#stopHeartbeat();
    for (const client of this.#clients) client.raw.end();
    this.#clients.clear();
  }

  /**
   * Keeps the connection alive while idle overnight, and gives the client
   * something observable to time out on. A comment frame would do the first job
   * but EventSource never surfaces comments to JavaScript, so a woken iPad
   * could sit on a dead socket indefinitely without noticing.
   */
  #ensureHeartbeat(): void {
    if (this.#heartbeat) return;
    this.#heartbeat = setInterval(() => {
      this.broadcast({ type: "ping", at: new Date().toISOString() });
    }, 20_000);
    this.#heartbeat.unref?.();
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }
}
