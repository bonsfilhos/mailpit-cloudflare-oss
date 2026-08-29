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

Worker-level HTTP Basic Auth protects UI and read/mutation APIs. HTTP ingestion uses a separate optional bearer secret. Public inbound email is constrained by the configured recipient domain.

Cloudflare Access may replace or sit in front of Basic Auth, but is not a runtime dependency.

## Instance separation

Reusable source contains no active infrastructure. Each installation owns an ignored instance configuration, generated Wrangler file, Cloudflare resources and routing rules.
