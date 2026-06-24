> Migrated from `docs/nodejs/library.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Node.js Library Usage

The Node.js library is ideal when you want to drive `hub-installer` from a backend service, script runner, or larger TypeScript product.

## Install The Package

```bash
pnpm add hub-installer
```

## Main Exports

```ts
import {
  createInstaller,
  createInstallPlan,
  installPackage,
  detectPlatform,
  detectFormat,
  resolveExecutionContext,
  applyManifestFile,
  backupManifestFile,
  uninstallManifestFile,
  loadManifestFromSource,
  backupSoftwareFromRegistry,
  installSoftwareFromRegistry,
  listRegistryEntries,
  getRegistryEntry,
  uninstallSoftwareFromRegistry,
  runRegistryDoctor
} from "hub-installer";
```

## 1. Plan A Direct Package Install

Use `createInstallPlan` when you want to inspect what would happen before executing it.

```ts
import { createInstallPlan } from "hub-installer";

const plan = await createInstallPlan({
  source: "apt://curl",
  platform: "ubuntu",
  sudo: true
});

console.log(plan.request);
console.log(plan.steps);
```

Typical uses:

- preflight UI previews,
- operator approval workflows,
- install diffing,
- dry-run audit pipelines.

## 2. Execute A Direct Package Install

Use `installPackage` for direct installer or package manager sources.

```ts
import { installPackage } from "hub-installer";

const result = await installPackage({
  source: "https://example.com/releases/tool.msi",
  platform: "windows",
  sourceChecksum:
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  downloadCacheDir: "./.cache/packages",
  dryRun: true,
  progress: true
});

console.log(result.success);
```

`InstallRequest` supports the main controls you expect:

- `source`
- `platform`
- `format`
- `sourceChecksum`
- `installerArgs`
- `managerArgs`
- `archiveEntry`
- `archiveCommand`
- `dryRun`
- `verbose`
- `progress`
- `sudo`
- `cwd`
- `timeoutMs`

## 3. Apply A Manifest

Use `applyManifestFile` when install logic needs dependencies, lifecycle stages, or multiple artifacts.

```ts
import { applyManifestFile } from "hub-installer";

const result = await applyManifestFile("./examples/openclaw-docker.hub.yaml", {
  platform: "ubuntu",
  dryRun: true,
  installerHome: "~/.sdkwork/hub-installer",
  installScope: "user",
  variables: {
    openclaw_channel: "beta"
  }
});

console.log(result.stageReports);
console.log(result.artifactReports);
```

Manifest application options also let you control:

- `effectiveRuntimePlatform`
- `containerRuntime`
- `wslDistribution`
- `dockerContext`
- `dockerHost`
- `installerHome`
- `installRoot`
- `workRoot`
- `binDir`
- `dataRoot`
- `installControlLevel`
- `configPath`
- `manifestCacheDir`
- `manifestFetchTimeoutMs`

## 4. Install From The Registry

Use `installSoftwareFromRegistry` when the caller should only know a software name.

```ts
import { installSoftwareFromRegistry } from "hub-installer";

const result = await installSoftwareFromRegistry("nodejs", {
  registrySource: "./registry/software-registry.yaml",
  dryRun: true,
  variables: {
    nodejs_install_method: "fnm",
    nodejs_version: "24"
  }
});

console.log(result.software.name);
console.log(result.applyResult.success);
```

Useful companion APIs:

```ts
import {
  getRegistryEntry,
  listRegistryEntries,
  runRegistryDoctor
} from "hub-installer";

const entries = await listRegistryEntries("./registry/software-registry.yaml");
const nodejs = await getRegistryEntry("nodejs");
const doctor = await runRegistryDoctor("openclaw", { runtime: true });
```

## 5. Resolve Runtime Policy Explicitly

Use `resolveExecutionContext` when your product wants to validate runtime policy before starting an install.

```ts
import { resolveExecutionContext } from "hub-installer";

const runtime = resolveExecutionContext("windows", {
  effectiveRuntimePlatform: "wsl",
  containerRuntime: "host",
  wslDistribution: "Ubuntu-22.04",
  dockerContext: "desktop-linux"
});

console.log(runtime.effectiveRuntimePlatform);
console.log(runtime.containerRuntime);
```

This is especially useful when:

- a settings page lets users choose Windows vs WSL execution,
- Docker context must be explicit,
- you need to preflight runtime before enabling an install button.

## 6. Back Up Or Uninstall Managed State

```ts
import {
  backupManifestFile,
  uninstallManifestFile,
  backupSoftwareFromRegistry,
  uninstallSoftwareFromRegistry
} from "hub-installer";

const backup = await backupManifestFile("./examples/openclaw-docker.hub.yaml", {
  targets: ["data", "install"],
  sessionId: "2026-03-18T10:20:30.123Z"
});

const uninstall = await uninstallManifestFile("./examples/openclaw-docker.hub.yaml", {
  backupBeforeUninstall: true,
  backupTargets: ["data", "work"]
});

const registryBackup = await backupSoftwareFromRegistry("openclaw", {
  registrySource: "./registry/software-registry.yaml",
  targets: ["data"]
});

const registryUninstall = await uninstallSoftwareFromRegistry("openclaw", {
  registrySource: "./registry/software-registry.yaml",
  purgeData: true
});

console.log(backup.backupSessionDir);
console.log(uninstall.targetReports);
console.log(registryBackup.backupResult.success);
console.log(registryUninstall.uninstallResult.success);
```

Successful non-dry-run installs persist install records under:

- `<installerHome>/state/install-records/<software>.json`

On Windows with `effectiveRuntimePlatform: "wsl"`, Node now mirrors Rust's split model:

- manifest commands run through `wsl.exe` for WSL-targeted bash/auto steps,
- install records, backups, and uninstall file operations use host-accessible paths such as `\\wsl$\...` or `D:\...`.

## 7. Detect Platform And Source Format

```ts
import { detectPlatform, detectFormat } from "hub-installer";

const platform = detectPlatform();
const format = detectFormat("winget://Git.Git");

console.log({ platform, format });
```

## Important Difference From Rust

Node.js library callers receive final results but do not currently receive the same structured real-time observer stream that Rust provides.

If your product needs:

- per-step command start events,
- live stdout/stderr chunk streaming,
- Tauri event forwarding,

use the Rust crate instead.

