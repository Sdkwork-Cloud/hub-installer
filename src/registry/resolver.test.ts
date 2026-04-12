import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getDefaultRegistryCandidates,
  getDefaultRegistrySource
} from "./resolver";

describe("registry default resolver", () => {
  it("finds bundled default software registry", () => {
    const resolved = getDefaultRegistrySource();
    expect(path.basename(resolved)).toBe("software-registry.yaml");
    expect(resolved).toContain(`${path.sep}registry${path.sep}`);
  });

  it("builds package-root fallback candidates even when cwd does not contain registry", () => {
    const fakeCwd = path.resolve(process.cwd(), "__missing_registry_cwd__");
    const moduleUrl = pathToFileURL(
      path.resolve(process.cwd(), "src", "registry", "resolver.ts")
    ).toString();

    const candidates = getDefaultRegistryCandidates({
      cwd: fakeCwd,
      moduleUrl
    });

    expect(candidates).toContain(
      path.resolve(fakeCwd, "registry", "software-registry.yaml")
    );
    expect(candidates).toContain(
      path.resolve(process.cwd(), "registry", "software-registry.yaml")
    );
  });

  it("reports tried default registry candidates when none exists", () => {
    const fakeCwd = path.resolve(process.cwd(), "__missing_registry_cwd__");
    const fakeModuleUrl = pathToFileURL(
      path.resolve(fakeCwd, "src", "registry", "resolver.ts")
    ).toString();

    expect(() =>
      getDefaultRegistrySource({
        cwd: fakeCwd,
        moduleUrl: fakeModuleUrl
      })
    ).toThrowError(/Default software registry not found\. Tried:/);
  });
});
