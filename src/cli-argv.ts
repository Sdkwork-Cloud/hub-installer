const TOP_LEVEL_COMMANDS = new Set([
  "detect",
  "plan",
  "install",
  "validate",
  "apply",
  "registry",
  "list",
  "ls",
  "info",
  "doctor",
  "help"
]);

export function normalizeCliArgv(argv: string[]): string[] {
  if (argv.length < 3 || argv[0] === undefined || argv[1] === undefined) {
    return argv;
  }

  const firstArg = argv[2]?.trim() ?? "";
  if (!firstArg || firstArg.startsWith("-")) {
    return argv;
  }

  if (TOP_LEVEL_COMMANDS.has(firstArg)) {
    return argv;
  }

  return [argv[0], argv[1], "install", ...argv.slice(2)];
}
