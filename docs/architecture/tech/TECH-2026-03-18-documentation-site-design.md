> Migrated from `docs/plans/2026-03-18-documentation-site-design.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Documentation Site Design

**Problem**

`hub-installer` already has useful raw documentation, but it is fragmented across `README.md`, spec files, registry notes, and Rust design plans. The current shape is strong for maintainers reading the repo, but weak for users trying to understand:

- what the product does end-to-end,
- when to choose Node.js vs Rust,
- how the Rust library integrates into Tauri,
- how runtime selection behaves across Windows, Linux, WSL, and Docker,
- how real-time install logs are consumed programmatically.

There is also no dedicated docs site, so the project lacks a stable, navigable entry point for product usage and architecture guidance.

**Goals**

- Add a first-class VitePress docs site inside the existing `docs/` directory.
- Separate conceptual guides from API/runtime/reference material.
- Document Node.js/TypeScript and Rust as two distinct products sharing one installer model.
- Explain Rust embedding patterns clearly, especially Tauri integration and progress-event streaming.
- Keep the existing spec documents (`manifest-spec.md`, `registry-spec.md`, `install-policy.md`) as authoritative references and surface them in navigation instead of rewriting them into duplicate formats.
- Ensure every documented command, flag, and code sample matches the current implementation.

**Non-Goals**

- Building a generated API reference system.
- Replacing existing README usage completely.
- Adding a new docs deployment pipeline in this pass.

**Recommended Approach**

Use `docs/` as the VitePress content root and add `docs/.vitepress/config.mts`.

This is the best fit because:

1. the repo already treats `docs/` as the canonical documentation directory,
2. existing reference specs can be reused in place without relocation,
3. package publishing already includes selected `docs/*.md` files,
4. the project stays simple: one package, one docs root, one navigation model.

**Information Architecture**

The site should be organized into four layers:

1. **Overview**
   - product positioning
   - architecture snapshot
   - quick start entry points
2. **Guides**
   - install flow model
   - runtime/platform model
   - Docker/WSL behavior
   - troubleshooting
3. **Node.js / TypeScript**
   - package install
   - library usage
   - CLI usage
   - manifest and registry orchestration
4. **Rust**
   - crate usage
   - CLI usage
   - observer/progress streaming
   - Tauri embedding
5. **Reference**
   - manifest spec
   - registry spec
   - install policy
   - OpenClaw profile architecture

**Content Strategy**

Use narrative pages for onboarding and decision-making, and keep detailed schema/reference pages separate.

That yields a better product experience than a single giant README because:

- beginners can start from overview pages,
- library users can jump directly to language-specific pages,
- advanced users still have exact spec documents,
- future platform/runtime changes only need one guide page update.

**Node.js Documentation Direction**

Document Node.js as the mature TypeScript implementation focused on:

- package install planning/execution,
- manifest and registry orchestration,
- CLI shortcuts and built-in profiles,
- automation via JSON/text CLI output.

Be explicit that Node.js currently does not expose the same structured live observer API as Rust.

**Rust Documentation Direction**

Document Rust as the embeddable installer engine for:

- native desktop applications,
- Tauri backends,
- structured progress observation,
- runtime-aware Docker/WSL execution.

The Rust docs should emphasize:

- `InstallEngine::apply_manifest`
- `InstallEngine::apply_manifest_with_observer`
- `InstallEngine::install_from_registry`
- `InstallEngine::install_from_registry_with_observer`
- `ProgressEvent` and `ProgressStream`
- runtime selection through `effective_runtime_platform`, `container_runtime`, `wsl_distribution`, `docker_context`, and `docker_host`

**Runtime Model to Document Clearly**

The docs must explain three separate axes:

1. **Host platform**
   - where `hub-installer` itself is running
2. **Effective runtime platform**
   - where commands are intended to execute
3. **Container runtime**
   - which Docker environment should be used when container tooling is involved

Key clarification:

- WSL is an independent execution environment, not a synonym for Windows.
- Windows can host Docker directly while WSL remains unused.
- Windows can also target WSL execution when a manifest or CLI option requires Linux semantics.
- Docker inside WSL must be validated separately from host Docker.

**Tauri Documentation Direction**

The Tauri page should show the recommended product pattern:

1. call Rust engine APIs from a Tauri command,
2. attach an observer closure,
3. forward `ProgressEvent` values to the frontend event bus,
4. keep final install results separate from event-stream rendering.

This is the cleanest design because the UI consumes structured progress payloads instead of scraping terminal text.

**Documentation Quality Bar**

Every page should be judged against three questions:

1. Can a new engineer understand when to use this surface?
2. Can they copy a sample and run it successfully?
3. Can they reason about runtime/platform behavior without reading source code?

If not, the page is incomplete.

**Acceptance Criteria**

- `pnpm docs:build` succeeds.
- The site has clear navigation for overview, guides, Node.js, Rust, and reference.
- Rust library/Tauri/progress streaming are documented with real current APIs.
- Docker/WSL runtime behavior is explicitly documented, including Windows-hosted and WSL-hosted Docker differences.
- Existing reference specs remain reachable from the site.

