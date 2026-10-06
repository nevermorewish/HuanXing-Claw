---
id: sync-upstream-v0.6.0
title: Sync ClawX v0.6.0 while preserving DeepClaw fork integration
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Merge upstream main at c8a54dcd with existing branding, account services, provider management, and release integration.
touchedAreas:
  - electron/**
  - src/**
  - shared/**
  - scripts/**
  - tests/**
  - .github/**
  - harness/**
  - docs/**
  - resources/**
  - patches/**
  - README*.md
  - *.json
  - *.yaml
  - *.yml
  - *.ts
  - *.js
  - *.plist
  - .gitattributes
  - .gitignore
  - .prettierrc
  - AGENTS.md
expectedUserBehavior:
  - Upstream v0.6.0 chat and gateway behavior is available with existing fork branding and account integration.
  - Existing multi-brand packaging and update destinations remain available.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/account-session.test.ts
  - tests/unit/brand-workflows.test.ts
  - tests/unit/fork-config-coordinator.test.ts
  - tests/e2e/account-login.spec.ts
  - tests/e2e/main-navigation.spec.ts
acceptance:
  - Upstream c8a54dcd is an ancestor of the merged branch.
  - Renderer uses the existing host API boundary for backend calls.
  - User local release configuration changes are restored after the merge.
  - Type checking, frontend build, harness validation, and comms checks are executed.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Preserve fork-specific functionality when resolving upstream conflicts. Adopt
upstream implementations for replaced chat internals and port fork integrations
to the current APIs. Do not publish a release as part of this source sync.
