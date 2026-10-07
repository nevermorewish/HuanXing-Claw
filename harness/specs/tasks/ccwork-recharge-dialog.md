---
id: ccwork-recharge-dialog
title: CCWork recharge dialog and account menu
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Port CCWork credit package checkout into the desktop account menu through Main-owned authenticated APIs.
touchedAreas:
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - tests/**
  - package.json
  - pnpm-lock.yaml
  - shared/i18n/**
  - src/components/account/**
  - src/components/layout/Sidebar.tsx
  - src/stores/account.ts
  - src/lib/host-api.ts
  - electron/services/account-api.ts
  - electron/utils/account-session.ts
  - shared/host-api/contract.ts
expectedUserBehavior:
  - Clicking the footer account opens a menu with settings, usage, recharge and logout.
  - Recharge opens a local dialog, shows credit packages and payment QR codes, and refreshes credits after confirmed payment.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/ccwork-account-api.test.ts
  - tests/unit/ccwork-recharge.test.tsx
acceptance:
  - Renderer uses host-api and never receives JWT credentials.
  - Closing and reopening checkout preserves a pending order.
  - Paid and completed orders refresh balance; errors and expired orders do not claim success.
docs:
  required: true
---

Validate checkout with mocked payment APIs, never live money movement. Follow harness/reference/ccwork-backend.md for the authenticated account boundary.
