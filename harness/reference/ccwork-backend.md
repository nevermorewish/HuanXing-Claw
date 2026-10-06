# ccwork backend integration

Default origin: `https://ccwork.site`. Custom HTTPS deployments and local HTTP
development servers are supported by the account dialog. `/api` is appended
exactly once. ccwork source is read-only reference, not a dependency to edit.

Authentication uses `/api/auth/login`, `/register`, `/send-verification-code`,
`/refresh-token`, and `/logout`. Login/registration return `{success, data}` with
`access_token`, `refresh_token`, `expires_in`, and a user whose ID is a UUID.
Registration sends `email` or an 11-digit mainland China `phone`, `password`, and
`verification_code`. Code sending uses `username` and `code_type: register`.
Registration restrictions, validation, and rate limits remain server-owned.

`GET /api/context/organizations?type=personal` returns `data.organizations`.
The personal organization's UUID scopes catalog, wallet, consumption and calls.
`GET /api/services/llm/organizations/{id}/models` returns `data.models` including
UUID `id`, display/model names, routing state, `can_set_as_user_default`, context
and output limits, and vision support. Do not route by a model display name.

`GET /api/wallet/organizations/{id}/wallet` returns decimal strings including
`available_credits_precise` and `credits_frozen_precise`. Consumption uses
`GET /api/wallet/organizations/{id}/transactions?transaction_type=consume&limit=20&offset=0`
with `data.total` and `data.transactions`. These credits are not USD or tokens.

`POST /api/llm/proxy` accepts OpenAI chat request bodies and always streams.
Authorization is a user JWT; `X-TabTin-Organization-Id` selects the organization.
The proxy normalizes native provider responses into OpenAI deltas. It also emits
informational events, `{error: ...}` SSE errors, then `event: tabtin.billing` with
`charge_status` (`success`, `byok_exempt`, or `failed`) and finally `[DONE]`.
The Claw relay withholds terminal finish/usage frames until this tail settles.
Non-stream callers receive an aggregated OpenAI completion after settlement.
No client-calculated bill or extra charging endpoint is used. Agent job billing
idempotency headers are intentionally omitted: ccwork requires those keys to
identify an existing trusted backend job, which Claw sessions do not create.

The relay binds only to 127.0.0.1, requires an unpredictable local credential,
rejects browser Origin headers, forwards only the fixed proxy path, cancels
upstream when clients disconnect, and stores no JWT in OpenClaw's config. On
startup, the saved account provider is rebound to the new relay address/key before
Gateway starts. Legacy account passwords and direct account provider keys are
removed during migration. The selected default/fallback chain uses only ccwork.
Saving also updates existing agent overrides and the default model allowlist to
the selected account models. Chat and Agent selectors show server model names
and submit ccwork UUID references; Main rejects non-account Agent model refs.
Main also rejects chat prompts before ccwork login and account-model selection,
so old direct-provider defaults cannot be used while the user is logged out.

The CCWorkClaw build has separate app identity, data directory, provider key,
executable and icons. Its update-feed URL is a packaging setting; this integration
does not publish installers or create a server-side download/update feed.
