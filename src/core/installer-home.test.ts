import { describe, expect, it } from "vitest";
import {
  resolveInstallerDirectories,
  resolveInstallerHome
} from "./installer-home";

describe("resolveInstallerHome", () => {
  it("defaults to ~/.sdkwork/hub-installer on unix-like platforms", () => {
    expect(
      resolveInstallerHome({
        homeDir: "/home/tester"
      })
    ).toBe("/home/tester/.sdkwork/hub-installer");
  });

  it("defaults to %USERPROFILE%/.sdkwork/hub-installer on windows", () => {
    expect(
      resolveInstallerHome({
        homeDir: "C:\\Users\\tester"
      })
    ).toBe("C:\\Users\\tester\\.sdkwork\\hub-installer");
  });

  it("prefers an explicit installer home override", () => {
    expect(
      resolveInstallerHome({
        homeDir: "/home/tester",
        installerHomeOverride: "/workspace/custom-hub-home"
      })
    ).toBe("/workspace/custom-hub-home");
  });
});

describe("resolveInstallerDirectories", () => {
  it("builds the expected config/cache/state/log directories", () => {
    expect(
      resolveInstallerDirectories({
        homeDir: "/home/tester"
      })
    ).toEqual({
      home: "/home/tester/.sdkwork/hub-installer",
      configDir: "/home/tester/.sdkwork/hub-installer/config",
      cacheDir: "/home/tester/.sdkwork/hub-installer/cache",
      registryCacheDir: "/home/tester/.sdkwork/hub-installer/cache/registry",
      manifestCacheDir: "/home/tester/.sdkwork/hub-installer/cache/manifests",
      packageCacheDir: "/home/tester/.sdkwork/hub-installer/cache/packages",
      stateDir: "/home/tester/.sdkwork/hub-installer/state",
      sourcesDir: "/home/tester/.sdkwork/hub-installer/state/sources",
      tempDir: "/home/tester/.sdkwork/hub-installer/state/tmp",
      installRecordsDir: "/home/tester/.sdkwork/hub-installer/state/install-records",
      logsDir: "/home/tester/.sdkwork/hub-installer/logs",
      configFile: "/home/tester/.sdkwork/hub-installer/config/config.json"
    });
  });
});
