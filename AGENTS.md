# Agent instructions

## Read first

Before changing behavior, read `PRODUCT.md`, `DESIGN.md`, `docs/architecture.md`, `docs/configuration.md`, `docs/mailpit-parity.md` and `docs/security.md`.

## Invariants

- Mailpit Cloudflare is an unofficial, provider-independent receiving inbox.
- Never add outbound delivery, relay or forwarding without a separate authenticated and allowlisted design.
- Never route Preview mail to a human recipient by default.
- Never expose messages, attachments or mutation APIs without authentication.
- Never enable Cloudflare Email Routing on an apex domain already used for human mail.
- Preserve `THIRD_PARTY_NOTICES.md`, `vendor/mailpit/LICENSE` and the pinned upstream commit.
- Do not commit real domains, Cloudflare resource IDs, secrets, messages or personal addresses.

## Configuration

- `mailpit-cloudflare.config.example.json` is the public contract.
- `mailpit-cloudflare.config.json` is instance-specific and ignored.
- `wrangler.generated.jsonc` is generated and ignored. Never edit it manually.
- `.dev.vars` contains local secrets and is ignored.
- Remote secrets belong in Cloudflare Worker secrets.

Run `npm run config:generate` after changing configuration code. Provisioning is plan-only unless the caller explicitly supplies `--apply`.

## Commands

```bash
npm run ci
npm run doctor
npm run db:migrate:local
npm run dev
```

Remote deployment, resource creation and Email Routing changes require explicit authorization. Inspect existing resources and apex MX records before mutation.

## UI

Preserve Mailpit's compact information architecture and familiar workflows. Hide unsupported controls rather than presenting decorative or nonfunctional UI. Keep desktop density, keyboard behavior, mobile containment, empty states and errors coherent.
