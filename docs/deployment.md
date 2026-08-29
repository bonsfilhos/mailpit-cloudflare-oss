# Deployment

## 1. Prepare an instance

```bash
npm ci
cp mailpit-cloudflare.config.example.json mailpit-cloudflare.config.json
```

Edit the ignored copy. Use unique Worker, D1 and R2 names. Choose either `workersDev: true` or a `webHostname`.

## 2. Authenticate and review

```bash
npx wrangler whoami
npm run setup:cloudflare -- --config mailpit-cloudflare.config.json
```

The setup command prints a plan and performs no remote mutation without `--apply`.

## 3. Provision storage

```bash
npm run setup:cloudflare -- --config mailpit-cloudflare.config.json --apply
```

This operation:

- creates or reuses the configured D1 database;
- refuses a same-name D1 database with a conflicting ID;
- creates or reuses the configured R2 bucket;
- writes the D1 ID only to the ignored instance configuration;
- regenerates Wrangler configuration;
- applies D1 migrations.

It does not deploy the Worker, create secrets, change DNS or configure Email Routing.

## 4. Configure secrets

```bash
npx wrangler secret put BASIC_AUTH_PASSWORD --config wrangler.generated.jsonc
```

Set `INGEST_TOKEN` separately only when authenticated HTTP ingestion is required.

## 5. Deploy

```bash
npm run deploy
```

Confirm the UI/API endpoint requires authentication.

## 6. Configure inbound routing

Follow [email-routing.md](email-routing.md). Route only the dedicated inbound subdomain catch-all to the Worker.

## 7. Verify

```bash
npm run verify:routing -- --config mailpit-cloudflare.config.json
npm run doctor -- --config mailpit-cloudflare.config.json --remote
```

Send one unique external message and complete the smoke test in [operations.md](operations.md).
