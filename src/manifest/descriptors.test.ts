import { describe, expect, it } from "vitest";
import { validateManifest } from "./validate";

describe("manifest product descriptors", () => {
  it("accepts installation, data layout, and migration metadata", () => {
    const manifest = validateManifest({
      schemaVersion: "1.0",
      metadata: {
        name: "ZeroClaw Install (Source)"
      },
      installation: {
        method: {
          id: "source-build",
          label: "Rust source build",
          type: "source",
          summary: "Clone the upstream repository and install the binary with Cargo.",
          supported: true
        },
        alternatives: [
          {
            id: "shell-script",
            label: "Shell script",
            type: "script",
            summary: "Documented upstream flow that is not automated by this profile.",
            supported: false
          }
        ],
        directories: {
          installRoot: {
            path: "{{hub_install_root}}",
            customizable: true,
            purpose: "Managed binary installation root."
          },
          workRoot: {
            path: "{{hub_work_root}}",
            customizable: true,
            purpose: "Repository checkout directory."
          },
          dataRoot: {
            path: "{{hub_data_root}}",
            customizable: true,
            purpose: "Managed runtime data."
          },
          additional: [
            {
              id: "zeroclaw-home",
              path: "~/.zeroclaw",
              customizable: false,
              purpose: "User-scoped ZeroClaw configuration and workspace state."
            }
          ]
        }
      },
      dataLayout: {
        items: [
          {
            id: "zeroclaw-home",
            title: "ZeroClaw home directory",
            kind: "directory",
            path: "~/.zeroclaw",
            description: "Stores auth profiles, encrypted secret key material, and workspace data.",
            includes: ["auth-profiles.json", ".secret_key", "workspace/skills"],
            sensitive: true,
            backupByDefault: true,
            uninstallByDefault: "preserve"
          }
        ]
      },
      migration: {
        strategies: [
          {
            id: "openclaw-memory-import",
            source: "openclaw",
            title: "Import OpenClaw memory",
            mode: "command",
            summary: "Use ZeroClaw's built-in migration command to preview and import memory.",
            supported: true,
            previewCommands: [
              {
                run: "zeroclaw migrate openclaw --dry-run"
              }
            ],
            applyCommands: [
              {
                run: "zeroclaw migrate openclaw"
              }
            ],
            dataItemIds: ["zeroclaw-home"],
            warnings: ["Only memory imported by ZeroClaw is migrated automatically."]
          }
        ]
      },
      artifacts: [
        {
          id: "noop",
          type: "command",
          commands: [
            {
              run: "echo ok"
            }
          ]
        }
      ]
    });

    expect(manifest.installation?.method.id).toBe("source-build");
    expect(manifest.installation?.directories?.workRoot?.customizable).toBe(true);
    expect(manifest.installation?.alternatives?.[0]?.supported).toBe(false);
    expect(manifest.dataLayout?.items[0]?.includes).toContain("auth-profiles.json");
    expect(manifest.migration?.strategies[0]?.previewCommands?.[0]?.run).toContain("--dry-run");
  });
});
