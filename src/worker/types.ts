import type { Email as ParsedEmail } from "postal-mime";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MESSAGE_STORE: R2Bucket;
  EVENTS: DurableObjectNamespace;
  INBOUND_DOMAIN: string;
  INBOX_LABEL: string;
  SOURCE_REPOSITORY_URL: string;
  EVENT_LOCATION_HINT: DurableObjectLocationHint;
  MAX_MESSAGES: string;
  RETENTION_DAYS: string;
  MAX_MESSAGE_BYTES?: string;
  AUTH_REQUIRED?: string;
  BASIC_AUTH_USERNAME?: string;
  BASIC_AUTH_PASSWORD?: string;
  INGEST_TOKEN?: string;
}

export interface MailAddress {
  Name: string;
  Address: string;
}

export interface AttachmentChecksums {
  MD5: string;
  SHA1: string;
  SHA256: string;
}

export interface StoredAttachment {
  PartID: string;
  FileName: string;
  ContentType: string;
  ContentID: string;
  Size: number;
  Checksums: AttachmentChecksums;
  ObjectKey: string;
  Disposition: "inline" | "attachment";
}

export interface ListUnsubscribe {
  Header: string;
  HeaderPost: string;
  Links: string[];
  Errors: string;
}

export interface StoredMessageDetail {
  ID: string;
  MessageID: string;
  From: MailAddress | null;
  To: MailAddress[];
  Cc: MailAddress[];
  Bcc: MailAddress[];
  ReplyTo: MailAddress[];
  ReturnPath: string;
  Subject: string;
  ListUnsubscribe: ListUnsubscribe;
  Date: string;
  Tags: string[];
  Username: string;
  Text: string;
  HTML: string;
  Size: number;
  Inline: StoredAttachment[];
  Attachments: StoredAttachment[];
  OtherParts: StoredAttachment[];
  Headers: Record<string, string[]>;
}

export interface MessageSummary {
  ID: string;
  MessageID: string;
  Read: boolean;
  From: MailAddress | null;
  To: MailAddress[];
  Cc: MailAddress[];
  Bcc: MailAddress[];
  ReplyTo: MailAddress[];
  Subject: string;
  Created: string;
  Username: string;
  Tags: string[];
  Size: number;
  Attachments: number;
  Snippet: string;
}

export interface MessageRow {
  id: string;
  message_id: string;
  is_read: number;
  from_json: string;
  to_json: string;
  cc_json: string;
  bcc_json: string;
  reply_to_json: string;
  return_path: string;
  subject: string;
  message_date: string;
  created_at: string;
  username: string;
  size: number;
  attachment_count: number;
  inline_count: number;
  snippet: string;
  raw_key: string;
  detail_key: string;
  from_search: string;
  to_search: string;
  cc_search: string;
  bcc_search: string;
  reply_to_search: string;
  search_text: string;
}

export interface IngestInput {
  raw: ArrayBuffer;
  envelopeFrom: string;
  envelopeTo: string;
  parsed?: ParsedEmail;
  username?: string;
  extraTags?: string[];
}

export interface SearchClause {
  sql: string;
  params: unknown[];
}

export interface SendApiAddress {
  Name?: string;
  Email: string;
}

export interface SendApiAttachment {
  Filename?: string;
  ContentType?: string;
  ContentID?: string;
  Content: string;
}

export interface SendApiPayload {
  From: SendApiAddress;
  To?: SendApiAddress[];
  Cc?: SendApiAddress[];
  Bcc?: SendApiAddress[];
  ReplyTo?: SendApiAddress[];
  Subject?: string;
  Text?: string;
  HTML?: string;
  Tags?: string[];
  Headers?: Record<string, string | string[]>;
  Attachments?: SendApiAttachment[];
}

export interface EventPayload {
  Type: "new" | "update" | "delete" | "truncate" | "prune" | "stats" | "error";
  Data?: unknown;
}
