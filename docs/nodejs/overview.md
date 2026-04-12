# Node.js / TypeScript Overview

The Node.js surface is the original `hub-installer` implementation.

Use it when you want:

- a scriptable CLI,
- a TypeScript library for backend automation,
- manifest and registry orchestration,
- dry-run and JSON/text output workflows,
- software installation by package source or registry shortcut.

## Package Identity

- package name: `hub-installer`
- CLI binary: `hub-installer`

## What Node.js Does Well

### Direct package installs

Node.js supports package planning and execution for:

- Windows: `exe`, `msi`, `msix`, `zip`, `tar`, `manager`
- macOS: `pkg`, `dmg`, `zip`, `tar`, `manager`
- Ubuntu: `deb`, `rpm`, `appimage`, `zip`, `tar`, `manager`
- Android: `apk`, `zip`, `tar`
- iOS: `ipa`, `zip`, `tar`

It also supports manager URIs such as:

- `winget://...`
- `choco://...`
- `brew://...`
- `apt://...`
- `snap://...`

### Manifest-driven installs

Use Node.js when you want a CLI or service that can:

- load local or remote manifests,
- run lifecycle stages,
- manage artifact execution,
- resolve installer home and install roots,
- return JSON or human-readable output.

### Registry-driven installs

Node.js includes the richest CLI around registry workflows today:

- `list`
- `info`
- `doctor`
- `registry validate`
- `registry list`
- `registry show`
- `registry install`

This is the best surface when you want an operator-friendly command line around built-in software profiles such as OpenClaw, Codex, Node.js, and Python.

## Where Rust Goes Further

Node.js is still the best general CLI today, but Rust currently leads in two areas:

- structured real-time progress events for library consumers,
- native embedding patterns for Tauri and desktop products.

If you need per-step command/log events inside an application backend, move to the Rust surface.

## Primary Public Entrypoints

```ts
import {
  createInstaller,
  createInstallPlan,
  installPackage,
  applyManifestFile,
  installSoftwareFromRegistry
} from "hub-installer";
```

## Typical Usage Modes

### 1. Direct package source

```ts
const result = await installPackage({
  source: "winget://Git.Git",
  platform: "windows"
});
```

### 2. Full manifest lifecycle

```ts
const result = await applyManifestFile("./examples/full-stack.hub.yaml", {
  platform: "ubuntu",
  dryRun: true
});
```

### 3. Registry install

```ts
const result = await installSoftwareFromRegistry("openclaw", {
  registrySource: "./registry/software-registry.yaml",
  dryRun: true
});
```

## Continue With

- [Node.js Library Usage](/nodejs/library)
- [Node.js CLI Usage](/nodejs/cli)
- [Manifest Spec](/manifest-spec)
- [Registry Spec](/registry-spec)
