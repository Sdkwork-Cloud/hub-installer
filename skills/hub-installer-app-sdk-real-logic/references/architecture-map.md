# Hub Installer Architecture Map

## Stack

- Node.js + TypeScript + Vite
- CLI and library entry points
- local installer engine, manifest lifecycle, registry, and platform adapters

## Standard Remote Path

Use this path for any remote business capability backed by Hub Installer product SDK ownership:

`cli or library -> shared remote-business bridge -> typed product app client port or generated product app SDK facade`

Preferred bridge ownership is the existing `src/core` or `src/registry` boundary, not scattered calls across CLI commands.

## Local And Native Path

Keep these concerns on their original boundaries:

- install planning and execution
- manifest parsing and lifecycle orchestration
- platform detection and platform-specific installers
- local file cache, local state, dry-run behavior, and registry file loading
- shell/process execution and package-manager invocation

Local-only capability should stay local even while adjacent cloud-backed modules move to the generated SDK.

## Replace Or Remove

- raw HTTP for remote registry, account, entitlement, or licensing business flows
- duplicated DTO mapping that only exists to hide a missing SDK method
- command handlers that set auth headers directly
- cloud fallback branches embedded in low-level installer modules

## Contract Closure Rule

If Hub Installer needs a remote capability that the generated app SDK does not expose:

1. Fix the product-owned API/OpenAPI/generator contract or declare the correct dependency SDK.
2. Regenerate the product app SDK from the repository-standard generator flow when the generated family exists.
3. Reconnect Hub Installer through the shared bridge.
4. Delete the temporary bypass.

If that work would touch backend schema, embedded DB layout, or install-state structure, pause and ask the user first.
