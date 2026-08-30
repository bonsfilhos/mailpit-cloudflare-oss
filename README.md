# Mailpit Cloudflare

Mailpit Cloudflare is an unofficial, Cloudflare-native inbox for testing email sent by real Preview and staging environments.

It receives public SMTP delivery through Cloudflare Email Routing, stores searchable metadata in D1 and MIME bodies and attachments in R2, and exposes a Mailpit-compatible web interface and REST API. It is independent of the sending provider.

## Capabilities

- Public internet delivery through a dedicated Email Routing subdomain.
- Search, tags, read state, raw MIME, HTML, text and attachments.
- Mailpit-compatible API subset for automated assertions.
- D1, R2 and Durable Object storage on Cloudflare.
- Worker-level HTTP Basic authentication.
- Automatic retention by age and message count.
- No outbound sending, relay or dependency on Resend.

## Local quickstart

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run config:generate
npm run db:migrate:local
npm run dev
```

Without an instance configuration, local commands use `mailpit-cloudflare.config.example.json`. Copy it to the ignored `mailpit-cloudflare.config.json` when you need custom values.

The example `.dev.vars` disables Basic authentication only for local development. Generated deployment configuration always requires authentication.

Inject local mail through the optional HTTP endpoint after setting `INGEST_TOKEN` in `.dev.vars`:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/send \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local-development' \
  -d '{"From":{"Email":"sender@example.com"},"To":[{"Email":"preview@preview-mail.example.com"}],"Subject":"Smoke test","Text":"Hello"}'
```

Wrangler reads `.dev.vars` when the local server starts. Restart `npm run dev` after changing it.

## Cloudflare installation

```bash
cp mailpit-cloudflare.config.example.json mailpit-cloudflare.config.json
# Edit the copied file.
npm run setup:cloudflare -- --config mailpit-cloudflare.config.json
npm run setup:cloudflare -- --config mailpit-cloudflare.config.json --apply
npx wrangler secret put BASIC_AUTH_PASSWORD --config wrangler.generated.jsonc
npm run deploy
```

The first setup command is a plan and changes nothing. `--apply` creates or reuses D1 and R2, records the D1 ID only in the ignored instance configuration, and applies migrations. Email Routing remains a deliberate dashboard step.

Continue with the [agent quickstart](docs/agent-quickstart.md) or the [deployment guide](docs/deployment.md).

## Configuration and safety

- Public example: `mailpit-cloudflare.config.example.json`
- Local instance values: `mailpit-cloudflare.config.json` (ignored)
- Generated Wrangler file: `wrangler.generated.jsonc` (ignored)
- Local secrets: `.dev.vars` (ignored)
- Remote secrets: Cloudflare Worker secrets

Never enable Email Routing on an apex domain that already receives human mail. Use a dedicated subdomain and preserve the apex MX records.

## Validation

```bash
npm run ci
npm run doctor
npm run doctor -- --config mailpit-cloudflare.config.json --remote
npm run verify:routing -- --config mailpit-cloudflare.config.json
```

## Documentation

- [Agent quickstart](docs/agent-quickstart.md)
- [Configuration](docs/configuration.md)
- [Deployment](docs/deployment.md)
- [Architecture](docs/architecture.md)
- [Email Routing](docs/email-routing.md)
- [Product integration](docs/integration.md)
- [Operations](docs/operations.md)
- [Security](docs/security.md)
- [Mailpit parity](docs/mailpit-parity.md)

## Upstream and license

The Vue interface is derived from [Mailpit](https://github.com/axllent/mailpit) under the MIT license. The exact upstream commit and preserved notice are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Mailpit Cloudflare is an independent project. It is not maintained, endorsed or distributed by the Mailpit project.

Released under the [MIT License](LICENSE).
