import type { EventPayload } from "./types";

type SocketSession = { sessionHash: string; expiresAt: number };

export class EventHub implements DurableObject {
  constructor(private readonly state: DurableObjectState) {
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const sessionHash = request.headers.get("x-cloudpit-session-hash");
      const expiresAt = Number(request.headers.get("x-cloudpit-session-expires"));
      if (sessionHash) {
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() / 1_000) return new Response("Session expired", { status: 401 });
        server.serializeAttachment({ sessionHash, expiresAt } satisfies SocketSession);
      }
      this.state.acceptWebSocket(server);
      await this.expireSockets();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === "POST" && url.pathname === "/revoke") {
      const { sessionHash } = await request.json() as { sessionHash?: string };
      if (!sessionHash) return new Response("Invalid session", { status: 400 });
      for (const socket of this.state.getWebSockets()) {
        const session = this.session(socket);
        if (session?.sessionHash === sessionHash) {
          socket.serializeAttachment({ ...session, expiresAt: 0 });
          socket.close(1008, "Session ended");
        }
      }
      return Response.json({ revoked: true });
    }
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = (await request.json()) as EventPayload;
      this.broadcast(event);
      return Response.json({ delivered: this.state.getWebSockets().length });
    }
    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer): void {
    const session = this.session(_socket);
    if (session && session.expiresAt <= Date.now() / 1_000) { _socket.close(1008, "Session expired"); return; }
    if (message === "ping") _socket.send("pong");
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, "WebSocket error");
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  private broadcast(event: EventPayload): void {
    const payload = JSON.stringify(event);
    for (const socket of this.state.getWebSockets()) {
      const session = this.session(socket);
      if (session && session.expiresAt <= Date.now() / 1_000) { socket.close(1008, "Session expired"); continue; }
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
    let nextExpiry = Infinity;
    for (const socket of this.state.getWebSockets()) {
      const session = this.session(socket);
      if (!session) continue; // Existing Basic-auth machine connections.
      if (session.expiresAt <= Date.now() / 1_000) socket.close(1008, "Session expired");
      else nextExpiry = Math.min(nextExpiry, session.expiresAt * 1_000);
    }
    if (Number.isFinite(nextExpiry)) await this.state.storage.setAlarm(nextExpiry);
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
