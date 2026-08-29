import { createHash } from "node:crypto";
import { addressParser, type Address as PostalAddress, type Email as ParsedEmail } from "postal-mime";
import type {
  AttachmentChecksums,
  MailAddress,
  SendApiAddress,
  SendApiAttachment,
  SendApiPayload
} from "./types";

const CRLF = "\r\n";

export function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(content);
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function checksum(bytes: Uint8Array): AttachmentChecksums {
  return {
    MD5: createHash("md5").update(bytes).digest("hex"),
    SHA1: createHash("sha1").update(bytes).digest("hex"),
    SHA256: createHash("sha256").update(bytes).digest("hex")
  };
}

export function flattenPostalAddresses(addresses?: PostalAddress[]): MailAddress[] {
  const result: MailAddress[] = [];
  for (const item of addresses ?? []) {
    if ("group" in item && item.group) {
      result.push(...item.group.map(toMailAddress));
    } else if (item.address) {
      result.push(toMailAddress(item));
    }
  }
  return result;
}

function toMailAddress(address: { name?: string; address: string }): MailAddress {
  return { Name: address.name ?? "", Address: address.address };
}

export function parseAddressMetadata(value?: string): MailAddress[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => {
        if (typeof item === "string") return flattenPostalAddresses(addressParser(item));
        if (!item || typeof item !== "object") return [];
        const entry = item as Record<string, unknown>;
        const address = String(entry.Address ?? entry.address ?? entry.Email ?? entry.email ?? "").trim();
        if (!address) return [];
        return [{ Name: String(entry.Name ?? entry.name ?? ""), Address: address }];
      });
    }
  } catch {
    // Legacy adapters may send a regular RFC 5322 address list.
  }

  return flattenPostalAddresses(addressParser(value));
}

export function addressSearch(addresses: MailAddress[]): string {
  return addresses.map((address) => `${address.Name} ${address.Address}`.trim()).join(" ").toLowerCase();
}

export function headerMap(parsed: ParsedEmail): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const header of parsed.headers) {
    const key = header.originalKey || header.key;
    (result[key] ??= []).push(header.value);
  }
  return result;
}

export function firstHeader(parsed: ParsedEmail, name: string): string {
  const key = name.toLowerCase();
  return parsed.headers.find((header) => header.key === key)?.value ?? "";
}

export function normalizedTags(tags: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of tags) {
    const tag = value.trim().replace(/\s+/g, " ").slice(0, 80);
    if (tag) unique.set(tag.toLowerCase(), tag);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function tagsFromRecipient(recipient: string): string[] {
  const localPart = recipient.split("@", 1)[0] ?? "";
  return localPart
    .split("+")
    .map((part) => decodeURIComponent(part).trim().toLowerCase())
    .filter(Boolean);
}

export function messageSnippet(text: string, html: string): string {
  const source = text || html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return source.replace(/\s+/g, " ").trim().slice(0, 250);
}

export function listUnsubscribe(parsed: ParsedEmail) {
  const header = firstHeader(parsed, "list-unsubscribe");
  const headerPost = firstHeader(parsed, "list-unsubscribe-post");
  const links = [...header.matchAll(/<([^>]+)>/g)]
    .map((match) => match[1] ?? "")
    .filter((link) => /^(?:https?:|mailto:)/i.test(link))
    .slice(0, 2);
  return { Header: header, HeaderPost: headerPost, Links: links, Errors: "" };
}

function quoteDisplayName(name: string): string {
  const clean = name.replace(/[\r\n"]/g, " ").trim();
  return clean ? `"${clean.replace(/"/g, "\\\"")}" ` : "";
}

function formatApiAddress(address: SendApiAddress): string {
  return `${quoteDisplayName(address.Name ?? "")}<${address.Email.replace(/[\r\n<>]/g, "")}>`;
}

function foldBase64(value: string): string {
  return value.replace(/\s+/g, "").match(/.{1,76}/g)?.join(CRLF) ?? "";
}

function safeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function randomBoundary(prefix: string): string {
  return `mailpit-cloudflare-${prefix}-${crypto.randomUUID().replace(/-/g, "")}`;
}

function attachmentPart(boundary: string, attachment: SendApiAttachment): string {
  const filename = safeHeaderValue(attachment.Filename || "attachment.bin").replace(/"/g, "'");
  const contentType = safeHeaderValue(attachment.ContentType || "application/octet-stream");
  const disposition = attachment.ContentID ? "inline" : "attachment";
  const contentId = attachment.ContentID
    ? `${CRLF}Content-ID: <${safeHeaderValue(attachment.ContentID).replace(/[<>]/g, "")}>`
    : "";
  return [
    `--${boundary}`,
    `Content-Type: ${contentType}; name="${filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: ${disposition}; filename="${filename}"${contentId}`,
    "",
    foldBase64(attachment.Content)
  ].join(CRLF);
}

export function buildRawMime(payload: SendApiPayload): ArrayBuffer {
  const mixedBoundary = randomBoundary("mixed");
  const alternativeBoundary = randomBoundary("alternative");
  const headers: string[] = [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@mailpit-cloudflare.local>`,
    `From: ${formatApiAddress(payload.From)}`,
    `To: ${(payload.To ?? []).map(formatApiAddress).join(", ")}`,
    `Subject: ${safeHeaderValue(payload.Subject ?? "")}`,
    "MIME-Version: 1.0"
  ];
  if (payload.Cc?.length) headers.push(`Cc: ${payload.Cc.map(formatApiAddress).join(", ")}`);
  if (payload.Bcc?.length) headers.push(`Bcc: ${payload.Bcc.map(formatApiAddress).join(", ")}`);
  if (payload.ReplyTo?.length) headers.push(`Reply-To: ${payload.ReplyTo.map(formatApiAddress).join(", ")}`);
  if (payload.Tags?.length) headers.push(`X-Tags: ${payload.Tags.map(safeHeaderValue).join(", ")}`);
  for (const [name, rawValue] of Object.entries(payload.Headers ?? {})) {
    if (!/^[A-Za-z0-9-]+$/.test(name)) continue;
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      headers.push(`${name}: ${safeHeaderValue(value)}`);
    }
  }

  const bodyParts: string[] = [];
  if (payload.Text && payload.HTML) {
    bodyParts.push(
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      "",
      `--${alternativeBoundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      payload.Text,
      `--${alternativeBoundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      payload.HTML,
      `--${alternativeBoundary}--`
    );
  } else {
    const html = payload.HTML ?? "";
    bodyParts.push(
      `Content-Type: ${html ? "text/html" : "text/plain"}; charset=utf-8`,
      "Content-Transfer-Encoding: 8bit",
      "",
      html || payload.Text || ""
    );
  }

  let mime: string;
  if (payload.Attachments?.length) {
    mime = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      "",
      `--${mixedBoundary}`,
      ...bodyParts,
      ...payload.Attachments.map((attachment) => attachmentPart(mixedBoundary, attachment)),
      `--${mixedBoundary}--`,
      ""
    ].join(CRLF);
  } else {
    mime = [...headers, ...bodyParts, ""].join(CRLF);
  }
  return new TextEncoder().encode(mime).buffer;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
  }
  return btoa(binary);
}
