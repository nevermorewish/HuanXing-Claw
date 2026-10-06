---
id: connect-ccwork-backend
title: Connect Claw accounts and billed model calls to ccwork
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace legacy New-API account authentication with ccwork JWT, catalog, wallet, and billed LLM proxy without modifying ccwork.
touchedAreas:
  - electron/**
  - src/**
  - shared/**
  - brands/**
  - resources/brands/**
  - tests/**
  - harness/**
  - README*.md
expectedUserBehavior:
  - Users log in with a verification code by default, or with a password, or register; all three run against their ccwork server.
  - Signing in enables every routable model from the personal ccwork organization without a per-model selection step.
  - Credit balances and transactions come from the personal ccwork organization.
  - Account model calls including tools and streaming run through ccwork billing.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/account-session.test.ts
  - tests/unit/ccwork-relay.test.ts
  - tests/e2e/account-login.spec.ts
  - tests/unit/ccwork-account-api.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/unit/fork-config-coordinator.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/ccwork-chat-api.test.ts
acceptance:
  - No ccwork source files are changed.
  - JWT credentials stay in Main and are encrypted on disk; logout revokes local access.
  - Model UUIDs and capabilities are preserved and billing failures are surfaced.
  - Renderer accesses backend services through host-api.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Use the existing ccwork /api/auth, /api/context, /api/services/llm,
/api/wallet and /api/llm/proxy contracts. The loopback compatibility relay
for OpenClaw must never forward runtime keys or permit arbitrary upstream URLs.
ccwork is a read-only reference at D:\tabtin\ccwork. Billing and settlement
remain server-owned; no local transcript-based credit charging.
