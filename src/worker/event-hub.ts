import type { EventPayload } from "./types";
import { SESSION_TTL_SECONDS } from "./auth";

type SocketSession = { sessionHash: string; expiresAt: number };
const REVOCATION_PREFIX = "revoked-session:";
const validSessionHash = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export class EventHub implements DurableObject {
  constructor(private readonly state: DurableObjectState) {
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const sessionHash = request.headers.get("x-cloudpit-session-hash");
      const expiresAt = Number(request.headers.get("x-cloudpit-session-expires"));
      if (sessionHash) {
        if (!validSessionHash(sessionHash) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() / 1_000) return new Response("Session expired", { status: 401 });
        // Default storage input/output gates keep this check ordered with logout
        // and prevent confirming a revocation before it is durable. No cache in
        // instance memory: hibernation/restarts must retain the same boundary.
        const revokedUntil = await this.state.storage.get<number>(REVOCATION_PREFIX + sessionHash);
        if (revokedUntil && revokedUntil > Date.now() / 1_000) return new Response("Session ended", { status: 401 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      if (sessionHash) {
        server.serializeAttachment({ sessionHash, expiresAt } satisfies SocketSession);
      }
      this.state.acceptWebSocket(server);
      await this.expireSockets();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === "POST" && url.pathname === "/revoke") {
      const { sessionHash, expiresAt } = await request.json() as { sessionHash?: unknown; expiresAt?: unknown };
      if (!validSessionHash(sessionHash) || (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || Number(expiresAt) < 0))) return new Response("Invalid session", { status: 400 });
      const now = Math.floor(Date.now() / 1_000);
      // Older Workers omit expiresAt. Preserve their revocation for a full TTL;
      // matching attachments can only extend the deadline, never shorten it.
      let revokedUntil = typeof expiresAt === "number" && expiresAt > now ? expiresAt : now + SESSION_TTL_SECONDS;
      for (const socket of this.state.getWebSockets()) {
        const session = this.session(socket);
        if (session?.sessionHash === sessionHash) revokedUntil = Math.max(revokedUntil, session.expiresAt);
      }
      await this.state.storage.transaction(async (storage) => {
        const key = REVOCATION_PREFIX + sessionHash;
        const previous = await storage.get<number>(key);
        await storage.put(key, Math.max(previous ?? 0, revokedUntil));
      });
      for (const socket of this.state.getWebSockets()) {
        const session = this.session(socket);
        if (session?.sessionHash === sessionHash) {
          socket.serializeAttachment({ ...session, expiresAt: 0 });
          socket.close(1008, "Session ended");
        }
      }
      await this.expireSockets();
      return Response.json({ revoked: true });
    }
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = (await request.json()) as EventPayload;
      await this.broadcast(event);
      return Response.json({ delivered: this.state.getWebSockets().length });
    }
    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const session = this.session(_socket);
    if (session) {
      const revokedUntil = await this.state.storage.get<number>(REVOCATION_PREFIX + session.sessionHash);
      if (session.expiresAt <= Date.now() / 1_000 || (revokedUntil && revokedUntil > Date.now() / 1_000)) { _socket.close(1008, "Session ended"); return; }
    }
    if (message === "ping") _socket.send("pong");
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, "WebSocket error");
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  private async broadcast(event: EventPayload): Promise<void> {
    const payload = JSON.stringify(event);
    const revocations = await this.state.storage.list<number>({ prefix: REVOCATION_PREFIX });
    for (const socket of this.state.getWebSockets()) {
      const session = this.session(socket);
      if (session && session.expiresAt <= Date.now() / 1_000) { socket.close(1008, "Session expired"); continue; }
      if (session && (revocations.get(REVOCATION_PREFIX + session.sessionHash) ?? 0) > Date.now() / 1_000) { socket.close(1008, "Session ended"); continue; }
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "Broadcast failed");
      }
    }
  }

  async alarm(): Promise<void> {
    await this.expireSockets();
  }

  private session(socket: WebSocket): SocketSession | null {
    return socket.deserializeAttachment() as SocketSession | null;
  }

  private async expireSockets(): Promise<void> {
    const now = Math.floor(Date.now() / 1_000);
    // Cleanup and deadline selection share one storage transaction. A repeated
    // logout cannot race cleanup into deleting a still-valid revocation.
    const revocations = await this.state.storage.transaction(async (storage) => {
      const entries = await storage.list<number>({ prefix: REVOCATION_PREFIX });
      for (const [key, expiresAt] of entries) {
        if (expiresAt <= now) { await storage.delete(key); entries.delete(key); }
      }
      return entries;
    });
    let nextExpiry = Infinity;
    for (const socket of this.state.getWebSockets()) {
      const session = this.session(socket);
      if (!session) continue; // Existing Basic-auth machine connections.
      if (session.expiresAt <= now) socket.close(1008, "Session expired");
      else if ((revocations.get(REVOCATION_PREFIX + session.sessionHash) ?? 0) > now) socket.close(1008, "Session ended");
      else nextExpiry = Math.min(nextExpiry, session.expiresAt * 1_000);
    }
    for (const expiresAt of revocations.values()) nextExpiry = Math.min(nextExpiry, expiresAt * 1_000);
    if (Number.isFinite(nextExpiry)) {
      const scheduled = await this.state.storage.getAlarm();
      if (scheduled === null || nextExpiry < scheduled) await this.state.storage.setAlarm(nextExpiry);
    }
  }
}

export async function broadcastEvent(
  namespace: DurableObjectNamespace,
  event: EventPayload,
  locationHint: DurableObjectLocationHint
): Promise<void> {
  const hub = namespace.getByName("global", { locationHint });
  const response = await hub.fetch("https://events.internal/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event)
  });
  if (!response.ok) throw new Error(`Event broadcast failed with ${response.status}`);
}
