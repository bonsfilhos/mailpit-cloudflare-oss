import type { Env } from "./types";

export const SESSION_COOKIE = "__Host-cloudpit_session";
const LOGIN_COOKIE = "__Host-cloudpit_login";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const LOGIN_TTL_SECONDS = 10 * 60;
const encoder = new TextEncoder();

export type BrowserSession = { token_hash: string; csrf_token: string; expires_at: number };

export function timingSafeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return mismatch === 0;
}

export function credentialsConfigured(env: Env): boolean {
  return Boolean(env.BASIC_AUTH_USERNAME && env.BASIC_AUTH_PASSWORD);
}

export function validCredentials(username: string, password: string, env: Env): boolean {
  if (!credentialsConfigured(env)) return false;
  const usernameMatches = timingSafeEqual(username, env.BASIC_AUTH_USERNAME!);
  const passwordMatches = timingSafeEqual(password, env.BASIC_AUTH_PASSWORD!);
  return usernameMatches && passwordMatches;
}

export function hasBasicAuth(request: Request, env: Env): boolean {
  const encoded = request.headers.get("authorization")?.match(/^Basic\s+(.+)$/i)?.[1];
  if (!encoded || encoded.length > 16_384) return false;
  try {
    const decoded = atob(encoded);
    const separator = decoded.indexOf(":");
    return separator >= 0 && validCredentials(decoded.slice(0, separator), decoded.slice(separator + 1), env);
  } catch {
    return false;
  }
}

// Browsers can replay cached Basic credentials automatically. They must use
// the revocable cookie and CSRF boundary instead of the machine exception.
export function isMachineRequest(request: Request): boolean {
  return !request.headers.has("origin")
    && !["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"].some((name) => request.headers.has(name));
}

export function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export function validReturnPath(candidate: string | null, origin: string): string {
  if (!candidate || candidate.length > 2_048 || !candidate.startsWith("/") || candidate.startsWith("//")
    || forbiddenPathCharacters(candidate)) return "/";
  try {
    const url = new URL(candidate, origin);
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== origin || path.startsWith("//") || forbiddenPathCharacters(path)
      || path === "/login" || path === "/logout" || path.startsWith("/auth/")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function forbiddenPathCharacters(value: string): boolean {
  return [...value].some((char) => char === "\\" || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

export function loginLocation(request: Request): string {
  const url = new URL(request.url);
  return `/login?return=${encodeURIComponent(validReturnPath(`${url.pathname}${url.search}`, url.origin))}`;
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

function readCookie(request: Request, name: string): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : null;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
}

function nonce(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function key(env: Env): Promise<CryptoKey> {
  if (!credentialsConfigured(env)) throw new Error("Authentication is not configured");
  return crypto.subtle.importKey("raw", encoder.encode(env.BASIC_AUTH_PASSWORD!), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function signedContent(kind: string, value: string, env: Env): Uint8Array<ArrayBuffer> {
  return encoder.encode(`cloudpit:${kind}:v1\0${env.BASIC_AUTH_USERNAME}\0${value}`);
}

async function sign(kind: string, value: string, env: Env): Promise<string> {
  return `${value}.${base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await key(env), signedContent(kind, value, env))))}`;
}

async function verify(kind: string, token: string | null, env: Env): Promise<string | null> {
  if (!token || token.length > 2_048 || !credentialsConfigured(env)) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    return await crypto.subtle.verify("HMAC", await key(env), decode64(parts[1]), signedContent(kind, parts[0], env)) ? parts[0] : null;
  } catch {
    return null;
  }
}

async function tokenHash(token: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));
}

export async function createSession(env: Env, now = Date.now()): Promise<{ session: BrowserSession; setCookie: string }> {
  const token = nonce();
  const session = { token_hash: await tokenHash(token), csrf_token: nonce(), expires_at: Math.floor(now / 1_000) + SESSION_TTL_SECONDS };
  await env.DB.prepare("INSERT INTO browser_sessions (token_hash, csrf_token, expires_at) VALUES (?, ?, ?)")
    .bind(session.token_hash, session.csrf_token, session.expires_at).run();
  return { session, setCookie: cookie(SESSION_COOKIE, await sign("session", token, env), SESSION_TTL_SECONDS) };
}

export async function getSession(request: Request, env: Env, now = Date.now()): Promise<BrowserSession | null> {
  const token = await verify("session", readCookie(request, SESSION_COOKIE), env);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await env.DB.prepare("SELECT token_hash, csrf_token, expires_at FROM browser_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await tokenHash(token), Math.floor(now / 1_000)).first<BrowserSession>();
  return session;
}

export async function revokeSession(env: Env, session: BrowserSession): Promise<void> {
  await env.DB.prepare("DELETE FROM browser_sessions WHERE token_hash = ?").bind(session.token_hash).run();
  const response = await env.EVENTS.getByName("global", { locationHint: env.EVENT_LOCATION_HINT }).fetch("https://events.internal/revoke", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionHash: session.token_hash })
  });
  if (!response.ok) throw new Error("Session event revocation failed");
}

export async function pruneSessions(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM browser_sessions WHERE expires_at <= ?").bind(Math.floor(now / 1_000)).run();
}

export function validSessionCsrf(request: Request, session: BrowserSession): boolean {
  // Browsers omit Origin on same-origin GET/HEAD. The token is still mandatory
  // for the legacy detail endpoint that changes read state.
  const sameOriginRead = ["GET", "HEAD"].includes(request.method) && !request.headers.has("origin")
    && request.headers.get("sec-fetch-site") === "same-origin";
  return (sameOrigin(request) || sameOriginRead) && timingSafeEqual(request.headers.get("x-cloudpit-csrf") ?? "", session.csrf_token);
}

export async function validLoginCsrf(request: Request, value: string, env: Env, now = Date.now()): Promise<boolean> {
  if (!sameOrigin(request)) return false;
  const payload = await verify("login", readCookie(request, LOGIN_COOKIE), env);
  if (!payload) return false;
  try {
    const claims = JSON.parse(new TextDecoder().decode(decode64(payload))) as { nonce?: unknown; exp?: unknown };
    const seconds = Math.floor(now / 1_000);
    return typeof claims.nonce === "string" && timingSafeEqual(value, claims.nonce)
      && typeof claims.exp === "number" && Number.isSafeInteger(claims.exp)
      && claims.exp > seconds && claims.exp <= seconds + LOGIN_TTL_SECONDS;
  } catch {
    return false;
  }
}

export async function readLoginForm(request: Request): Promise<URLSearchParams | null> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 32_768) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  if (["username", "password", "csrf", "return"].some((field) => form.getAll(field).length !== 1)) return null;
  return form;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export async function loginPage(request: Request, env: Env, options: { error?: string; username?: string; returnPath?: string; status?: number } = {}): Promise<Response> {
  const url = new URL(request.url);
  const returnPath = validReturnPath(options.returnPath ?? url.searchParams.get("return"), url.origin);
  const csrf = nonce();
  const payload = base64url(encoder.encode(JSON.stringify({ nonce: csrf, exp: Math.floor(Date.now() / 1_000) + LOGIN_TTL_SECONDS })));
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/assets/app.css"><title>Entrar · ${escapeHtml(env.INBOX_LABEL || "Mailpit Cloudflare")}</title></head>
<body class="bg-light"><main class="container py-5"><div class="row justify-content-center"><section class="col-12 col-sm-9 col-md-6 col-lg-4" aria-labelledby="login-title"><div class="card shadow-sm"><div class="card-body p-4"><h1 id="login-title" class="h4 mb-2">${escapeHtml(env.INBOX_LABEL || "Mailpit Cloudflare")}</h1><p class="text-secondary mb-4">Entre para abrir a caixa de e-mails de teste.</p>
${options.error ? `<div class="alert alert-danger" role="alert">${escapeHtml(options.error)}</div>` : ""}
<form id="cloudpit-login" method="post" action="/login" autocomplete="on"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="return" value="${escapeHtml(returnPath)}">
<div class="mb-3"><label class="form-label" for="username">Usuário</label><input class="form-control" id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="256" value="${escapeHtml(options.username ?? "")}" required autofocus></div>
<div class="mb-4"><label class="form-label" for="password">Senha</label><input class="form-control" id="password" name="password" type="password" autocomplete="current-password" maxlength="4096" required></div>
<button class="btn btn-primary w-100" type="submit">Entrar</button></form><p class="small text-secondary mt-3 mb-0">A sessão dura até 12 horas. Você pode salvar o acesso no seu gerenciador de senhas.</p></div></div></section></div></main></body></html>`;
  return new Response(html, { status: options.status ?? 200, headers: {
    "content-type": "text/html; charset=utf-8",
    "set-cookie": cookie(LOGIN_COOKIE, await sign("login", payload, env), LOGIN_TTL_SECONDS),
    "content-security-policy": "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  } });
}

export function clearLoginCookie(): string { return cookie(LOGIN_COOKIE, "", 0); }
