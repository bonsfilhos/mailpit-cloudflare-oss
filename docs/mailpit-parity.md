# Mailpit parity

Mailpit Cloudflare preserves the applicable Mailpit browser experience and API shapes while replacing the local SMTP/storage runtime with Cloudflare services.

| Mailpit capability | Mailpit Cloudflare |
| --- | --- |
| Message list and detail | Supported |
| Search and tags | Supported subset |
| HTML, text and headers | Supported |
| Raw MIME and attachments | Supported |
| Read/unread and deletion | Supported |
| Browser notifications and live updates | Supported |
| REST assertions | Supported subset |
| SMTP listener | Replaced by Cloudflare Email Routing |
| Persistent filesystem | Replaced by D1 and R2 |
| Message release/relay | Disabled |
| POP3 | Not supported |
| SMTP chaos | Not supported |
| SpamAssassin | Not supported |
| HTML compatibility scoring | Not supported |

Unsupported UI controls remain hidden. Compatibility endpoints may return `501` when preserving a predictable API surface is more useful than omitting the route.
