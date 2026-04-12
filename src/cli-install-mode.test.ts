import { describe, expect, it } from "vitest";
import {
  detectInstallMode,
  shouldUseManifestInstall,
  shouldUseRegistryInstall
} from "./cli-install-mode";

describe("shouldUseRegistryInstall", () => {
  it("returns true for plain software names", () => {
    expect(shouldUseRegistryInstall("openclaw")).toBe(true);
    expect(shouldUseRegistryInstall("nodejs")).toBe(true);
    expect(shouldUseRegistryInstall("python")).toBe(true);
  });

  it("returns false for uri sources", () => {
    expect(shouldUseRegistryInstall("winget://Git.Git")).toBe(false);
    expect(shouldUseRegistryInstall("https://example.com/tool.msi")).toBe(false);
    expect(shouldUseRegistryInstall("file:///tmp/tool.msi")).toBe(false);
  });

  it("returns false for path-like values and package files", () => {
    expect(shouldUseRegistryInstall("./tool.msi")).toBe(false);
    expect(shouldUseRegistryInstall("examples/full-stack.hub.yaml")).toBe(false);
    expect(shouldUseRegistryInstall("C:\\downloads\\tool.msi")).toBe(false);
    expect(shouldUseRegistryInstall("tool.msi")).toBe(false);
  });
});

describe("shouldUseManifestInstall", () => {
  it("returns true for manifest-like sources", () => {
    expect(shouldUseManifestInstall("./examples/openclaw.hub.yaml")).toBe(true);
    expect(shouldUseManifestInstall("hub-installer.yaml")).toBe(true);
    expect(
      shouldUseManifestInstall("https://example.com/manifests/prod.hub.yaml")
    ).toBe(true);
  });

  it("returns false for plain software names and package URIs", () => {
    expect(shouldUseManifestInstall("openclaw")).toBe(false);
    expect(shouldUseManifestInstall("winget://Git.Git")).toBe(false);
    expect(shouldUseManifestInstall("tool.msi")).toBe(false);
  });
});

describe("detectInstallMode", () => {
  it("detects registry mode for software names", () => {
    expect(detectInstallMode("openclaw")).toBe("registry");
    expect(detectInstallMode("python")).toBe("registry");
  });

  it("detects manifest mode for manifest sources", () => {
    expect(detectInstallMode("./examples/openclaw.hub.yaml")).toBe("manifest");
    expect(detectInstallMode("https://example.com/manifests/prod.hub.yaml")).toBe(
      "manifest"
    );
  });

  it("detects package mode for package sources", () => {
    expect(detectInstallMode("tool.msi")).toBe("package");
    expect(detectInstallMode("winget://Git.Git")).toBe("package");
  });
});
