# Deployment

## 1. Prepare an instance

```bash
npm ci
cp mailpit-cloudflare.config.example.json mailpit-cloudflare.config.json
```

Edit the ignored copy. Use unique Worker, D1 and R2 names. Choose either `workersDev: true` or a `webHostname`.

Confirm that the selected DNS zone is not already using its catch-all for another destination. Cloudflare has one catch-all action per zone, even when the zone contains multiple Email Routing subdomains.

## 2. Authenticate and review

For an interactive installation, prefer `npx wrangler login`. For non-interactive automation, scope the API token to the target account and grant `Workers Scripts Write`, `D1 Edit` and `Workers R2 Storage Write`. A custom web hostname may also require `Workers Routes Write` on its zone. This repository does not automate Email Routing; separate routing automation requires zone-scoped `Zone Settings Write`, `DNS Write` and `Email Routing Rules Write`.

```bash
npx wrangler whoami
npm run setup:cloudflare -- --config mailpit-cloudflare.config.json
```

The setup command prints a plan and performs no remote mutation without `--apply`.
It also compares the live apex MX set with `dns.expectedApexMx` before either planning or provisioning.

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

Setup is resumable. If it stops after creating one resource, fix the reported cause and rerun the same command with the same configuration. Exact-name D1 and R2 resources are reused; inspect any pre-existing same-name R2 bucket before approving the first run. Automated deletion is intentionally unavailable.

## 4. Configure secrets

```bash
npx wrangler secret put BASIC_AUTH_PASSWORD --config wrangler.generated.jsonc
```

Set `INGEST_TOKEN` separately only when authenticated HTTP ingestion is required.

## 5. Deploy

```bash
npm run deploy
```

The command uses `doctor --remote --predeploy`: D1, R2, the required secret and any recorded apex MX invariant must pass, while the not-yet-created inbound MX is deferred. Confirm the UI/API endpoint requires authentication.

## 6. Configure inbound routing

Follow [email-routing.md](email-routing.md). Route only the dedicated inbound subdomain catch-all to the Worker.

## 7. Verify

```bash
npm run verify:routing -- --config mailpit-cloudflare.config.json
npm run doctor -- --config mailpit-cloudflare.config.json --remote
```

The final diagnosis is intentionally stricter than the pre-deploy diagnosis and requires the inbound MX to resolve.

Send one unique external message and complete the smoke test in [operations.md](operations.md).
