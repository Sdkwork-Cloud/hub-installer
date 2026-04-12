# Uninstall And Backup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add first-class backup and uninstall operations to `hub-installer` across Node.js and Rust, including install records, manifest lifecycle hooks, CLI/library APIs, and documentation.

**Architecture:** Extend the manifest lifecycle with `backup` and `uninstall`, persist install records after successful installs, implement generic filesystem backup/uninstall behavior in both engines, and surface the new operations through registry helpers, CLI commands, and docs.

**Tech Stack:** TypeScript, Rust, Vite/Vitest, cargo test, JSON install records, filesystem copy/remove utilities

---

### Task 1: Extend manifest/runtime contracts

**Files:**
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\manifest\types.ts`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\manifest\validate.ts`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\manifest\template.ts`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\manifest\template.test.ts`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\schemas\hub-installer.manifest.schema.json`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\src\manifest.rs`

**Step 1: Write the failing tests**

Add tests proving:
- `backup` and `uninstall` lifecycle stages are accepted,
- backup runtime variables render safely when unset,
- manifests with backup/uninstall fields load successfully.

**Step 2: Run focused tests to verify failure**

Run: `pnpm test -- src/manifest/template.test.ts`

Expected: FAIL until lifecycle/runtime contracts are expanded.

**Step 3: Write the minimal implementation**

Add:
- lifecycle stages `backup` and `uninstall`,
- backup runtime variables,
- schema support in Node and Rust.

**Step 4: Run focused tests to verify pass**

Run: `pnpm test -- src/manifest/template.test.ts`

Expected: PASS

### Task 2: Add install-record and backup-path state helpers

**Files:**
- Create: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\core\install-records.ts`
- Create: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\core\install-records.test.ts`
- Create: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\src\state.rs`
- Add/update Rust tests as needed

**Step 1: Write the failing tests**

Cover:
- install-record path resolution,
- writing and reading records,
- backup session directory resolution,
- canonical software-name handling.

**Step 2: Run focused tests to verify failure**

Run: `pnpm test -- src/core/install-records.test.ts`

Expected: FAIL because helpers do not exist yet.

**Step 3: Write the minimal implementation**

Implement:
- install record schema,
- record file path helper,
- backup session directory helper,
- read/write/update behavior.

**Step 4: Run focused tests to verify pass**

Run: `pnpm test -- src/core/install-records.test.ts`

Expected: PASS

### Task 3: Implement Node.js backup and uninstall engine flows

**Files:**
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\manifest\executor.ts`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\manifest\index.ts`
- Add tests under: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\manifest\`

**Step 1: Write the failing tests**

Add end-to-end manifest tests for:
- persisting install record after non-dry-run apply,
- backing up data/install/work targets,
- uninstalling install/work targets,
- preserving data by default,
- purging data only when requested,
- backup-before-uninstall behavior.

**Step 2: Run focused tests to verify failure**

Run the new manifest executor tests.

Expected: FAIL because backup/uninstall APIs do not exist.

**Step 3: Write the minimal implementation**

Add:
- `backupManifest`
- `backupManifestFile`
- `uninstallManifest`
- `uninstallManifestFile`
- generic filesystem backup/delete helpers
- install-record persistence on successful install/apply

**Step 4: Run focused tests to verify pass**

Run the same focused manifest tests.

Expected: PASS

### Task 4: Implement Node.js registry and CLI surfaces

**Files:**
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\registry\types.ts`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\registry\service.ts`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\registry\index.ts`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\cli.ts`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\cli-output.ts`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\src\index.ts`
- Add/update CLI tests as needed

**Step 1: Write the failing tests**

Cover:
- top-level `backup` and `uninstall` commands,
- `registry backup` and `registry uninstall`,
- JSON output structure,
- registry-backed backup/uninstall helpers.

**Step 2: Run focused tests to verify failure**

Run the CLI/registry tests.

Expected: FAIL until the command surface exists.

**Step 3: Write the minimal implementation**

Add:
- registry helper methods,
- new result formatters,
- new CLI commands and flags.

**Step 4: Run focused tests to verify pass**

Run the same focused tests.

Expected: PASS

### Task 5: Implement Rust backup and uninstall engine flows

**Files:**
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\src\engine.rs`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\src\lib.rs`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\src\manifest.rs`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\src\cli.rs`
- Add/update tests under: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\tests\`

**Step 1: Write the failing tests**

Cover:
- install record persistence after apply/install,
- backup result generation,
- uninstall result generation,
- default data preservation,
- purge-data behavior,
- observer events for backup/uninstall generic steps.

**Step 2: Run focused tests to verify failure**

Run the new Rust tests.

Expected: FAIL because the APIs and state helpers do not exist.

**Step 3: Write the minimal implementation**

Add:
- backup/uninstall option/result types,
- engine methods with and without observer,
- state helper module,
- CLI commands and flags,
- observer emission for internal backup/remove steps.

**Step 4: Run focused tests to verify pass**

Run the same focused Rust tests.

Expected: PASS

### Task 6: Update built-in manifests, docs, and examples

**Files:**
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\registry\manifests\openclaw-docker.hub.yaml`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\examples\openclaw-docker.hub.yaml`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\README.md`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\docs\manifest-spec.md`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\docs\install-policy.md`
- Modify: VitePress docs under `docs/guide/`, `docs/nodejs/`, `docs/rust/`

**Step 1: Add product-facing examples**

Document:
- backup command usage,
- uninstall command usage,
- backup-before-uninstall flow,
- install-record and backup path conventions.

**Step 2: Update OpenClaw Docker**

Add explicit uninstall lifecycle behavior suitable for Docker cleanup.

### Task 7: Full verification

**Files:**
- Modify as needed: tests/docs/examples only

**Step 1: Run Node verification**

Run: `pnpm verify`

Expected: PASS

**Step 2: Run Rust verification**

Run: `cargo test --manifest-path rust/Cargo.toml`

Expected: PASS

**Step 3: Run Rust lint verification**

Run: `cargo clippy --manifest-path rust/Cargo.toml --all-targets --all-features -- -D warnings`

Expected: PASS

**Step 4: Run docs verification**

Run: `pnpm docs:build`

Expected: PASS

**Step 5: Run at least one real backup/uninstall regression**

Use a controlled local fixture or OpenClaw Docker workspace so the new lifecycle is exercised with real filesystem side effects.
