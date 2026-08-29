import type { EventPayload } from "./types";

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
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = (await request.json()) as EventPayload;
      this.broadcast(event);
      return Response.json({ delivered: this.state.getWebSockets().length });
    }
    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer): void {
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
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "Broadcast failed");
      }
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
