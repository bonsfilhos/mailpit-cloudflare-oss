# Security architecture

## Threat model

Captured messages may contain magic links, personal data, payment context and attachments. Treat the inbox as production-sensitive even when it receives only test traffic.

## Controls

- Worker-level authentication protects UI and read/mutation APIs.
- Optional HTTP ingestion uses a distinct bearer secret.
- The Email Worker accepts only the configured inbound domain.
- HTML is sanitized and rendered in a sandboxed iframe.
- Raw HTML uses a restrictive Content Security Policy.
- Active attachment formats download instead of rendering inline.
- Link checks reject local, private, link-local and metadata destinations.
- R2 is private and served only through authenticated routes.
- Retention is bounded by age and count.
- Logs must not contain bodies, magic links, authorization headers or attachment data.

## Public-source boundary

Public source may contain variable names, resource naming examples and the non-secret authentication design. It must not contain active resource IDs, real domains, captured messages, passwords, API tokens or personal addresses.

## Access hardening

Use a strong generated Basic Auth password. For exposed or multi-user installations, add Cloudflare Access and rate limiting. Rotate credentials when access changes or instance configuration has been disclosed.

## Outbound policy

Mailpit Cloudflare does not send, release, relay or forward mail. Any future outbound transport requires a separate threat model, authentication and recipient allowlist.

## DNS safety

Email Routing is subdomain-only. Record and verify the apex MX set before and after routing changes. Automated setup never mutates Email Routing or DNS.
