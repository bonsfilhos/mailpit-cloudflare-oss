# Agent quickstart

## Goal

Install one isolated Mailpit Cloudflare instance without modifying the apex domain's existing mail service.

## Preconditions

- Node.js 24 or compatible.
- A Cloudflare account with Workers, D1, R2 and a DNS zone.
- Wrangler authenticated with the intended Cloudflare account.
- A dedicated inbound subdomain.
- A DNS zone whose single Email Routing catch-all is not assigned to another inbox.
- Explicit authorization before creating resources, deploying or changing Email Routing.

## Safe sequence

```bash
npm ci
cp mailpit-cloudflare.config.example.json mailpit-cloudflare.config.json
```

Edit only `mailpit-cloudflare.config.json`. Then:

```bash
npm run config:generate
npm run doctor
npm run setup:cloudflare -- --config mailpit-cloudflare.config.json
```

The setup command must report `"mode": "plan"`. Review exact Worker, D1, R2 and domains. With authorization:

```bash
npm run setup:cloudflare -- --config mailpit-cloudflare.config.json --apply
npx wrangler secret put BASIC_AUTH_PASSWORD --config wrangler.generated.jsonc
npm run deploy
```

The deploy command runs a remote pre-deploy diagnosis. It verifies storage, the required secret and the recorded apex MX invariant, but deliberately defers the new inbound MX because Email Routing is configured only after the Worker exists.

Configure the inbound subdomain and catch-all in Cloudflare Email Routing only after recording the apex MX set. Then:

```bash
npm run verify:routing -- --config mailpit-cloudflare.config.json
npm run doctor -- --config mailpit-cloudflare.config.json --remote
```

## Expected state

- `mailpit-cloudflare.config.json` contains the provisioned D1 ID and remains ignored.
- `wrangler.generated.jsonc` matches the instance configuration and remains ignored.
- `BASIC_AUTH_PASSWORD` exists only as a Worker secret.
- D1 and R2 exist under the configured names.
- The inbound subdomain uses Cloudflare Email Routing MX/SPF.
- The apex MX set is unchanged.
- The inbox returns `401` without credentials.
- A unique external test message appears through the public MX path.

## Stop conditions

Stop before mutation when:

- the authenticated Cloudflare account is ambiguous;
- a resource name exists with a different D1 ID;
- inbound and apex domains are equal;
- apex MX records differ from the recorded set;
- authentication is disabled;
- the task would route email to a human recipient.
- the zone catch-all already belongs to another Worker or destination.

Do not infer permission to delete resources, replace routing rules or deploy over an existing Worker.
