# Security architecture

## Threat model

Captured messages may contain magic links, personal data, payment context and attachments. Treat the inbox as production-sensitive even when it receives only test traffic.

## Controls

- Native login reuses the existing credential with standard username/password fields and password-manager autocomplete. Sessions use Secure/HttpOnly/SameSite=Strict host-only cookies and expire after an absolute 12 hours.
- D1 stores opaque token hashes, CSRF tokens and expirations, never credentials. Prelogin and session cookies use domain-separated HMAC-SHA256 with the existing password secret; no new secret is needed.
- Login/logout require exact Origin, without trusting forwarded headers or accepting Origin:null. Login also validates a signed ten-minute prelogin CSRF cookie. Cookie mutations require session CSRF; detail GET/HEAD also require CSRF because detail GET changes read state. Same-origin Fetch Metadata covers reads where Origin is omitted.
- Login/inbox HTML uses Referrer-Policy same-origin so native POSTs retain Origin; external sites receive no referrer. Login, authenticated responses and redirects are private/no-store.
- API Basic is preserved for machine clients without Origin/Fetch Metadata. Cached browser Basic credentials cannot bypass cookie/CSRF boundaries. HTTP ingestion keeps its separate bearer credential.
- Event sockets validate the browser's Origin and authenticated session, expire through Durable Object alarms and skip broadcasts after expiry. Logout revokes the D1 session and its sockets, including other tabs. Machine Basic event connections preserve their previous lifetime.
- Password/username rotation invalidates cookies. Already-open sockets expire at their original deadline or close on explicit logout. Passwords/session credentials never enter URLs, frontend storage or rendered HTML.
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

## Public-ingress cost boundary

The inbound catch-all is intentionally reachable by arbitrary SMTP senders. Retention, maximum message count and maximum message size bound stored data but do not eliminate request consumption. Monitor Workers, D1 and R2 usage, keep limits conservative and disable unused routing rules.

## Session revocation ordering

Logout sends the original session expiration to the event hub. The Durable Object stores a revocation record in its existing durable storage until that deadline, rejecting authenticated handshakes that arrive after logout and withholding subsequent broadcasts. Recreating or hibernating the object cannot forget the record. Old revocation requests without a deadline retain a full 12-hour TTL; repeated revocation never shortens an existing deadline. Cleanup runs transactionally and schedules the earliest socket or revocation expiration. Default storage input/output gates remain enabled.

Raw MIME is fetched lazily through the authenticated API and displayed as escaped text, without an iframe or HTML execution. Message changes invalidate pending loads. Raw download preserves the immutable MIME and the Worker continues to set X-Frame-Options DENY.
