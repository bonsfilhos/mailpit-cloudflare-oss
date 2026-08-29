import type { SearchClause } from "./types";

interface Token {
  value: string;
  negated: boolean;
}

export function tokenizeSearch(query: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /(?:^|\s)(-?)(?:([\w-]+):)?(?:"([^"]*)"|(\S+))/g;
  for (const match of query.matchAll(pattern)) {
    const field = match[2] ? `${match[2]}:` : "";
    const rawValue = match[3] ?? match[4] ?? "";
    if (rawValue) tokens.push({ value: `${field}${rawValue}`, negated: match[1] === "-" });
  }
  return tokens;
}

function parseByteSize(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(b|kb|kib|mb|mib|gb|gib)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const multiplier: Record<string, number> = {
    b: 1,
    kb: 1_000,
    kib: 1_024,
    mb: 1_000_000,
    mib: 1_048_576,
    gb: 1_000_000_000,
    gib: 1_073_741_824
  };
  return Math.round(number * (multiplier[unit] ?? 1));
}

function parseDate(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function compileSearch(query: string): SearchClause {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const token of tokenizeSearch(query)) {
    const colon = token.value.indexOf(":");
    const field = colon > 0 ? token.value.slice(0, colon).toLowerCase() : "";
    const rawValue = colon > 0 ? token.value.slice(colon + 1) : token.value;
    const value = rawValue.toLowerCase();
    let sql = "";
    const localParams: unknown[] = [];

    const searchColumn: Record<string, string> = {
      from: "m.from_search",
      to: "m.to_search",
      cc: "m.cc_search",
      bcc: "m.bcc_search",
      replyto: "m.reply_to_search",
      "reply-to": "m.reply_to_search",
      subject: "LOWER(m.subject)",
      id: "LOWER(m.message_id)"
    };

    if (field in searchColumn) {
      sql = `${searchColumn[field]} LIKE ? ESCAPE '\\'`;
      localParams.push(like(value));
    } else if (field === "tag") {
      sql = "EXISTS (SELECT 1 FROM message_tags st WHERE st.message_id = m.id AND LOWER(st.tag) LIKE ? ESCAPE '\\')";
      localParams.push(like(value));
    } else if ((field === "is" || field === "read") && ["read", "true", "yes"].includes(value)) {
      sql = "m.is_read = 1";
    } else if ((field === "is" || field === "read") && ["unread", "false", "no"].includes(value)) {
      sql = "m.is_read = 0";
    } else if (field === "has" && ["attachment", "attachments"].includes(value)) {
      sql = "m.attachment_count > 0";
    } else if (field === "larger" || field === "smaller") {
      const size = parseByteSize(value);
      if (size !== null) {
        sql = `m.size ${field === "larger" ? ">" : "<"} ?`;
        localParams.push(size);
      }
    } else if (field === "before" || field === "after") {
      const date = parseDate(rawValue);
      if (date) {
        sql = `m.created_at ${field === "before" ? "<" : ">"} ?`;
        localParams.push(date);
      }
    } else {
      sql = "m.search_text LIKE ? ESCAPE '\\'";
      localParams.push(like(token.value.toLowerCase()));
    }

    if (!sql) continue;
    clauses.push(token.negated ? `NOT (${sql})` : `(${sql})`);
    params.push(...localParams);
  }

  return { sql: clauses.length ? clauses.join(" AND ") : "1 = 1", params };
}

function like(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
