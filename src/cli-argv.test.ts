import { describe, expect, it } from "vitest";
import { normalizeCliArgv } from "./cli-argv";

describe("normalizeCliArgv", () => {
  it("injects install for shorthand source usage", () => {
    const input = ["node", "cli.mjs", "openclaw"];
    const output = normalizeCliArgv(input);
    expect(output).toEqual(["node", "cli.mjs", "install", "openclaw"]);
  });

  it("keeps shorthand secondary method argument", () => {
    const input = ["node", "cli.mjs", "openclaw", "docker"];
    const output = normalizeCliArgv(input);
    expect(output).toEqual(["node", "cli.mjs", "install", "openclaw", "docker"]);
  });

  it("keeps explicit command usage unchanged", () => {
    const input = ["node", "cli.mjs", "install", "openclaw"];
    const output = normalizeCliArgv(input);
    expect(output).toEqual(input);
  });

  it("keeps doctor command usage unchanged", () => {
    const input = ["node", "cli.mjs", "doctor", "openclaw"];
    const output = normalizeCliArgv(input);
    expect(output).toEqual(input);
  });

  it("keeps option-only usage unchanged", () => {
    const input = ["node", "cli.mjs", "--help"];
    const output = normalizeCliArgv(input);
    expect(output).toEqual(input);
  });
});
