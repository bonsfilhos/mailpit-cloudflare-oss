import { compileSearch } from "./search";
import type {
  Env,
  MessageRow,
  MessageSummary,
  StoredMessageDetail
} from "./types";

export interface ListOptions {
  start: number;
  limit: number;
  before?: string;
  query?: string;
}

export interface MailboxResponse {
  total: number;
  unread: number;
  count: number;
  messages_count: number;
  messages_unread: number;
  start: number;
  tags: string[];
  messages: MessageSummary[];
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function rowToSummary(row: MessageRow, tags: string[] = []): MessageSummary {
  return {
    ID: row.id,
    MessageID: row.message_id,
    Read: row.is_read === 1,
    From: parseJson(row.from_json, null),
    To: parseJson(row.to_json, []),
    Cc: parseJson(row.cc_json, []),
    Bcc: parseJson(row.bcc_json, []),
    ReplyTo: parseJson(row.reply_to_json, []),
    Subject: row.subject,
    Created: row.created_at,
    Username: row.username,
    Tags: tags,
    Size: row.size,
    Attachments: row.attachment_count,
    Snippet: row.snippet
  };
}

export async function listMessages(env: Env, options: ListOptions): Promise<MailboxResponse> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.query) {
    const search = compileSearch(options.query);
    where.push(search.sql);
    params.push(...search.params);
  }
  if (options.before) {
    const before = new Date(options.before);
    if (!Number.isNaN(before.valueOf())) {
      where.push("m.created_at < ?");
      params.push(before.toISOString());
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [globalStats, filteredStats, tagRows, rows] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread FROM messages"
    ).first<{ total: number; unread: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread FROM messages m ${whereSql}`
    )
      .bind(...params)
      .first<{ total: number; unread: number }>(),
    env.DB.prepare("SELECT DISTINCT tag FROM message_tags ORDER BY tag COLLATE NOCASE").all<{ tag: string }>(),
    env.DB.prepare(
      `SELECT m.* FROM messages m ${whereSql} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`
    )
      .bind(...params, options.limit, options.start)
      .all<MessageRow>()
  ]);

  const messageRows = rows.results ?? [];
  const tagsByMessage = await loadTagsByMessage(env.DB, messageRows.map((row) => row.id));
  return {
    total: Number(globalStats?.total ?? 0),
    unread: Number(globalStats?.unread ?? 0),
    count: messageRows.length,
    messages_count: Number(filteredStats?.total ?? 0),
    messages_unread: Number(filteredStats?.unread ?? 0),
    start: options.start,
    tags: (tagRows.results ?? []).map((row) => row.tag),
    messages: messageRows.map((row) => rowToSummary(row, tagsByMessage.get(row.id) ?? []))
  };
}

export async function getMessageRow(env: Env, id: string): Promise<MessageRow | null> {
  return env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(id).first<MessageRow>();
}

export async function getMessageDetail(env: Env, id: string): Promise<StoredMessageDetail | null> {
  const row = await getMessageRow(env, id);
  if (!row) return null;
  const object = await env.MESSAGE_STORE.get(row.detail_key);
  if (!object) return null;
  const detail = (await object.json()) as StoredMessageDetail;
  detail.Tags = await loadTags(env.DB, id);
  return detail;
}

export async function loadTags(db: D1Database, id: string): Promise<string[]> {
  const result = await db
    .prepare("SELECT tag FROM message_tags WHERE message_id = ? ORDER BY tag COLLATE NOCASE")
    .bind(id)
    .all<{ tag: string }>();
  return (result.results ?? []).map((row) => row.tag);
}

async function loadTagsByMessage(db: D1Database, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT message_id, tag FROM message_tags WHERE message_id IN (${placeholders}) ORDER BY tag COLLATE NOCASE`
    )
    .bind(...ids)
    .all<{ message_id: string; tag: string }>();
  for (const row of result.results ?? []) {
    const tags = map.get(row.message_id) ?? [];
    tags.push(row.tag);
    map.set(row.message_id, tags);
  }
  return map;
}

export async function updateReadState(env: Env, ids: string[] | null, read: boolean): Promise<MessageSummary[]> {
  if (ids && ids.length === 0) return [];
  const clauses = ids ? `WHERE id IN (${ids.map(() => "?").join(", ")})` : "";
  await env.DB.prepare(`UPDATE messages SET is_read = ? ${clauses}`).bind(read ? 1 : 0, ...(ids ?? [])).run();
  const result = await env.DB.prepare(`SELECT * FROM messages ${clauses}`)
    .bind(...(ids ?? []))
    .all<MessageRow>();
  const rows = result.results ?? [];
  const tags = await loadTagsByMessage(env.DB, rows.map((row) => row.id));
  return rows.map((row) => rowToSummary(row, tags.get(row.id) ?? []));
}

export async function replaceMessageTags(env: Env, ids: string[], tags: string[]): Promise<void> {
  if (!ids.length) return;
  const statements: D1PreparedStatement[] = [];
  for (const id of ids) {
    statements.push(env.DB.prepare("DELETE FROM message_tags WHERE message_id = ?").bind(id));
    for (const tag of tags) {
      statements.push(
        env.DB.prepare("INSERT OR IGNORE INTO message_tags (message_id, tag) VALUES (?, ?)").bind(id, tag)
      );
    }
  }
  await env.DB.batch(statements);
}

export async function renameTag(env: Env, current: string, next: string): Promise<void> {
  const rows = await env.DB.prepare("SELECT message_id FROM message_tags WHERE tag = ? COLLATE NOCASE")
    .bind(current)
    .all<{ message_id: string }>();
  const statements: D1PreparedStatement[] = [];
  for (const row of rows.results ?? []) {
    statements.push(
      env.DB.prepare("INSERT OR IGNORE INTO message_tags (message_id, tag) VALUES (?, ?)").bind(row.message_id, next)
    );
  }
  statements.push(env.DB.prepare("DELETE FROM message_tags WHERE tag = ? COLLATE NOCASE").bind(current));
  await env.DB.batch(statements);
}

export async function deleteTag(env: Env, tag: string): Promise<void> {
  await env.DB.prepare("DELETE FROM message_tags WHERE tag = ? COLLATE NOCASE").bind(tag).run();
}

export async function deleteMessages(env: Env, ids: string[] | null): Promise<MessageRow[]> {
  if (ids && !ids.length) return [];
  const where = ids ? `WHERE id IN (${ids.map(() => "?").join(", ")})` : "";
  const rows = await env.DB.prepare(`SELECT * FROM messages ${where}`)
    .bind(...(ids ?? []))
    .all<MessageRow>();
  await env.DB.prepare(`DELETE FROM messages ${where}`).bind(...(ids ?? [])).run();
  if (rows.results?.length) await incrementStat(env.DB, "deleted", rows.results.length);
  return rows.results ?? [];
}

export async function cleanupObjects(env: Env, rows: MessageRow[]): Promise<void> {
  const keys: string[] = [];
  for (const row of rows) {
    keys.push(row.raw_key, row.detail_key);
    const detail = await env.MESSAGE_STORE.get(row.detail_key);
    if (!detail) continue;
    try {
      const parsed = (await detail.json()) as StoredMessageDetail;
      keys.push(...[...parsed.Inline, ...parsed.Attachments, ...parsed.OtherParts].map((item) => item.ObjectKey));
    } catch {
      // Raw and detail objects are still deleted if an old detail cannot be parsed.
    }
  }
  if (keys.length) await env.MESSAGE_STORE.delete([...new Set(keys)]);
}

export async function incrementStat(db: D1Database, key: string, delta: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO runtime_stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value"
    )
    .bind(key, delta)
    .run();
}

export async function runtimeStats(env: Env): Promise<Record<string, number>> {
  const result = await env.DB.prepare("SELECT key, value FROM runtime_stats").all<{ key: string; value: number }>();
  return Object.fromEntries((result.results ?? []).map((row) => [row.key, Number(row.value)]));
}

export async function pruneMessages(env: Env): Promise<MessageRow[]> {
  const retentionDays = Math.max(1, Number.parseInt(env.RETENTION_DAYS, 10) || 7);
  const maxMessages = Math.max(1, Number.parseInt(env.MAX_MESSAGES, 10) || 500);
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const result = await env.DB.prepare(
    `SELECT * FROM messages
     WHERE created_at < ? OR id IN (
       SELECT id FROM messages ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?
     )`
  )
    .bind(cutoff, maxMessages)
    .all<MessageRow>();
  const rows = result.results ?? [];
  if (rows.length) await deleteMessages(env, rows.map((row) => row.id));
  return rows;
}

export async function mailboxStats(env: Env): Promise<{ Total: number; Unread: number }> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread FROM messages"
  ).first<{ total: number; unread: number }>();
  return { Total: Number(row?.total ?? 0), Unread: Number(row?.unread ?? 0) };
}
