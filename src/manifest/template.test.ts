import { describe, expect, it } from "vitest";
import { buildRuntimeVariables, renderStringTemplate } from "./template";
import { validateManifest } from "./validate";

describe("buildRuntimeVariables", () => {
  it("merges installer runtime variables into the manifest template context", () => {
    const variables = buildRuntimeVariables({
      baseDirectory: "/workspace/manifest",
      platform: "ubuntu",
      cwd: "/workspace/run",
      runtimeVariables: {
        installerHome: "/home/tester/.sdkwork/hub-installer",
        hub_install_scope: "system",
        hub_install_root: "/opt/codex",
        hub_work_root: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
        hub_bin_dir: "/usr/local/bin"
      }
    });

    expect(variables.installerHome).toBe("/home/tester/.sdkwork/hub-installer");
    expect(variables.hub_install_scope).toBe("system");
    expect(variables.hub_install_root).toBe("/opt/codex");
    expect(variables.hub_work_root).toBe(
      "/home/tester/.sdkwork/hub-installer/state/sources/codex"
    );
  });

  it("resolves variable references across runtime and manifest variables", () => {
    const variables = buildRuntimeVariables({
      baseDirectory: "/workspace/manifest",
      platform: "ubuntu",
      runtimeVariables: {
        installerHome: "/home/tester/.sdkwork/hub-installer",
        hub_work_root: "{{installerHome}}/state/sources/openclaw"
      },
      manifestVariables: {
        openclaw_source_dir: "{{hub_work_root}}"
      }
    });

    expect(
      renderStringTemplate("{{openclaw_source_dir}}", variables)
    ).toBe("/home/tester/.sdkwork/hub-installer/state/sources/openclaw");
  });

  it("provides optional runtime variables as empty strings when not resolved", () => {
    const variables = buildRuntimeVariables({
      baseDirectory: "/workspace/manifest",
      platform: "ubuntu"
    });

    expect(
      renderStringTemplate(
        "runtime={{hub_container_runtime}} wsl={{hub_wsl_distribution}} context={{hub_docker_context}} host={{hub_docker_host}}",
        variables
      )
    ).toBe("runtime= wsl= context= host=");
  });

  it("provides backup lifecycle runtime variables as empty strings when not resolved", () => {
    const variables = buildRuntimeVariables({
      baseDirectory: "/workspace/manifest",
      platform: "ubuntu"
    });

    expect(
      renderStringTemplate(
        "backup={{hub_backup_root}} session={{hub_backup_session_dir}} data={{hub_backup_data_dir}} install={{hub_backup_install_dir}} work={{hub_backup_work_dir}} record={{hub_install_record_file}} status={{hub_install_status}}",
        variables
      )
    ).toBe("backup= session= data= install= work= record= status=");
  });
});

describe("validateManifest lifecycle stages", () => {
  it("accepts backup and uninstall lifecycle stages", () => {
    const manifest = validateManifest({
      schemaVersion: "1.0",
      metadata: {
        name: "OpenClaw"
      },
      lifecycle: {
        backup: [
          {
            run: "echo backup"
          }
        ],
        uninstall: [
          {
            run: "echo uninstall"
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

    expect(manifest.lifecycle as Record<string, unknown>).toMatchObject({
      backup: [
        {
          run: "echo backup"
        }
      ],
      uninstall: [
        {
          run: "echo uninstall"
        }
      ]
    });
  });
});
