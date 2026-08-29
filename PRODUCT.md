# Product contract

## Product

Mailpit Cloudflare is a protected inbox for receiving and inspecting real internet email sent to test environments. It is provider-independent and runs on Cloudflare.

## Users

- Developers validating templates and delivery integrations.
- Reviewers following test links and transactional flows.
- Operators diagnosing headers, recipients, attachments and rendering.

## Primary job

Send a non-production email through the application's normal public delivery chain, capture it before any human receives it, and inspect or assert the resulting message.

## Surfaces

- Authenticated web inbox.
- Mailpit-compatible REST API subset.
- Public Cloudflare Email Worker for inbound delivery.
- Public health endpoint without message data.

## Invariants

1. Any standards-compliant sender can deliver to the configured inbound domain.
2. Original intended recipients are metadata and never forwarding targets.
3. Email Routing uses a dedicated subdomain.
4. Existing apex MX records remain untouched.
5. Message access and mutation require authentication.
6. The application does not send or relay email.
7. Raw MIME is immutable; read state, tags and retention metadata may change.
8. Messages expire automatically.
