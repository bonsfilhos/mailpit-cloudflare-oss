# Email Routing

## Domain plan

```text
example.com               existing human mail; unchanged
preview-mail.example.com  Cloudflare Email Routing; test mail only
```

Never enable Email Routing on an apex domain already used by Google Workspace or another human mail provider. Use a dedicated subdomain.

## Before changing DNS

1. Record the exact apex MX set.
2. Store it in `dns.expectedApexMx` when it must remain invariant.
3. Confirm the inbound subdomain is different from sending Return-Path domains.
4. Confirm no human address uses the inbound subdomain.

## Routing

1. Add the configured inbound subdomain in Cloudflare Email Routing.
2. Let Cloudflare create the subdomain MX and SPF records.
3. Create a catch-all rule for the subdomain.
4. Route the catch-all to the deployed Worker.
5. Preserve plus-addressing.
6. Run `npm run verify:routing -- --config mailpit-cloudflare.config.json`.

The catch-all accepts every local part. Use `<project>+<environment>+<scenario>@<inbound-domain>` to derive tags, not to select routing rules.

Mailpit Cloudflare does not require an outbound provider. Senders continue using their existing provider or SMTP server.
