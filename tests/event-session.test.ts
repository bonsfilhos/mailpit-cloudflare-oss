import { afterEach, expect, test, vi } from "vitest";
import { EventHub } from "../src/worker/event-hub";
import { SESSION_TTL_SECONDS } from "../src/worker/auth";

const expiredHash = "A".repeat(43);
const currentHash = "B".repeat(43);
const otherHash = "C".repeat(43);
const revocationKey = (hash: string) => "revoked-session:" + hash;

function fixture() {
  const now = Date.now();
  function socket(sessionHash: string, expiresAt: number) {
    let attachment = { sessionHash, expiresAt };
    return { deserializeAttachment: () => attachment, serializeAttachment: (value: typeof attachment) => { attachment = value; }, close: vi.fn(), send: vi.fn() };
  }
  const expired = socket(expiredHash, Math.floor(now / 1000) - 1);
  const current = socket(currentHash, Math.floor(now / 1000) + 20);
  const other = socket(otherHash, Math.floor(now / 1000) + 40);
  const machine = { deserializeAttachment: () => null, close: vi.fn(), send: vi.fn() };
  const persisted = new Map<string, number>();
  let alarmAt: number | null = null;
  const setAlarm = vi.fn(async (deadline: number) => { alarmAt = deadline; });
  const storage = {
    get: async (key: string) => persisted.get(key),
    put: async (key: string, value: number) => { persisted.set(key, value); },
    delete: async (key: string) => persisted.delete(key),
    list: async ({ prefix }: { prefix: string }) => new Map([...persisted].filter(([key]) => key.startsWith(prefix))),
    getAlarm: async () => alarmAt,
    setAlarm,
    transaction: async <T>(callback: (storage: DurableObjectTransaction) => Promise<T>) => callback(storage as unknown as DurableObjectTransaction),
  };
  vi.stubGlobal("WebSocketRequestResponsePair", class {});
  const state = { setWebSocketAutoResponse: vi.fn(), getWebSockets: () => [expired, current, other, machine], storage } as unknown as DurableObjectState;
  return { hub: new EventHub(state), state, expired, current, other, machine, setAlarm, persisted, fireAlarm: async () => { alarmAt = null; await new EventHub(state).alarm(); } };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function revoke(hub: EventHub, hash: string, expiresAt?: number) {
  return hub.fetch(new Request("https://events.internal/revoke", {
    method: "POST", body: JSON.stringify({ sessionHash: hash, expiresAt }),
  }));
}

function handshake(hub: EventHub, hash: string, expiresAt: number) {
  return hub.fetch(new Request("https://events.internal/api/events", { headers: {
    Upgrade: "websocket", "x-cloudpit-session-hash": hash, "x-cloudpit-session-expires": String(expiresAt),
  } }));
}

function broadcast(hub: EventHub) {
  return hub.fetch(new Request("https://events.internal/broadcast", {
    method: "POST", body: JSON.stringify({ Type: "new", Data: { Subject: "Synthetic future email" } }),
  }));
}

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
  const expiresAt = f.current.deserializeAttachment().expiresAt;
  const response = await revoke(f.hub, currentHash, expiresAt);
  expect(response.status).toBe(200);
  expect(f.current.close).toHaveBeenCalledWith(1008, "Session ended");
  expect(f.other.close).not.toHaveBeenCalled();
  expect(f.machine.close).not.toHaveBeenCalled();
  await f.hub.fetch(new Request("https://events.internal/broadcast", { method: "POST", body: JSON.stringify({ Type: "new" }) }));
  expect(f.current.send).not.toHaveBeenCalled();
  expect(f.other.send).toHaveBeenCalledOnce();
  expect(f.persisted.get(revocationKey(currentHash))).toBe(expiresAt);
});

test("logout rejects a delayed authenticated handshake, including after hibernation/restart", async () => {
  const f = fixture();
  const expiresAt = f.current.deserializeAttachment().expiresAt;
  await revoke(f.hub, currentHash, expiresAt);
  expect((await handshake(f.hub, currentHash, expiresAt)).status).toBe(401);
  // Recreating the object has no in-memory revocation cache to carry forward.
  const reloaded = new EventHub(f.state);
  expect((await handshake(reloaded, currentHash, expiresAt)).status).toBe(401);
  // Even a rehydrated attachment carrying its pre-logout deadline stays private.
  f.current.serializeAttachment({ sessionHash: currentHash, expiresAt });
  await broadcast(reloaded);
  expect(f.current.send).not.toHaveBeenCalled();
  expect(f.other.send).toHaveBeenCalledOnce();
  expect(f.machine.send).toHaveBeenCalledOnce();
});

test("cleanup retains current revocations and removes each only at its original deadline", async () => {
  const f = fixture();
  vi.useFakeTimers();
  const firstExpiry = f.current.deserializeAttachment().expiresAt;
  const secondExpiry = f.other.deserializeAttachment().expiresAt;
  await revoke(f.hub, currentHash, firstExpiry);
  await revoke(f.hub, otherHash, secondExpiry);
  expect(f.setAlarm).toHaveBeenLastCalledWith(firstExpiry * 1000);
  vi.setSystemTime(firstExpiry * 1000);
  await f.fireAlarm();
  expect(f.persisted.has(revocationKey(currentHash))).toBe(false);
  expect(f.persisted.get(revocationKey(otherHash))).toBe(secondExpiry);
  expect((await handshake(new EventHub(f.state), otherHash, secondExpiry)).status).toBe(401);
  expect((await handshake(new EventHub(f.state), currentHash, firstExpiry)).status).toBe(401);
  expect(f.setAlarm).toHaveBeenLastCalledWith(secondExpiry * 1000);
  vi.setSystemTime(secondExpiry * 1000);
  await f.fireAlarm();
  expect(f.persisted.size).toBe(0);
});

test("legacy revocation without a deadline lasts a full TTL; repeated revocation cannot shorten it", async () => {
  const f = fixture();
  const expected = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await revoke(f.hub, currentHash);
  await revoke(f.hub, currentHash, expected - 10);
  expect(f.persisted.get(revocationKey(currentHash))).toBe(expected);
  await f.fireAlarm();
  expect(f.persisted.get(revocationKey(currentHash))).toBe(expected);
  expect((await handshake(new EventHub(f.state), currentHash, expected)).status).toBe(401);
});

test("invalid revocation metadata never writes persistent storage", async () => {
  const f = fixture();
  expect((await revoke(f.hub, "invalid-hash", Date.now())).status).toBe(400);
  expect((await revoke(f.hub, currentHash, -1)).status).toBe(400);
  expect(f.persisted.size).toBe(0);
});
