# Documentation Site Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a VitePress documentation site for `hub-installer` that clearly documents product architecture, install/runtime behavior, Node.js usage, Rust usage, Tauri embedding, and reference specs.

**Architecture:** Reuse the existing `docs/` directory as the VitePress content root, add a `.vitepress` config plus curated guide pages, and keep the current spec documents as authoritative reference pages linked through sidebar navigation.

**Tech Stack:** VitePress, Markdown, Node.js, pnpm

---

### Task 1: Add the docs-site scaffold

**Files:**
- Modify: `<workspace-root>\hub-installer\package.json`
- Modify: `<workspace-root>\hub-installer\pnpm-lock.yaml`
- Create: `<workspace-root>\hub-installer\docs\.vitepress\config.mts`

**Step 1: Write the failing setup expectation**

Define the desired docs scripts and site navigation before touching content:
- `docs:dev`
- `docs:build`
- `docs:preview`

**Step 2: Implement the minimal scaffold**

Add VitePress as a dev dependency, wire the scripts, and create the base site config with:
- title/description
- clean navigation
- sidebar groups for overview, guides, Node.js, Rust, reference

**Step 3: Verify the site scaffold exists**

Run: `pnpm install`

Expected: lockfile updates cleanly and VitePress is available locally.

### Task 2: Create the high-level overview and guide pages

**Files:**
- Create: `<workspace-root>\hub-installer\docs\index.md`
- Create: `<workspace-root>\hub-installer\docs\guide\getting-started.md`
- Create: `<workspace-root>\hub-installer\docs\guide\architecture.md`
- Create: `<workspace-root>\hub-installer\docs\guide\runtime-and-docker.md`
- Create: `<workspace-root>\hub-installer\docs\guide\troubleshooting.md`

**Step 1: Write the content skeleton**

Document:
- product overview,
- install lifecycle,
- host/effective runtime/container runtime model,
- Docker + WSL behavior,
- common failure modes and remediation.

**Step 2: Fill the pages with current implementation details**

Use the current README, Rust runtime design, and registry/install policy docs as source truth.

**Step 3: Verify internal links**

Run a docs build later and fix any broken links or bad frontmatter assumptions.

### Task 3: Document the Node.js/TypeScript surface

**Files:**
- Create: `<workspace-root>\hub-installer\docs\nodejs\overview.md`
- Create: `<workspace-root>\hub-installer\docs\nodejs\library.md`
- Create: `<workspace-root>\hub-installer\docs\nodejs\cli.md`

**Step 1: Capture the real public API**

Document:
- `createInstaller`
- `createInstallPlan`
- `installPackage`
- manifest helpers
- registry helpers

**Step 2: Capture the CLI workflow**

Document:
- `detect`
- `plan`
- `install`
- `apply`
- `validate`
- `doctor`
- `registry` commands
- built-in software shortcuts

**Step 3: Keep scope honest**

Explicitly state where Node.js is strong today and where Rust has deeper streaming/runtime capabilities.

### Task 4: Document the Rust surface and Tauri integration

**Files:**
- Create: `<workspace-root>\hub-installer\docs\rust\overview.md`
- Create: `<workspace-root>\hub-installer\docs\rust\library.md`
- Create: `<workspace-root>\hub-installer\docs\rust\cli.md`
- Create: `<workspace-root>\hub-installer\docs\rust\progress-streaming.md`
- Create: `<workspace-root>\hub-installer\docs\rust\tauri.md`

**Step 1: Document the embeddable API**

Cover:
- `ApplyManifestOptions`
- `RegistryInstallOptions`
- `InstallEngine`
- `ProgressEvent`
- runtime options and install policy results

**Step 2: Document runtime selection cleanly**

Explain:
- `effective_runtime_platform`
- `container_runtime`
- `wsl_distribution`
- `docker_context`
- `docker_host`

**Step 3: Document the Tauri pattern**

Show a complete example that:
- calls the Rust engine,
- forwards `ProgressEvent` values to the frontend,
- keeps final JSON result handling separate from streaming logs.

### Task 5: Integrate the existing reference specs into the site

**Files:**
- Modify as needed: `<workspace-root>\hub-installer\docs\.vitepress\config.mts`
- Reuse: `<workspace-root>\hub-installer\docs\manifest-spec.md`
- Reuse: `<workspace-root>\hub-installer\docs\registry-spec.md`
- Reuse: `<workspace-root>\hub-installer\docs\install-policy.md`
- Reuse: `<workspace-root>\hub-installer\docs\openclaw-profile-architecture.md`

**Step 1: Place existing specs in navigation**

Expose them under a dedicated reference section rather than duplicating their content.

**Step 2: Add context where needed**

If a spec page lacks enough framing for site readers, add small guide pages around it instead of bloating the spec.

### Task 6: Verify docs and command accuracy

**Files:**
- Modify as needed: newly added docs pages

**Step 1: Install docs dependencies**

Run: `pnpm install`

Expected: PASS

**Step 2: Build the TypeScript package**

Run: `pnpm build`

Expected: PASS

**Step 3: Build the docs site**

Run: `pnpm docs:build`

Expected: PASS

**Step 4: Re-run Rust verification**

Run: `cargo test`

Expected: PASS

**Step 5: Perform a focused real-world regression**

Run a Docker-oriented Rust install flow already validated on this workstation and ensure the docs reflect the current flags and behavior.
