# Configuration

`mailpit-cloudflare.config.json` is the instance source of truth. It is ignored by Git. `npm run config:generate` produces the ignored `wrangler.generated.jsonc` consumed by Wrangler.

## Worker

| Field | Purpose |
| --- | --- |
| `name` | Cloudflare Worker name |
| `compatibilityDate` | Pinned Workers compatibility date |
| `inboxLabel` | Label shown in the UI |
| `inboundDomain` | Dedicated Email Routing subdomain |
| `webHostname` | Optional custom hostname for UI/API |
| `workersDev` | Enable the `workers.dev` route |
| `basicAuthUsername` | Non-secret Basic Auth username |
| `authRequired` | Must remain `true` for generated deployments |
| `retentionDays` | Maximum message age |
| `maxMessages` | Maximum retained message summaries |
| `maxMessageBytes` | Maximum accepted MIME size |
| `cron` | Retention schedule |
| `eventLocation` | Durable Object placement hint |
| `observability` | Worker observability and trace sampling |
| `sourceRepositoryUrl` | Source and documentation link shown in the UI |

## Cloudflare resources

| Field | Purpose |
| --- | --- |
| `d1DatabaseName` | D1 resource name |
| `d1DatabaseId` | D1 UUID; populated by setup and never committed |
| `d1Location` | D1 placement hint |
| `r2BucketName` | Private R2 bucket name |
| `r2Location` | R2 placement hint |

## DNS guardrail

| Field | Purpose |
| --- | --- |
| `apexDomain` | Parent domain whose mail must remain intact |
| `expectedApexMx` | Optional exact MX baseline checked before and after routing changes |

Leave `expectedApexMx` empty only when no exact invariant is required. Production operators should record the current apex MX set.

## Secrets

| Secret | Required | Purpose |
| --- | --- | --- |
| `BASIC_AUTH_PASSWORD` | Yes remotely | UI and read/mutation API authentication |
| `INGEST_TOKEN` | No | Optional authenticated HTTP ingestion |

Local secrets belong in `.dev.vars`; remote secrets belong in Cloudflare. Never place secret values in instance JSON or generated Wrangler configuration.
