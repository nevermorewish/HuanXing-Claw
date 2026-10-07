---
id: ccwork-custom-recharge
title: Fix CCWork credit amount selection and recharge layout
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Support preset and custom CNY amounts through the Main-owned wallet API.
touchedAreas:
  - src/components/account/RechargeDialog.tsx
  - src/lib/host-api.ts
  - electron/services/account-api.ts
  - electron/utils/account-session.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/**
  - shared/brand/active.generated.ts
  - tests/unit/ccwork-recharge.test.tsx
  - tests/unit/ccwork-account-api.test.ts
  - tests/e2e/account-login.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/**
expectedUserBehavior:
  - Users choose CNY 10, 20, 50, 100, 200 or type a custom amount.
  - The dialog fits the window and all amount inputs remain editable.
  - Confirmed payments refresh the personal organization credit balance.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/ccwork-recharge.test.tsx
  - tests/unit/ccwork-account-api.test.ts
  - tests/e2e/account-login.spec.ts
acceptance:
  - Main sends amount_cny without requiring package_id for custom amounts.
  - Backend owns conversion rates and credit grants.
  - Invalid monetary inputs cannot create orders.
  - Renderer uses hostApi exclusively.
docs:
  required: true
---

Verify preset and custom payments, editable inputs, narrow layout and balance refresh.
