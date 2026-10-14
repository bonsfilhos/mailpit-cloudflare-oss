import { afterEach, describe, expect, test, vi } from "vitest";
import worker from "../src/worker/index";
import { createSession, getSession, SESSION_COOKIE, SESSION_TTL_SECONDS, validReturnPath, type BrowserSession } from "../src/worker/auth";
import type { Env } from "../src/worker/types";

const origin = "https://cloudpit.test";
const username = "synthetic-operator";
const password = "synthetic-only-test-password";

function fixture() {
  const sessions = new Map<string, BrowserSession>();
  const eventRequests: Request[] = [];
  const database = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async run() {
          if (sql.startsWith("INSERT INTO browser_sessions")) {
            sessions.set(String(args[0]), { token_hash: String(args[0]), csrf_token: String(args[1]), expires_at: Number(args[2]) });
          } else if (sql.includes("WHERE token_hash = ?")) sessions.delete(String(args[0]));
          else if (sql.includes("WHERE expires_at <= ?")) {
            for (const session of sessions.values()) if (session.expires_at <= Number(args[0])) sessions.delete(session.token_hash);
          } else throw new Error(`Unexpected test write: ${sql}`);
          return { success: true };
        },
        async first() {
          if (sql.startsWith("SELECT token_hash")) {
            const session = sessions.get(String(args[0]));
            return session && session.expires_at > Number(args[1]) ? session : null;
          }
          if (sql === "SELECT 1") return { "1": 1 };
          if (sql === "SELECT * FROM messages WHERE id = ?") return null;
          throw new Error(`Unexpected test read: ${sql}`);
        }
      };
    }
  };
  const env = {
    AUTH_REQUIRED: "true", BASIC_AUTH_USERNAME: username, BASIC_AUTH_PASSWORD: password,
    DB: database,
    ASSETS: { fetch: async () => new Response("<html>Private inbox</html>", { headers: { "content-type": "text/html" } }) },
    EVENTS: { getByName: () => ({ fetch: async (input: Request | string, init?: RequestInit) => {
      eventRequests.push(input instanceof Request ? input : new Request(input, init));
      return Response.json({ ok: true });
    } }) }
  } as unknown as Env;
  const request = (path: string, init: RequestInit = {}) => worker.fetch!(new Request(origin + path, init), env, { waitUntil() {} } as unknown as ExecutionContext) as Promise<Response>;
  return { env, sessions, eventRequests, request };
}

function browserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", ...extra };
}

async function login(f: ReturnType<typeof fixture>, options: { password?: string; returnPath?: string; origin?: string; csrf?: string; cookie?: string } = {}) {
  const page = await f.request(`/login?return=${encodeURIComponent(options.returnPath ?? "/")}`);
  const html = await page.text();
  const cookie = options.cookie ?? page.headers.get("set-cookie")!.split(";")[0]!;
  const csrf = options.csrf ?? html.match(/name="csrf" value="([^"]+)"/)![1]!;
  const form = new URLSearchParams({ username, password: options.password ?? password, csrf, return: options.returnPath ?? "/" });
  const response = await f.request("/login", { method: "POST", headers: {
    ...browserHeaders(), origin: options.origin ?? origin, cookie, "content-type": "application/x-www-form-urlencoded"
  }, body: form });
  const sessionCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`))?.split(";")[0];
  return { page, response, cookie: sessionCookie ?? "", csrf };
}

afterEach(() => vi.useRealTimers());

describe("browser login boundary", () => {
  test("uses the configured inbox identity with HTML escaping", async () => {
    const f = fixture();
    f.env.INBOX_LABEL = 'Preview <img src=x onerror="unsafe">';
    const html = await (await f.request("/login")).text();
    expect(html).toContain("Preview &lt;img src=x onerror=&quot;unsafe&quot;&gt;");
    expect(html).not.toContain('<img src=x onerror="unsafe">');
  });
  test("navigation goes to a conventional password-manager form without a Basic prompt", async () => {
    const f = fixture();
    const response = await f.request("/search?q=preview", { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?return=%2Fsearch%3Fq%3Dpreview");
    expect(response.headers.has("www-authenticate")).toBe(false);
    const page = await f.request("/login");
    const html = await page.text();
    expect(html).toContain('method="post" action="/login"');
    expect(html).toContain('for="username"');
    expect(html).toContain('name="username" type="text" autocomplete="username"');
    expect(html).toContain('name="password" type="password" autocomplete="current-password"');
    expect(html).not.toContain(password);
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    expect(page.headers.get("referrer-policy")).toBe("same-origin");
    expect(page.headers.get("content-security-policy")).toContain("form-action 'self'");
  });

  test("successful native POST creates an opaque protected cookie and returns internally", async () => {
    const f = fixture();
    const { response, cookie } = await login(f, { returnPath: "/search?q=preview" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/search?q=preview");
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`))!;
    expect(setCookie).toContain("Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200");
    expect(setCookie).not.toContain("Domain=");
    expect(setCookie).not.toContain(password);
    expect(setCookie).not.toContain(username);
    expect(f.sessions.size).toBe(1);
    const rawToken = cookie.split("=")[1]!.split(".")[0]!;
    expect([...f.sessions.values()][0]!.token_hash).not.toBe(rawToken);
    const inbox = await f.request("/", { headers: browserHeaders({ cookie }) });
    expect(inbox.status).toBe(200);
    expect(await inbox.text()).toContain("Private inbox");
  });

  test("invalid credentials remain on the form and never reflect the password", async () => {
    const f = fixture();
    const { response } = await login(f, { password: "invalid-synthetic" });
    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain("Usuário ou senha incorretos.");
    expect(html).not.toContain("invalid-synthetic");
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect(f.sessions.size).toBe(0);
  });

  test.each(["https://other.test", "null"])("rejects login Origin %s", async (badOrigin) => {
    const f = fixture();
    const { response } = await login(f, { origin: badOrigin });
    expect(response.status).toBe(403);
    expect(f.sessions.size).toBe(0);
  });

  test("rejects absent Origin, forged CSRF and an unrelated prelogin cookie", async () => {
    const f = fixture();
    const missing = await f.request("/login", { method: "POST", body: "username=synthetic" });
    expect(missing.status).toBe(403);
    expect((await login(f, { csrf: "forged" })).response.status).toBe(403);
    expect((await login(f, { cookie: "__Host-cloudpit_login=forged" })).response.status).toBe(403);
    expect(f.sessions.size).toBe(0);
  });

  test("expired prelogin cookie and duplicate fields fail before password authentication", async () => {
    const f = fixture();
    vi.useFakeTimers();
    const page = await f.request("/login");
    const html = await page.text();
    const csrf = html.match(/name="csrf" value="([^"]+)"/)![1]!;
    const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    const response = await f.request("/login", { method: "POST", headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password, csrf, return: "/" }) });
    expect(response.status).toBe(403);
    const duplicate = await f.request("/login", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: `username=a&username=b&password=c&csrf=d&return=%2F` });
    expect(duplicate.status).toBe(403);
    expect(f.sessions.size).toBe(0);
  });

  test.each(["https://outside.test/", "//outside.test", "/\\outside.test", "/%2f%2foutside.test", "/%5coutside.test", "/login", "/a/../logout", "/auth/session", "/\n//outside.test"])("cannot redirect to %s", async (candidate) => {
    const f = fixture();
    expect(validReturnPath(candidate, origin)).toBe("/");
    expect((await login(f, { returnPath: candidate })).response.headers.get("location")).toBe("/");
  });

  test("tampered, expired, duplicate or password-rotation cookies cannot access APIs", async () => {
    const f = fixture();
    const { cookie } = await login(f);
    const value = cookie.split("=")[1]!;
    const tampered = `${SESSION_COOKIE}=${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
    expect((await f.request("/api/v1/", { headers: browserHeaders({ cookie: tampered }) })).status).toBe(401);
    expect((await f.request("/api/v1/", { headers: browserHeaders({ cookie: `${cookie}; ${cookie}` }) })).status).toBe(401);
    const session = [...f.sessions.values()][0]!;
    expect(await getSession(new Request(origin, { headers: { cookie } }), f.env, session.expires_at * 1000)).toBeNull();
    f.env.BASIC_AUTH_PASSWORD = "rotated-synthetic";
    expect((await f.request("/api/v1/", { headers: browserHeaders({ cookie }) })).status).toBe(401);
    expect(SESSION_TTL_SECONDS).toBe(43200);
  });

  test("logout revokes the stored session, clears cookie and disconnects matching events", async () => {
    const f = fixture();
    const { cookie } = await login(f);
    const csrf = [...f.sessions.values()][0]!.csrf_token;
    const denied = await f.request("/logout", { method: "POST", headers: { origin: "https://outside.test", cookie }, body: new URLSearchParams({ csrf }) });
    expect(denied.status).toBe(403);
    expect(f.sessions.size).toBe(1);
    const badToken = await f.request("/logout", { method: "POST", headers: { origin, cookie }, body: new URLSearchParams({ csrf: "forged" }) });
    expect(badToken.status).toBe(403);
    const response = await f.request("/logout", { method: "POST", headers: { origin, cookie }, body: new URLSearchParams({ csrf }) });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(f.sessions.size).toBe(0);
    expect(f.eventRequests[0]!.url).toBe("https://events.internal/revoke");
    expect((await f.request("/api/v1/", { headers: browserHeaders({ cookie }) })).status).toBe(401);
  });
});

describe("API and event parity", () => {
  test("Basic remains usable by machines but cannot bypass browser CSRF", async () => {
    const f = fixture();
    const authorization = `Basic ${btoa(`${username}:${password}`)}`;
    expect((await f.request("/api/v1/", { headers: { authorization } })).status).toBe(200);
    expect((await f.request("/api/v1/chaos", { method: "PUT", headers: { authorization } })).status).toBe(501);
    const browser = await f.request("/api/v1/chaos", { method: "PUT", headers: browserHeaders({ authorization, origin }) });
    expect(browser.status).toBe(401);
    expect(browser.headers.has("www-authenticate")).toBe(false);
    expect((await f.request("/api/v1/", { headers: { authorization: "Basic invalid" } })).status).toBe(401);
  });

  test("cookie mutations and detail GET require the session CSRF boundary", async () => {
    const f = fixture();
    const { cookie } = await login(f);
    const csrf = [...f.sessions.values()][0]!.csrf_token;
    expect((await f.request("/api/v1/chaos", { method: "PUT", headers: { origin, cookie } })).status).toBe(403);
    expect((await f.request("/api/v1/chaos", { method: "PUT", headers: { origin: "https://outside.test", cookie, "x-cloudpit-csrf": csrf } })).status).toBe(403);
    expect((await f.request("/api/v1/chaos", { method: "PUT", headers: { origin, cookie, "x-cloudpit-csrf": csrf } })).status).toBe(501);
    expect((await f.request("/api/v1/message/not-found", { headers: browserHeaders({ cookie }) })).status).toBe(403);
    expect((await f.request("/api/v1/message/not-found", { headers: browserHeaders({ cookie, "x-cloudpit-csrf": csrf }) })).status).toBe(404);
    expect((await f.request("/api/v1/message/not-found", { method: "HEAD", headers: browserHeaders({ cookie }) })).status).toBe(403);
  });

  test("unauthenticated event/message/attachment routes stay private; authenticated event metadata is server supplied", async () => {
    const f = fixture();
    for (const path of ["/api/events", "/api/v1/message/x", "/api/v1/message/x/raw", "/api/v1/message/x/part/1", "/auth/session"]) {
      expect((await f.request(path, { headers: browserHeaders() })).status).toBe(401);
    }
    const { cookie } = await login(f);
    expect((await f.request("/api/events", { headers: { cookie, origin: "https://outside.test" } })).status).toBe(403);
    const response = await f.request("/api/events", { headers: { cookie, origin, "x-cloudpit-session-hash": "forged", "x-cloudpit-session-expires": "9999999999" } });
    expect(response.status).toBe(200);
    const forwarded = f.eventRequests[0]!;
    expect(forwarded.headers.get("x-cloudpit-session-hash")).toBe([...f.sessions.values()][0]!.token_hash);
    expect(forwarded.headers.get("x-cloudpit-session-expires")).toBe(String([...f.sessions.values()][0]!.expires_at));
    const sessionResponse = await f.request("/auth/session", { headers: browserHeaders({ cookie }) });
    expect(await sessionResponse.json()).toMatchObject({ enabled: true, csrf: [...f.sessions.values()][0]!.csrf_token });
  });

  test("health and bearer ingestion keep their independent boundaries, and missing credentials fail closed", async () => {
    const f = fixture();
    expect((await f.request("/health")).status).toBe(200);
    const session = await createSession(f.env);
    expect((await f.request("/api/v1/send", { method: "POST", headers: { cookie: session.setCookie.split(";")[0]! }, body: "{}" })).status).toBe(401);
    delete f.env.BASIC_AUTH_PASSWORD;
    expect((await f.request("/login")).status).toBe(503);
    expect((await f.request("/api/v1/")).status).toBe(503);
    expect((await f.request("/health")).status).toBe(200);
  });
});
