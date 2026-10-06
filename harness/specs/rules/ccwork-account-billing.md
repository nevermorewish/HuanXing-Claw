---
id: ccwork-account-billing
title: ccwork Account And Billing Authority
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

ccwork account services use JWT authentication in Main. Persist rotating access
and refresh tokens only through Electron safeStorage, and keep sessions in memory
when OS encryption is unavailable. Never persist or return account passwords.
The account catalog uses ccwork model UUIDs and server capabilities; model names
are labels, not routing identifiers. Account providers route through an
authenticated loopback relay to `/api/llm/proxy` with the personal organization.
No direct-provider fallback may be added to the managed account fallback chain.
Saving account models also migrates existing agent model overrides. Chat and
Agent selectors offer only selected ccwork UUIDs; Main rejects other model refs.
Main requires account authentication and selected account models before chat sends.

Forward tools, multimodal content, reasoning, and usage without rewriting model
identity. Require successful backend billing settlement before emitting terminal
completion frames. Surface proxy and billing errors, and propagate cancellation
upstream. Do not retry billed requests except when the backend explicitly rejects
an expired access token before processing. Consumption comes from ccwork wallet
transactions; local transcript token estimates are diagnostic, not wallet charges.

Reference: [ccwork backend contracts](../../reference/ccwork-backend.md).
