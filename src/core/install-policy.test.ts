import { describe, expect, it } from "vitest";
import { resolveInstallPolicy } from "./install-policy";

describe("resolveInstallPolicy", () => {
  it("resolves ubuntu system installs to /opt and /usr/local/bin", () => {
    const policy = resolveInstallPolicy({
      platform: "ubuntu",
      softwareName: "codex",
      installScope: "system",
      installerHome: "/home/tester/.sdkwork/hub-installer"
    });

    expect(policy).toMatchObject({
      installerHome: "/home/tester/.sdkwork/hub-installer",
      installScope: "system",
      installRoot: "/opt/codex",
      workRoot: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
      binDir: "/usr/local/bin",
      dataRoot: "/var/lib/codex",
      installControlLevel: "managed",
      effectiveRuntimePlatform: "ubuntu"
    });
  });

  it("resolves windows system installs to Program Files by default", () => {
    const policy = resolveInstallPolicy({
      platform: "windows",
      softwareName: "openclaw",
      installScope: "system",
      installerHome: "C:\\Users\\tester\\.sdkwork\\hub-installer",
      env: {
        ProgramFiles: "C:\\Program Files",
        ProgramData: "C:\\ProgramData",
        LocalAppData: "C:\\Users\\tester\\AppData\\Local"
      }
    });

    expect(policy).toMatchObject({
      installRoot: "C:\\Program Files\\Openclaw",
      binDir: "C:\\Program Files\\Openclaw\\bin",
      dataRoot: "C:\\ProgramData\\Openclaw",
      effectiveRuntimePlatform: "windows"
    });
  });

  it("resolves user-scope installs under ~/.local on ubuntu", () => {
    const policy = resolveInstallPolicy({
      platform: "ubuntu",
      softwareName: "python",
      installScope: "user",
      installerHome: "/home/tester/.sdkwork/hub-installer"
    });

    expect(policy).toMatchObject({
      installRoot: "/home/tester/.local/opt/python",
      binDir: "/home/tester/.local/bin",
      dataRoot: "/home/tester/.local/share/python"
    });
  });

  it("supports a wsl effective runtime for windows-hosted codex installs", () => {
    const policy = resolveInstallPolicy({
      platform: "windows",
      softwareName: "codex",
      installScope: "user",
      installerHome: "/home/tester/.sdkwork/hub-installer",
      effectiveRuntimePlatform: "wsl"
    });

    expect(policy).toMatchObject({
      effectiveRuntimePlatform: "wsl",
      installerHome: "/home/tester/.sdkwork/hub-installer",
      installRoot: "/home/tester/.local/opt/codex",
      workRoot: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
      binDir: "/home/tester/.local/bin",
      dataRoot: "/home/tester/.local/share/codex"
    });
  });

  it("normalizes windows-style overrides for WSL runtime installs", () => {
    const policy = resolveInstallPolicy({
      platform: "windows",
      softwareName: "openclaw",
      installScope: "user",
      installerHome: "C:\\Users\\tester\\.sdkwork\\hub-installer",
      installRoot: "D:\\apps\\OpenClaw",
      workRoot: "D:\\workspace\\OpenClaw",
      binDir: "D:\\apps\\bin",
      dataRoot: "D:\\data\\OpenClaw",
      effectiveRuntimePlatform: "wsl"
    });

    expect(policy).toMatchObject({
      installerHome: "/mnt/c/Users/tester/.sdkwork/hub-installer",
      installRoot: "/mnt/d/apps/OpenClaw",
      workRoot: "/mnt/d/workspace/OpenClaw",
      binDir: "/mnt/d/apps/bin",
      dataRoot: "/mnt/d/data/OpenClaw"
    });
  });
});
