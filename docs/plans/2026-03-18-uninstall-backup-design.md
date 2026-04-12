# Uninstall And Backup Design

**Problem**

`hub-installer` currently handles installation, manifest orchestration, registry lookup, runtime policy, and live progress streaming, but it stops at install-time concerns.

There is no first-class support for:

- uninstalling software through the same manifest/registry model,
- backing up managed data before destructive actions,
- remembering previous install locations well enough to make later backup/uninstall safe,
- exposing uninstall/backup as library and CLI operations in both Node.js and Rust.

That leaves the product lifecycle incomplete.

**Autonomous Assumptions**

The user asked for autonomous optimization without interruption, so this design makes the following default decisions:

1. `backup` and `uninstall` are first-class product operations, not ad-hoc scripts.
2. uninstall should be safe by default:
   - remove install/work outputs,
   - preserve data unless the caller explicitly asks to purge it.
3. backup should be able to run independently or automatically before uninstall.
4. existing install records under `state/install-records/` should become authoritative metadata for later lifecycle operations.
5. restore is intentionally out of scope for this pass; backup must produce deterministic, inspectable output that makes later restore practical.

**Goals**

- Add first-class `backup` and `uninstall` operations to Node.js and Rust.
- Extend the manifest model so uninstall/backup can be customized per software profile.
- Add install-record persistence so later operations can find the actual installed paths.
- Provide safe generic filesystem backup/uninstall behavior for managed layouts.
- Preserve the current runtime/policy/progress architecture instead of creating a sidecar subsystem.

**Non-Goals**

- Full restore workflow.
- Binary-diff or snapshot deduplication.
- Automatic secrets classification in persisted variables.
- Perfect uninstall coverage for every opaque third-party installer profile on day one.

**Approaches Considered**

## Approach 1: Lifecycle Commands Only

Add `lifecycle.backup` and `lifecycle.uninstall`, but require every manifest to define all behavior manually.

**Pros**

- minimal engine changes
- highly flexible

**Cons**

- weak product default
- no generic data protection
- every profile has to reinvent backup/delete semantics
- poor UX for library consumers

## Approach 2: Stateful Engine Operations With Manifest Hooks

Add dedicated engine operations for `backup` and `uninstall`, persist install records after successful install, and allow manifests to add optional hook stages.

**Pros**

- consistent behavior across Node.js, Rust, CLI, and Tauri
- safe default backup/delete logic
- install policy stays the source of truth
- opaque profiles can still add custom cleanup hooks

**Cons**

- more engine work
- introduces record schema/versioning concerns

## Approach 3: Separate Backup/Uninstall Manifests Per Registry Entry

Add new registry fields pointing to dedicated manifests for backup and uninstall.

**Pros**

- maximum separation
- very explicit

**Cons**

- doubles registry complexity
- drifts easily from install manifests
- high maintenance burden

**Recommendation**

Use **Approach 2**.

It is the only option that makes uninstall and backup genuine product capabilities instead of optional scripting conventions.

**Core Design**

## 1. New Operations

Add two new operation families:

- `backup`
- `uninstall`

Expose them in:

- Node.js library
- Node.js CLI
- Rust library
- Rust CLI

## 2. Install Records

After a successful non-dry-run install/apply, persist an install record under:

- Node.js: `<installerHome>/state/install-records/<software>.json`
- Rust: same path convention

Record contents should include:

- canonical software name
- manifest identity
- registry identity when applicable
- platform and effective runtime platform
- resolved install/work/bin/data roots
- install scope and control level
- timestamps
- current status (`installed` or `uninstalled`)

Do **not** persist arbitrary manifest override variables in this pass.

That keeps the record useful without quietly storing sensitive inputs.

## 3. Manifest Model Extensions

Add optional lifecycle stages:

- `backup`
- `uninstall`

These stages should be available to both Node.js and Rust.

They are for software-specific logic such as:

- stopping services,
- running vendor uninstall commands,
- exporting config,
- stopping Docker Compose before work-tree deletion.

## 4. Generic Backup Behavior

Backup should not depend entirely on shell commands.

The engine should be able to copy selected policy-resolved directories into:

- `<installerHome>/state/backups/<software>/<timestamp>/`

Recommended target directories:

- `data/`
- `install/`
- `work/`

The default backup target should be:

- `data`

Optional targets:

- `install`
- `work`
- `all`

The backup result should describe exactly which targets were found, copied, skipped, or missing.

## 5. Generic Uninstall Behavior

Uninstall should support two layers:

1. optional custom manifest `lifecycle.uninstall`
2. generic filesystem cleanup based on install policy and install record

Default behavior:

- remove `installRoot`
- remove `workRoot`
- keep `dataRoot`

Optional destructive behavior:

- `purgeData=true` removes `dataRoot`

Optional safety behavior:

- `backupBeforeUninstall=true` runs backup first

This keeps the default uninstall safe while still allowing a full purge path.

## 6. Backup Runtime Variables

Expose new runtime variables so manifests can cooperate with backup/uninstall:

- `hub_backup_root`
- `hub_backup_session_dir`
- `hub_backup_data_dir`
- `hub_backup_install_dir`
- `hub_backup_work_dir`
- `hub_install_record_file`
- `hub_install_status`

As with existing optional runtime variables, unresolved values should render as empty strings rather than causing template failures.

## 7. Opaque Vs Managed Install Strategy

Generic uninstall is safest for `managed` and often acceptable for `partial`.

For `opaque` installs:

- the engine should still support backup of policy-known data/work/install roots,
- manifests are strongly encouraged to define `lifecycle.uninstall`,
- generic delete should remain limited to known resolved paths, not arbitrary vendor locations.

This preserves safety without blocking progress.

**Node.js Design**

Add:

- manifest executor functions for backup/uninstall
- registry service helpers for backup/uninstall
- CLI commands:
  - `backup`
  - `uninstall`
  - `registry backup`
  - `registry uninstall`
- top-level exports for the new operations

**Rust Design**

Add:

- `InstallEngine::backup_manifest`
- `InstallEngine::backup_manifest_with_observer`
- `InstallEngine::uninstall_manifest`
- `InstallEngine::uninstall_manifest_with_observer`
- registry equivalents
- CLI commands:
  - `backup`
  - `uninstall`

Reuse the existing progress event model by emitting stage/artifact/step events for:

- custom lifecycle commands,
- generic backup target copy steps,
- generic uninstall target removal steps.

**Built-In Profiles**

At minimum, update `openclaw-docker` to define meaningful uninstall hooks:

- stop `docker compose`
- optionally remove the Docker image when explicitly targeted

Other profiles can start with generic behavior plus documentation that opaque vendor installers should add explicit uninstall hooks over time.

**Acceptance Criteria**

- install records are written on successful non-dry-run install/apply.
- Node.js and Rust both support `backup` and `uninstall`.
- generic backup copies selected targets into a deterministic backup session directory.
- uninstall can optionally back up first and optionally purge data.
- optional runtime backup variables never break template rendering.
- `openclaw-docker` has a real uninstall path, not just filesystem deletion.
