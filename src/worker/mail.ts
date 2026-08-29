import PostalMime from "postal-mime";
import {
  addressSearch,
  checksum,
  firstHeader,
  flattenPostalAddresses,
  headerMap,
  listUnsubscribe,
  messageSnippet,
  normalizedTags,
  parseAddressMetadata,
  tagsFromRecipient,
  toArrayBuffer,
  toBytes
} from "./format";
import { incrementStat, rowToSummary } from "./repository";
import type {
  Env,
  IngestInput,
  MailAddress,
  MessageRow,
  MessageSummary,
  StoredAttachment,
  StoredMessageDetail
} from "./types";

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function safeDate(value?: string): string {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function envelopeAddress(value: string): MailAddress[] {
  return value ? [{ Name: "", Address: value }] : [];
}

export async function ingestRawMessage(env: Env, input: IngestInput): Promise<MessageSummary> {
  const maxBytes = Math.max(1, Number.parseInt(env.MAX_MESSAGE_BYTES ?? "26214400", 10));
  if (input.raw.byteLength > maxBytes) throw new Error(`Message exceeds the ${maxBytes}-byte limit`);

  const parsed = input.parsed ?? (await PostalMime.parse(input.raw, { attachmentEncoding: "arraybuffer" }));
  const id = crypto.randomUUID().replaceAll("-", "");
  const root = `messages/${id}`;
  const rawKey = `${root}/raw.eml`;
  const detailKey = `${root}/detail.json`;
  const createdAt = new Date().toISOString();
  const headers = headerMap(parsed);

  const parsedFrom = parsed.from ? flattenPostalAddresses([parsed.from])[0] ?? null : null;
  const originalTo = parseAddressMetadata(firstHeader(parsed, "x-mailpit-cloudflare-original-to"));
  const originalCc = parseAddressMetadata(firstHeader(parsed, "x-mailpit-cloudflare-original-cc"));
  const originalBcc = parseAddressMetadata(firstHeader(parsed, "x-mailpit-cloudflare-original-bcc"));
  const to = originalTo.length ? originalTo : flattenPostalAddresses(parsed.to);
  const cc = originalCc.length ? originalCc : flattenPostalAddresses(parsed.cc);
  const bcc = originalBcc.length ? originalBcc : flattenPostalAddresses(parsed.bcc);
  const replyTo = flattenPostalAddresses(parsed.replyTo);

  const recipientTags = tagsFromRecipient(input.envelopeTo);
  const headerTags = parseCsv(firstHeader(parsed, "x-tags"));
  const project = firstHeader(parsed, "x-mailpit-cloudflare-project") || recipientTags[0] || "";
  const environment = firstHeader(parsed, "x-mailpit-cloudflare-environment") || recipientTags[1] || "";
  const tags = normalizedTags([
    ...recipientTags,
    ...headerTags,
    ...(input.extraTags ?? []),
    ...(project ? [`project:${project}`] : []),
    ...(environment ? [`environment:${environment}`] : [])
  ]);
  const username = input.username || [project, environment].filter(Boolean).join("/");

  const inline: StoredAttachment[] = [];
  const attachments: StoredAttachment[] = [];
  const storedKeys = [rawKey, detailKey];
  try {
    for (const [index, attachment] of parsed.attachments.entries()) {
      const partId = String(index + 1);
      const bytes = toBytes(attachment.content);
      const objectKey = `${root}/parts/${partId}`;
      const disposition = attachment.disposition === "inline" || attachment.related ? "inline" : "attachment";
      const metadata: StoredAttachment = {
        PartID: partId,
        FileName: attachment.filename ?? "",
        ContentType: attachment.mimeType || "application/octet-stream",
        ContentID: (attachment.contentId ?? "").replace(/^<|>$/g, ""),
        Size: bytes.byteLength,
        Checksums: checksum(bytes),
        ObjectKey: objectKey,
        Disposition: disposition
      };
      await env.MESSAGE_STORE.put(objectKey, toArrayBuffer(bytes), {
        httpMetadata: { contentType: metadata.ContentType },
        customMetadata: { filename: metadata.FileName, disposition }
      });
      storedKeys.push(objectKey);
      (disposition === "inline" ? inline : attachments).push(metadata);
    }

    const text = parsed.text ?? "";
    const html = parsed.html ?? "";
    const detail: StoredMessageDetail = {
      ID: id,
      MessageID: parsed.messageId ?? "",
      From: parsedFrom,
      To: to.length ? to : envelopeAddress(input.envelopeTo),
      Cc: cc,
      Bcc: bcc,
      ReplyTo: replyTo,
      ReturnPath: parsed.returnPath ?? input.envelopeFrom,
      Subject: parsed.subject ?? "",
      ListUnsubscribe: listUnsubscribe(parsed),
      Date: safeDate(parsed.date),
      Tags: tags,
      Username: username,
      Text: text,
      HTML: html,
      Size: input.raw.byteLength,
      Inline: inline,
      Attachments: attachments,
      OtherParts: [],
      Headers: headers
    };
    await env.MESSAGE_STORE.put(rawKey, input.raw, {
      httpMetadata: { contentType: "message/rfc822" },
      customMetadata: { messageId: detail.MessageID }
    });
    await env.MESSAGE_STORE.put(detailKey, JSON.stringify(detail), {
      httpMetadata: { contentType: "application/json" }
    });

    const row: MessageRow = {
      id,
      message_id: detail.MessageID,
      is_read: 0,
      from_json: JSON.stringify(detail.From),
      to_json: JSON.stringify(detail.To),
      cc_json: JSON.stringify(detail.Cc),
      bcc_json: JSON.stringify(detail.Bcc),
      reply_to_json: JSON.stringify(detail.ReplyTo),
      return_path: detail.ReturnPath,
      subject: detail.Subject,
      message_date: detail.Date,
      created_at: createdAt,
      username,
      size: detail.Size,
      attachment_count: attachments.length,
      inline_count: inline.length,
      snippet: messageSnippet(text, html),
      raw_key: rawKey,
      detail_key: detailKey,
      from_search: addressSearch(detail.From ? [detail.From] : []),
      to_search: addressSearch(detail.To),
      cc_search: addressSearch(detail.Cc),
      bcc_search: addressSearch(detail.Bcc),
      reply_to_search: addressSearch(detail.ReplyTo),
      search_text: [
        detail.MessageID,
        detail.Subject,
        text,
        html.replace(/<[^>]+>/g, " "),
        addressSearch(detail.From ? [detail.From] : []),
        addressSearch([...detail.To, ...detail.Cc, ...detail.Bcc, ...detail.ReplyTo]),
        tags.join(" ")
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .toLowerCase()
    };

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO messages (
          id, message_id, is_read, from_json, to_json, cc_json, bcc_json, reply_to_json,
          return_path, subject, message_date, created_at, username, size, attachment_count,
          inline_count, snippet, raw_key, detail_key, from_search, to_search, cc_search,
          bcc_search, reply_to_search, search_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        row.id,
        row.message_id,
        row.is_read,
        row.from_json,
        row.to_json,
        row.cc_json,
        row.bcc_json,
        row.reply_to_json,
        row.return_path,
        row.subject,
        row.message_date,
        row.created_at,
        row.username,
        row.size,
        row.attachment_count,
        row.inline_count,
        row.snippet,
        row.raw_key,
        row.detail_key,
        row.from_search,
        row.to_search,
        row.cc_search,
        row.bcc_search,
        row.reply_to_search,
        row.search_text
      ),
      ...tags.map((tag) =>
        env.DB.prepare("INSERT INTO message_tags (message_id, tag) VALUES (?, ?)").bind(id, tag)
      ),
      env.DB.prepare(
        "INSERT INTO runtime_stats (key, value) VALUES ('accepted', 1) ON CONFLICT(key) DO UPDATE SET value = value + 1"
      ),
      env.DB.prepare(
        "INSERT INTO runtime_stats (key, value) VALUES ('accepted_bytes', ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value"
      ).bind(input.raw.byteLength)
    ];
    await env.DB.batch(statements);
    return rowToSummary(row, tags);
  } catch (error) {
    await env.MESSAGE_STORE.delete(storedKeys);
    throw error;
  }
}

export async function ingestForwardable(env: Env, message: ForwardableEmailMessage): Promise<MessageSummary> {
  const domain = message.to.split("@").at(-1)?.toLowerCase();
  if (domain !== env.INBOUND_DOMAIN.toLowerCase()) {
    throw new Error("Recipient is outside the Mailpit Cloudflare domain");
  }
  const raw = await new Response(message.raw).arrayBuffer();
  return ingestRawMessage(env, {
    raw,
    envelopeFrom: message.from,
    envelopeTo: message.to
  });
}

export async function recordRejected(env: Env): Promise<void> {
  await incrementStat(env.DB, "rejected", 1);
}
