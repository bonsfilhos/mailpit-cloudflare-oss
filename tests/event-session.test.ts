import { afterEach, expect, test, vi } from "vitest";
import { EventHub } from "../src/worker/event-hub";

function fixture() {
  const now = Date.now();
  function socket(sessionHash: string, expiresAt: number) {
    let attachment = { sessionHash, expiresAt };
    return { deserializeAttachment: () => attachment, serializeAttachment: (value: typeof attachment) => { attachment = value; }, close: vi.fn(), send: vi.fn() };
  }
  const expired = socket("expired", Math.floor(now / 1000) - 1);
  const current = socket("current", Math.floor(now / 1000) + 20);
  const other = socket("other", Math.floor(now / 1000) + 40);
  const machine = { deserializeAttachment: () => null, close: vi.fn(), send: vi.fn() };
  const setAlarm = vi.fn();
  vi.stubGlobal("WebSocketRequestResponsePair", class {});
  const state = { setWebSocketAutoResponse: vi.fn(), getWebSockets: () => [expired, current, other, machine], storage: { setAlarm } } as unknown as DurableObjectState;
  return { hub: new EventHub(state), expired, current, other, machine, setAlarm };
}

afterEach(() => vi.unstubAllGlobals());

test("expired event connections close without receiving a private broadcast", async () => {
  const f = fixture();
  await f.hub.fetch(new Request("https://events.internal/broadcast", { method: "POST", body: JSON.stringify({ Type: "new", Data: { ID: "synthetic" } }) }));
  expect(f.expired.close).toHaveBeenCalledWith(1008, "Session expired");
  expect(f.expired.send).not.toHaveBeenCalled();
  expect(f.current.send).toHaveBeenCalledOnce();
  expect(f.machine.send).toHaveBeenCalledOnce();
  await f.hub.alarm();
  expect(f.setAlarm).toHaveBeenCalledWith(f.current.deserializeAttachment().expiresAt * 1000);
});

test("logout revokes only its session, including future broadcasts while the socket closes", async () => {
  const f = fixture();
  const response = await f.hub.fetch(new Request("https://events.internal/revoke", { method: "POST", body: JSON.stringify({ sessionHash: "current" }) }));
  expect(response.status).toBe(200);
  expect(f.current.close).toHaveBeenCalledWith(1008, "Session ended");
  expect(f.other.close).not.toHaveBeenCalled();
  expect(f.machine.close).not.toHaveBeenCalled();
  await f.hub.fetch(new Request("https://events.internal/broadcast", { method: "POST", body: JSON.stringify({ Type: "new" }) }));
  expect(f.current.send).not.toHaveBeenCalled();
  expect(f.other.send).toHaveBeenCalledOnce();
});
