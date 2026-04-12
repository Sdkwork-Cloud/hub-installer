import { defineConfig } from "vitepress";

export default defineConfig({
  title: "hub-installer",
  description:
    "Cross-platform installer engine for Node.js and Rust with manifest, registry, Docker, WSL, and Tauri-ready progress streaming support.",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    search: {
      provider: "local"
    },
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Node.js", link: "/nodejs/overview" },
      { text: "Rust", link: "/rust/overview" },
      { text: "Reference", link: "/reference/" }
    ],
    sidebar: [
      {
        text: "Overview",
        items: [
          { text: "Home", link: "/" },
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Architecture", link: "/guide/architecture" }
        ]
      },
      {
        text: "Guides",
        items: [
          { text: "Runtime And Docker", link: "/guide/runtime-and-docker" },
          { text: "Troubleshooting", link: "/guide/troubleshooting" }
        ]
      },
      {
        text: "Node.js / TypeScript",
        items: [
          { text: "Overview", link: "/nodejs/overview" },
          { text: "Library Usage", link: "/nodejs/library" },
          { text: "CLI Usage", link: "/nodejs/cli" }
        ]
      },
      {
        text: "Rust",
        items: [
          { text: "Overview", link: "/rust/overview" },
          { text: "Library Usage", link: "/rust/library" },
          { text: "CLI Usage", link: "/rust/cli" },
          { text: "Progress Streaming", link: "/rust/progress-streaming" },
          { text: "Tauri Integration", link: "/rust/tauri" }
        ]
      },
      {
        text: "Reference",
        items: [
          { text: "Reference Overview", link: "/reference/" },
          { text: "Manifest Spec", link: "/manifest-spec" },
          { text: "Registry Spec", link: "/registry-spec" },
          { text: "Install Policy", link: "/install-policy" },
          { text: "OpenClaw Profile Architecture", link: "/openclaw-profile-architecture" }
        ]
      }
    ],
    outline: {
      level: [2, 3]
    },
    footer: {
      message: "Manifest and registry driven software installation for Node.js and Rust.",
      copyright: "Copyright 2026 hub-installer contributors"
    }
  }
});
