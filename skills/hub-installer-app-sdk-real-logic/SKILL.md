---
name: hub-installer-app-sdk-real-logic
description: Guides Hub Installer remote business flows onto generated app SDK contracts. Use when integrating or repairing apps/hub-installer modules so they consume spring-ai-plus-app-api instead of ad hoc HTTP inside installer or registry code, or when a missing contract must be closed end to end before release.
---

# Hub Installer App SDK Real Logic

## Overview

Drive `apps/hub-installer` to one split architecture:

`CLI / library / remote registry feature -> shared remote-business bridge -> @sdkwork/app-sdk -> spring-ai-plus-app-api`

Keep installer engine, manifest execution, platform installers, local registry parsing, cache, and dry-run behavior on the local path. Only remote business capability should cross the generated app-SDK boundary.

Treat every round as a recursive closure loop: self-review the touched app or client code, decide whether the next fix belongs in app or frontend code, backend or service code, or generator inputs, regenerate the SDK when contracts move, then review again until no higher-value gap remains.

## Progressive Loading

- Start with this file only.
- Load `references/architecture-map.md` only when deciding whether work is local-installer or remote-business.
- Load `../../../SDK_INTEGRATION_STANDARD.md` only when remote client lifecycle or token rules matter.
- Load `../../README.md` only when install modes or registry behavior affect the change.
- Load `references/verification.md` only before closing the round.

## Hard Rules

- Use `spring-ai-plus-app-api` as the single contract source for remote business capability.
- Use `spring-ai-plus-app-api/sdkwork-sdk-app/sdkwork-app-sdk-typescript` as the only shared TypeScript SDK source and consume it through `@sdkwork/app-sdk`.
- If the remote-business bridge is incomplete, finish it in `src/core` or `src/registry` before touching feature behavior.
- Keep manifest parsing, runtime detection, dry-run logic, platform installers, and local cache or state handling out of the app SDK path.
- Route remote catalog, account, entitlement, licensing, profile, and cloud registry flows through the generated app SDK. Do not add raw `fetch`, generic HTTP helpers, or manual auth headers.
- Never hand-edit generated SDK output. Fix backend or generator inputs, then regenerate.
- Any backend, embedded DB, or install-state schema change requires user confirmation first.

## Default Loop

1. Classify the target as local-installer, remote-business, or mixed.
2. Audit `src/core`, `src/registry`, and related entry points for raw HTTP, duplicated DTOs, manual headers, or fake cloud-success branches.
3. Verify the real generated SDK export and the shared bridge surface.
4. If the method exists, refactor to the bridge -> app-sdk path and delete the bypass.
5. If the method is missing, close the gap in `spring-ai-plus-app-api` and backend modules, regenerate the SDK, then finish the integration.
6. If gap closure or local state evolution needs any schema change, stop and ask the user before touching structure.
7. Self-review the touched path. If a better next fix still belongs in app or frontend code, backend or service code, generator inputs, or adjacent cleanup, keep iterating instead of stopping at the first pass.
8. Run verification, then rescan registry, manifest, and install flows for parallel legacy paths.

## Red Flags

- raw `fetch(` or ad hoc HTTP helpers in `src/core` or `src/registry`
- manual `Authorization`, `Access-Token`, or bearer header assignment
- DTO shims created only to hide a missing SDK method
- fake offline-success or timeout-based cloud fallback branches
- unapproved install-state, embedded DB, or backend schema changes

## Completion Bar

- Local installer behavior still stays on the correct local boundary.
- Remote business modules use the shared bridge and generated app SDK.
- No raw HTTP, manual header, mock bypass, or temporary fallback remains.
- Missing contracts are closed in backend/OpenAPI/generator inputs, and no schema change happened without approval.
- Relevant typecheck, build, test, and dry-run verification pass.
