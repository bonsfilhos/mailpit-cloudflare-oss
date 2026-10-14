# Architecture

```text
Application's normal email provider
  -> public SMTP
  -> *@<dedicated inbound subdomain>
  -> Cloudflare Email Routing catch-all
  -> Email Worker
  -> D1 metadata and search index
  -> private R2 MIME bodies and attachments

Authenticated browser or test runner
  -> Worker UI/API
  -> D1 and R2
  -> Durable Object WebSocket events
```

## Boundaries

- `src/worker`: HTTP API, Email Worker, storage and retention.
- `src/ui`: Vue interface derived from Mailpit.
- `public`: static shell and product-owned assets.
- `migrations`: D1 schema.
- `scripts`: configuration, provisioning, diagnosis and build orchestration.

## Storage

D1 contains searchable summaries, tags, state and storage keys. R2 contains immutable raw MIME, parsed message detail and attachment bytes. The R2 bucket remains private and is reachable only through authenticated Worker routes.

## Authentication

Browser navigation uses a native `/login` form with the existing Basic Auth credential and configured inbox label. Successful POST redirects only to a validated internal path. A Secure/HttpOnly/SameSite=Strict `__Host-cloudpit_session` cookie has an absolute 12-hour lifetime; D1 stores only its opaque token hash, CSRF token and expiration in `browser_sessions`. Logout deletes the session and closes its event sockets.

Login has a ten-minute signed prelogin CSRF cookie. HMAC-SHA256 signatures use separate domain labels and the existing Worker password secret, requiring no new secret. Changing username/password invalidates cookies. Browser mutations require exact Origin plus the session CSRF token; the detail GET that marks messages read also requires CSRF, with same-origin Fetch Metadata when browsers omit Origin. Event handshakes validate Origin; socket attachments and alarms enforce expiry. HTML uses Referrer-Policy same-origin to preserve native form Origin without disclosing referrers to external sites.

HTTP Basic remains available to machine clients without browser Origin/Fetch Metadata. Browser requests never receive a Basic challenge. HTTP ingestion uses a separate optional bearer secret. Public inbound email is constrained by the configured recipient domain. Static assets and health contain no captured content and remain public.

Cloudflare Access may replace or sit in front of Basic Auth, but is not a runtime dependency.

## Instance separation

Reusable source contains no active infrastructure. Each installation owns an ignored instance configuration, generated Wrangler file, Cloudflare resources and routing rules.

The event hub persists revoked browser-session hashes with their original expiration in its existing Durable Object storage. Both the delayed handshake and broadcast paths consult those records. Storage transactions preserve deadlines and remove only expired records; alarms cover sockets and revocation cleanup. No additional Cloudflare resource or migration is required.
