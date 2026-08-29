import { Hono } from "hono";
import { broadcastEvent, EventHub } from "./event-hub";
import { buildRawMime, normalizedTags } from "./format";
import { checkLinks } from "./links";
import { ingestForwardable, ingestRawMessage, recordRejected } from "./mail";
import {
  cleanupObjects,
  deleteMessages,
  deleteTag,
  getMessageDetail,
  getMessageRow,
  listMessages,
  mailboxStats,
  pruneMessages,
  renameTag,
  replaceMessageTags,
  runtimeStats,
  updateReadState
} from "./repository";
import type { Env, SendApiPayload, StoredAttachment } from "./types";

export { EventHub };

type AppBindings = { Bindings: Env };
const app = new Hono<AppBindings>();

function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return mismatch === 0;
}

function bearer(request: Request): string {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
}

function hasBasicAuth(request: Request, env: Env): boolean {
  if (!env.BASIC_AUTH_USERNAME || !env.BASIC_AUTH_PASSWORD) return false;
  const encoded = request.headers.get("authorization")?.match(/^Basic\s+(.+)$/i)?.[1];
  if (!encoded) return false;
  try {
    const separator = atob(encoded).indexOf(":");
    if (separator < 0) return false;
    const decoded = atob(encoded);
    return (
      timingSafeEqual(decoded.slice(0, separator), env.BASIC_AUTH_USERNAME) &&
      timingSafeEqual(decoded.slice(separator + 1), env.BASIC_AUTH_PASSWORD)
    );
  } catch {
    return false;
  }
}

app.use("*", async (context, next) => {
  if (context.req.path === "/health" || context.req.path === "/api/v1/send") return next();
  if (context.env.AUTH_REQUIRED === "true" && !hasBasicAuth(context.req.raw, context.env)) {
    return new Response("Mailpit Cloudflare authentication is required", {
      status: 401,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": 'Basic realm="Mailpit Cloudflare", charset="UTF-8"',
        "cache-control": "no-store"
      }
    });
  }
  return next();
});

app.get("/health", async (context) => {
  try {
    await context.env.DB.prepare("SELECT 1").first();
    return context.json({ ok: true, service: "mailpit-cloudflare", storage: "ready" });
  } catch {
    return context.json({ ok: false, service: "mailpit-cloudflare", storage: "unavailable" }, 503);
  }
});

app.get("/api/events", (context) => {
  const hub = context.env.EVENTS.getByName("global", { locationHint: context.env.EVENT_LOCATION_HINT });
  return hub.fetch(context.req.raw);
});

app.get("/api/v1/messages", async (context) => {
  return context.json(
    await listMessages(context.env, {
      start: boundedInteger(context.req.query("start"), 0, 100_000, 0),
      limit: boundedInteger(context.req.query("limit"), 1, 100, 50),
      before: context.req.query("before")
    })
  );
});

app.get("/api/v1/search", async (context) => {
  return context.json(
    await listMessages(context.env, {
      start: boundedInteger(context.req.query("start"), 0, 100_000, 0),
      limit: boundedInteger(context.req.query("limit"), 1, 100, 50),
      before: context.req.query("before"),
      query: context.req.query("query") ?? ""
    })
  );
});

app.put("/api/v1/messages", async (context) => {
  const body = await context.req
    .json<Record<string, unknown>>()
    .catch(() => ({} as Record<string, unknown>));
  const ids = stringArray(body.IDs);
  const readValue = body.Read ?? body.read;
  if (typeof readValue !== "boolean") return context.json({ Error: "Read must be a boolean" }, 422);
  const updates = await updateReadState(context.env, ids.length ? ids : null, readValue);
  context.executionCtx.waitUntil(
    Promise.all([
      ...updates.map((summary) =>
        broadcastEvent(context.env.EVENTS, { Type: "update", Data: summary }, context.env.EVENT_LOCATION_HINT)
      ),
      broadcastStats(context.env)
    ]).then(() => undefined)
  );
  return context.json({ updated: updates.length });
});

app.delete("/api/v1/messages", async (context) => {
  const body = await context.req
    .json<Record<string, unknown>>()
    .catch(() => ({} as Record<string, unknown>));
  const ids = stringArray(body.IDs);
  const rows = await deleteMessages(context.env, ids.length ? ids : null);
  context.executionCtx.waitUntil(
    Promise.all([
      cleanupObjects(context.env, rows),
      ids.length
        ? Promise.all(
            rows.map((row) =>
              broadcastEvent(
                context.env.EVENTS,
                { Type: "delete", Data: { ID: row.id } },
                context.env.EVENT_LOCATION_HINT
              )
            )
          )
        : broadcastEvent(context.env.EVENTS, { Type: "truncate" }, context.env.EVENT_LOCATION_HINT),
      broadcastStats(context.env)
    ]).then(() => undefined)
  );
  return context.json({ deleted: rows.length });
});

app.get("/api/v1/message/:id", async (context) => {
  const id = context.req.param("id");
  const row = await getMessageRow(context.env, id);
  if (!row) return context.json({ Error: "Message not found" }, 404);
  const detail = await getMessageDetail(context.env, id);
  if (!detail) return context.json({ Error: "Message content is unavailable" }, 404);
  if (row.is_read === 0) {
    await updateReadState(context.env, [id], true);
    context.executionCtx.waitUntil(
      Promise.all([
        broadcastEvent(
          context.env.EVENTS,
          { Type: "update", Data: { ID: id, Read: true } },
          context.env.EVENT_LOCATION_HINT
        ),
        broadcastStats(context.env)
      ]).then(() => undefined)
    );
  }
  return context.json(detail);
});

app.get("/api/v1/message/:id/headers", async (context) => {
  const detail = await getMessageDetail(context.env, context.req.param("id"));
  return detail ? context.json(detail.Headers) : context.json({ Error: "Message not found" }, 404);
});

app.get("/api/v1/message/:id/raw", async (context) => {
  const row = await getMessageRow(context.env, context.req.param("id"));
  if (!row) return context.json({ Error: "Message not found" }, 404);
  const object = await context.env.MESSAGE_STORE.get(row.raw_key);
  if (!object) return context.json({ Error: "Raw message is unavailable" }, 404);
  const headers = new Headers({
    "content-type": "message/rfc822; charset=utf-8",
    "cache-control": "private, no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  });
  if (context.req.query("dl") === "1") headers.set("content-disposition", `attachment; filename="${row.id}.eml"`);
  return new Response(object.body, { headers });
});

app.get("/api/v1/message/:id/part/:part", async (context) => {
  const detail = await getMessageDetail(context.env, context.req.param("id"));
  if (!detail) return context.json({ Error: "Message not found" }, 404);
  const part = allParts(detail).find((item) => item.PartID === context.req.param("part"));
  if (!part) return context.json({ Error: "Message part not found" }, 404);
  const object = await context.env.MESSAGE_STORE.get(part.ObjectKey);
  if (!object) return context.json({ Error: "Message part is unavailable" }, 404);
  const safeName = (part.FileName || `part-${part.PartID}`).replace(/[\r\n"\\]/g, "_");
  const active = /^(?:text\/html|image\/svg\+xml|application\/(?:javascript|xhtml\+xml))/i.test(part.ContentType);
  return new Response(object.body, {
    headers: {
      "content-type": active ? "application/octet-stream" : part.ContentType,
      "content-disposition": `${part.Disposition === "inline" && !active ? "inline" : "attachment"}; filename="${safeName}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
});

app.get("/api/v1/message/:id/part/:part/thumb", async (context) => {
  const detail = await getMessageDetail(context.env, context.req.param("id"));
  if (!detail) return context.json({ Error: "Message not found" }, 404);
  const part = allParts(detail).find((item) => item.PartID === context.req.param("part"));
  if (!part?.ContentType.startsWith("image/") || part.ContentType === "image/svg+xml") {
    return context.json({ Error: "Thumbnail is unavailable" }, 404);
  }
  const object = await context.env.MESSAGE_STORE.get(part.ObjectKey);
  return object
    ? new Response(object.body, { headers: { "content-type": part.ContentType, "cache-control": "private, no-store" } })
    : context.json({ Error: "Message part is unavailable" }, 404);
});

app.get("/api/v1/message/:id/link-check", async (context) => {
  const detail = await getMessageDetail(context.env, context.req.param("id"));
  if (!detail) return context.json({ Error: "Message not found" }, 404);
  return context.json(await checkLinks(detail, context.req.query("follow") === "true"));
});

app.get("/api/v1/message/:id/html-check", (context) =>
  context.json({ Error: "HTML compatibility scoring is not available on the Cloudflare runtime" }, 501)
);
app.get("/api/v1/message/:id/sa-check", (context) =>
  context.json({ Error: "SpamAssassin requires an external scorer and is not configured" }, 501)
);

app.get("/api/v1/tags", async (context) => {
  const result = await context.env.DB.prepare("SELECT DISTINCT tag FROM message_tags ORDER BY tag COLLATE NOCASE").all<{
    tag: string;
  }>();
  return context.json((result.results ?? []).map((row) => row.tag));
});

app.put("/api/v1/tags", async (context) => {
  const body = await context.req.json<Record<string, unknown>>();
  const ids = stringArray(body.IDs);
  const tags = normalizedTags(stringArray(body.Tags));
  if (!ids.length) return context.json({ Error: "At least one message ID is required" }, 422);
  await replaceMessageTags(context.env, ids, tags);
  context.executionCtx.waitUntil(
    Promise.all(
      ids.map((id) =>
        broadcastEvent(
          context.env.EVENTS,
          { Type: "update", Data: { ID: id, Tags: tags } },
          context.env.EVENT_LOCATION_HINT
        )
      )
    ).then(() => undefined)
  );
  return context.json({ updated: ids.length, tags });
});

app.put("/api/v1/tags/:tag", async (context) => {
  const body = await context.req.json<{ Name?: string }>();
  const [next] = normalizedTags([body.Name ?? ""]);
  if (!next) return context.json({ Error: "A non-empty tag name is required" }, 422);
  await renameTag(context.env, context.req.param("tag"), next);
  return context.json({ Name: next });
});

app.delete("/api/v1/tags/:tag", async (context) => {
  await deleteTag(context.env, context.req.param("tag"));
  return context.json({ deleted: context.req.param("tag") });
});

app.post("/api/v1/send", async (context) => {
  if (!context.env.INGEST_TOKEN || !timingSafeEqual(bearer(context.req.raw), context.env.INGEST_TOKEN)) {
    return context.json({ Error: "A valid ingest bearer token is required" }, 401);
  }
  const payload = await context.req.json<SendApiPayload>();
  if (!payload.From?.Email) return context.json({ Error: "From.Email is required" }, 422);
  const recipients = [...(payload.To ?? []), ...(payload.Cc ?? []), ...(payload.Bcc ?? [])];
  const target = recipients.find((item) =>
    item.Email.toLowerCase().endsWith(`@${context.env.INBOUND_DOMAIN.toLowerCase()}`)
  );
  if (!target) return context.json({ Error: "At least one Mailpit Cloudflare recipient is required" }, 422);
  const raw = buildRawMime(payload);
  const summary = await ingestRawMessage(context.env, {
    raw,
    envelopeFrom: payload.From.Email,
    envelopeTo: target.Email,
    username: "http-api",
    extraTags: payload.Tags
  });
  context.executionCtx.waitUntil(broadcastNew(context.env, summary));
  return context.json(summary, 201);
});

app.post("/api/v1/message/:id/release", async (context) => {
  return context.json(
    { Error: "Message release requires a separately configured outbound transport and is disabled" },
    501
  );
});

app.get("/api/v1/webui", (context) =>
  context.json({
    Label: context.env.INBOX_LABEL,
    SourceURL: context.env.SOURCE_REPOSITORY_URL,
    MessageRelay: {
      Enabled: false,
      SMTPServer: "",
      ReturnPath: "",
      AllowedRecipients: "",
      BlockedRecipients: "",
      OverrideFrom: "",
      PreserveMessageIDs: false,
      RecipientAllowlist: ""
    },
    SpamAssassin: false,
    ChaosEnabled: false,
    DuplicatesIgnored: false,
    HideDeleteAllButton: false
  })
);

app.get("/api/v1/info", async (context) => {
  const [stats, mailbox, tags] = await Promise.all([
    runtimeStats(context.env),
    mailboxStats(context.env),
    context.env.DB.prepare("SELECT tag, COUNT(*) AS count FROM message_tags GROUP BY tag ORDER BY tag COLLATE NOCASE").all<{
      tag: string;
      count: number;
    }>()
  ]);
  return context.json({
    Version: "v0.1.0",
    LatestVersion: "disabled",
    Database: "Cloudflare D1 + R2",
    DatabaseSize: Number(stats.accepted_bytes ?? 0),
    Messages: mailbox.Total,
    Unread: mailbox.Unread,
    Tags: Object.fromEntries((tags.results ?? []).map((row) => [row.tag, Number(row.count)])),
    RuntimeStats: {
      Uptime: 0,
      Memory: 0,
      MessagesDeleted: Number(stats.deleted ?? 0),
      SMTPAccepted: Number(stats.accepted ?? 0),
      SMTPAcceptedSize: Number(stats.accepted_bytes ?? 0),
      SMTPRejected: Number(stats.rejected ?? 0),
      SMTPIgnored: 0
    }
  });
});

app.get("/api/licenses", (context) =>
  context.json([
    {
      Name: "Mailpit Cloudflare",
      License: "MIT",
      Text: "Copyright (c) Bons Filhos. Mailpit Cloudflare is an independent project derived from Mailpit's MIT-licensed UI."
    },
    {
      Name: "Mailpit UI",
      License: "MIT",
      Text: "Copyright (c) 2022-present Ralph Slooten and contributors. See THIRD_PARTY_NOTICES.md and vendor/mailpit/LICENSE."
    }
  ])
);

app.get("/api/v1/chaos", (context) => context.json({ Error: "SMTP chaos is not available on Workers" }, 501));
app.put("/api/v1/chaos", (context) => context.json({ Error: "SMTP chaos is not available on Workers" }, 501));

app.get("/api/v1/", (context) =>
  context.json({
    name: "Mailpit Cloudflare API",
    version: "v1",
    compatibility: "Mailpit API v1 subset",
    endpoints: ["/api/v1/messages", "/api/v1/search", "/api/v1/tags", "/api/v1/send"]
  })
);

app.onError((caught, context) => {
  console.error("Mailpit Cloudflare request failed", {
    method: context.req.method,
    path: context.req.path,
    error: caught.message
  });
  return context.json({ Error: "Mailpit Cloudflare could not complete the request" }, 500);
});

app.notFound(async (context) => {
  if (context.req.path.startsWith("/api/")) return context.json({ Error: "API route not found" }, 404);
  const response = await context.env.ASSETS.fetch(context.req.raw);
  return withSecurityHeaders(response);
});

function boundedInteger(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function allParts(detail: { Inline: StoredAttachment[]; Attachments: StoredAttachment[]; OtherParts: StoredAttachment[] }) {
  return [...detail.Inline, ...detail.Attachments, ...detail.OtherParts];
}

async function broadcastStats(env: Env): Promise<void> {
  const stats = await mailboxStats(env);
  await broadcastEvent(
    env.EVENTS,
    { Type: "stats", Data: { ...stats, Version: "v0.1.0" } },
    env.EVENT_LOCATION_HINT
  );
}

async function broadcastNew(env: Env, summary: unknown): Promise<void> {
  await Promise.all([
    broadcastEvent(env.EVENTS, { Type: "new", Data: summary }, env.EVENT_LOCATION_HINT),
    broadcastStats(env)
  ]);
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("cache-control", response.headers.get("cache-control") ?? "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const summary = await ingestForwardable(env, message);
      ctx.waitUntil(broadcastNew(env, summary));
    } catch (caught) {
      ctx.waitUntil(recordRejected(env));
      message.setReject(
        caught instanceof Error ? caught.message.slice(0, 150) : "Mailpit Cloudflare rejected the message"
      );
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const rows = await pruneMessages(env);
    if (!rows.length) return;
    ctx.waitUntil(
      Promise.all([
        cleanupObjects(env, rows),
        broadcastEvent(env.EVENTS, { Type: "prune" }, env.EVENT_LOCATION_HINT),
        broadcastStats(env)
      ]).then(() => undefined)
    );
  }
} satisfies ExportedHandler<Env>;
