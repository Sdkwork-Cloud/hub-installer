# Reference Overview

The guide pages explain how to think about `hub-installer`. The reference pages define the contract.

## Read These For Exact Formats

- [Manifest Spec](/manifest-spec)
- [Registry Spec](/registry-spec)
- [Install Policy](/install-policy)
- [OpenClaw Profile Architecture](/openclaw-profile-architecture)

## How To Use The Reference Section

Use the guides when you need product direction:

- which surface to embed,
- how runtime selection works,
- how Docker and WSL are separated,
- how to build a Tauri integration.

Use the reference pages when you need contract precision:

- valid manifest fields,
- lifecycle order,
- registry structure,
- policy defaults,
- built-in profile mappings.

## Practical Reading Order

1. [Architecture](/guide/architecture)
2. [Node.js Overview](/nodejs/overview) or [Rust Overview](/rust/overview)
3. the matching reference page for the object you are editing

## Source Of Truth Principle

When a guide and a reference page ever seem to disagree, treat the reference contract plus the current code as the source of truth and update the guide.
