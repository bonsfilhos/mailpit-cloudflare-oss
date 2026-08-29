# Product integration

Mailpit Cloudflare is a receiving inbox, not an outbound provider. Applications continue rendering and submitting mail through their normal delivery path.

## Adapter contract

1. Render the complete message normally.
2. Preserve intended recipients as optional metadata.
3. Replace every envelope recipient with one Mailpit Cloudflare address.
4. Submit through the normal outbound path.
5. Locate and assert the message in the authenticated API.

Never mix a Mailpit Cloudflare envelope recipient with a real human envelope recipient.

## Address convention

```text
<project>+<environment>+<scenario>@<inbound-domain>
```

## Optional metadata headers

```text
X-Mailpit-Cloudflare-Project
X-Mailpit-Cloudflare-Environment
X-Mailpit-Cloudflare-Original-To
X-Mailpit-Cloudflare-Original-Cc
X-Mailpit-Cloudflare-Original-Bcc
X-Tags
```

Original recipient headers accept an RFC 5322 address list or a JSON array of address objects. They affect display only and never cause forwarding.

## API assertions

The read API uses the same HTTP Basic Auth as the inbox. Query by recipient, sender, subject, message ID, tag or body.

`POST /api/v1/send` exists only for automation that cannot send SMTP. It requires the separate `INGEST_TOKEN` and is disabled when that secret is absent.

Preview adapters must fail closed when enabled without an explicit target. Production must never redirect customer mail to Mailpit Cloudflare.
