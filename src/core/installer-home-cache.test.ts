import { describe, expect, it } from "vitest";
import { getDefaultPackageCacheDir } from "./download";
import { getDefaultManifestCacheDir } from "../manifest/loader";
import { getDefaultRegistryCacheDir } from "../registry/loader";

describe("installer-home cache defaults", () => {
  it("uses installer-home subdirectories instead of OS temp directories", () => {
    const installerHome = "/home/tester/.sdkwork/hub-installer";

    expect(getDefaultPackageCacheDir(installerHome)).toBe(
      "/home/tester/.sdkwork/hub-installer/cache/packages"
    );
    expect(getDefaultManifestCacheDir(installerHome)).toBe(
      "/home/tester/.sdkwork/hub-installer/cache/manifests"
    );
    expect(getDefaultRegistryCacheDir(installerHome)).toBe(
      "/home/tester/.sdkwork/hub-installer/cache/registry"
    );
  });
});
