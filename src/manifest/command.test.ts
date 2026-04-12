import { describe, expect, it } from "vitest";
import { toInstallStep } from "./command";
import type { ManifestCommand } from "./types";

describe("toInstallStep", () => {
  it("uses command id as default description instead of full script text", () => {
    const command: ManifestCommand = {
      id: "install-openclaw-win",
      shell: "powershell",
      run: "Write-Host \"very long command script...\""
    };

    const step = toInstallStep(command, {
      index: 0,
      defaultCwd: process.cwd(),
      baseDirectory: process.cwd()
    });

    expect(step.description).toBe("install-openclaw-win");
  });
});
