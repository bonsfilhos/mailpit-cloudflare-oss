---
product: mailpit-cloudflare
surface: operational-app
density: compact
radius: restrained
motion: minimal
---

# Design contract

## Direction

Mailpit Cloudflare is a dense developer utility. Its interface intentionally preserves Mailpit's information architecture and interaction model so existing users require little retraining.

Visual position: compact, neutral, diagnostic and trustworthy.

## Layout

- Desktop uses a persistent mailbox rail and high-density message lists.
- Mobile contains content naturally and uses off-canvas navigation.
- Tables and lists are preferred over cards for repeated operational data.
- Modals are limited to settings, metadata and focused actions.
- Empty, loading, error and disconnected states must remain explicit.

## Tokens

- Bootstrap semantic roles remain the source of truth.
- Primary color identifies navigation and active controls.
- Success, warning and danger are reserved for actual state.
- Typography prioritizes message metadata and body readability.
- Motion is functional and short; no decorative animation.

## Components

- Reuse the derived Mailpit Vue components where behavior matches.
- Add product-owned components only for Cloudflare-specific behavior.
- Unsupported Mailpit capabilities must be hidden or return an explicit API error.
- Preserve keyboard focus, readable contrast and sanitized message rendering.

## Voice

Labels and errors are direct, technical and actionable. Do not describe unavailable behavior as future functionality inside the primary workflow.

## Avoid

- Marketing layouts inside the inbox.
- Decorative cards or gradients.
- Provider-specific assumptions.
- Bons Filhos or instance-specific identity in reusable UI.
- Controls that imply outbound sending or relay.
