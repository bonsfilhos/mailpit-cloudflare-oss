# Operations

## Preflight

```bash
npm run ci
npm run doctor -- --config mailpit-cloudflare.config.json --remote
npm run db:migrations:remote
```

Inspect pending migrations before deployment.

## Deploy

```bash
npm run deploy
```

Deployment does not create or replace Email Routing rules.

## Smoke test

1. Confirm the inbox returns `401` without credentials.
2. Authenticate and confirm an empty or expected mailbox.
3. Send a unique message from an external provider to the inbound subdomain.
4. Confirm envelope metadata, intended recipients, tags, HTML, text, raw MIME and attachments.
5. Confirm API search locates the message.
6. Check Worker errors and D1/R2 availability.

## Retention

The cron applies both `retentionDays` and `maxMessages`. Deleting or pruning a message removes its D1 index and schedules deletion of corresponding R2 objects.

## Secret rotation

```bash
npx wrangler secret put BASIC_AUTH_PASSWORD --config wrangler.generated.jsonc
```

Rotate the password atomically with every authorized client. Never place it in shell history, documentation or versioned configuration.

## Recovery

1. Restore the ignored instance configuration from the operator's secret/config store.
2. Regenerate Wrangler configuration.
3. Recreate D1/R2 only when confirmed absent.
4. Apply migrations.
5. Restore Worker secrets.
6. Deploy.
7. Reconnect the existing Email Routing catch-all.

Resource deletion is not part of automated setup or recovery.
