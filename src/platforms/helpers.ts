import path from "node:path";
import { HubInstallerError } from "../errors";
import type {
  InstallStep,
  ManagerSource,
  PackageManager,
  ResolvedInstallRequest
} from "../types";

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function validateArchiveEntry(entry: string): string {
  const normalized = entry.replace(/\\/g, "/").trim();

  if (!normalized) {
    throw new HubInstallerError("INVALID_ARCHIVE_ENTRY", "archiveEntry is empty.");
  }

  if (normalized.startsWith("/") || normalized.includes("..")) {
    throw new HubInstallerError(
      "INVALID_ARCHIVE_ENTRY",
      "archiveEntry must be a relative path inside archive."
    );
  }

  return normalized;
}

export function quoteSh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function ensureFileSource(request: ResolvedInstallRequest): string {
  if (request.sourceRef.kind !== "file") {
    throw new HubInstallerError(
      "INVALID_SOURCE",
      `Format "${request.format}" expects a file source, received manager source instead.`
    );
  }

  return request.sourceRef.path;
}

export function ensureManagerSource(
  request: ResolvedInstallRequest,
  allowedManagers: readonly PackageManager[]
): ManagerSource {
  if (request.sourceRef.kind !== "manager") {
    throw new HubInstallerError(
      "INVALID_SOURCE",
      "Format \"manager\" expects source like \"<manager>://<packageName>\"."
    );
  }

  if (!allowedManagers.includes(request.sourceRef.manager)) {
    throw new HubInstallerError(
      "UNSUPPORTED_MANAGER",
      `Manager "${request.sourceRef.manager}" is not supported on platform "${request.platform}".`
    );
  }

  return request.sourceRef;
}

export function buildUnixArchiveSteps(
  request: ResolvedInstallRequest,
  sourcePath: string
): InstallStep[] {
  const baseName = path
    .basename(sourcePath)
    .replace(/\.(tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tar|zip)$/i, "");
  const extractDir = path.posix.join("/tmp/hub-installer", sanitizeSegment(baseName));

  const extractCommand =
    request.format === "zip"
      ? `mkdir -p ${quoteSh(extractDir)} && unzip -o ${quoteSh(sourcePath)} -d ${quoteSh(extractDir)}`
      : `mkdir -p ${quoteSh(extractDir)} && tar -xf ${quoteSh(sourcePath)} -C ${quoteSh(extractDir)}`;

  const steps: InstallStep[] = [
    {
      id: "extract-archive",
      description: `Extract ${request.format} archive`,
      command: extractCommand,
      shell: true
    }
  ];

  if (request.archiveCommand) {
    steps.push({
      id: "run-archive-command",
      description: "Run custom archive command",
      command: `set -e; cd ${quoteSh(extractDir)}; ${request.archiveCommand}`,
      shell: true
    });
    return steps;
  }

  if (!request.archiveEntry) {
    throw new HubInstallerError(
      "ARCHIVE_ENTRY_REQUIRED",
      `Archive format "${request.format}" requires archiveEntry or archiveCommand.`
    );
  }

  const entry = validateArchiveEntry(request.archiveEntry);
  const executable = entry.startsWith("./") ? entry : `./${entry}`;
  const args = (request.installerArgs ?? []).map(quoteSh).join(" ");
  const runCommand = `set -e; cd ${quoteSh(extractDir)}; chmod +x ${quoteSh(entry)}; ${quoteSh(executable)}${
    args ? ` ${args}` : ""
  }`;

  steps.push({
    id: "run-archive-entry",
    description: "Run archive entry installer",
    command: runCommand,
    shell: true
  });

  return steps;
}

export function buildWindowsArchiveSteps(
  request: ResolvedInstallRequest,
  sourcePath: string
): InstallStep[] {
  const baseName = path
    .basename(sourcePath)
    .replace(/\.(tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tar|zip)$/i, "");
  const tempRoot = process.env.TEMP ?? "C:\\Windows\\Temp";
  const extractDir = path.win32.join(tempRoot, "hub-installer", sanitizeSegment(baseName));

  const extractScript =
    request.format === "zip"
      ? `$dest = ${quotePowerShell(extractDir)}; New-Item -ItemType Directory -Path $dest -Force | Out-Null; Expand-Archive -LiteralPath ${quotePowerShell(
          sourcePath
        )} -DestinationPath $dest -Force`
      : `$dest = ${quotePowerShell(extractDir)}; New-Item -ItemType Directory -Path $dest -Force | Out-Null; tar -xf ${quotePowerShell(
          sourcePath
        )} -C $dest`;

  const steps: InstallStep[] = [
    {
      id: "extract-archive",
      description: `Extract ${request.format} archive`,
      command: "powershell",
      args: ["-NoProfile", "-Command", extractScript]
    }
  ];

  if (request.archiveCommand) {
    const runScript = `$dest = ${quotePowerShell(
      extractDir
    )}; Set-Location -LiteralPath $dest; ${request.archiveCommand}`;
    steps.push({
      id: "run-archive-command",
      description: "Run custom archive command",
      command: "powershell",
      args: ["-NoProfile", "-Command", runScript]
    });
    return steps;
  }

  if (!request.archiveEntry) {
    throw new HubInstallerError(
      "ARCHIVE_ENTRY_REQUIRED",
      `Archive format "${request.format}" requires archiveEntry or archiveCommand.`
    );
  }

  const entry = validateArchiveEntry(request.archiveEntry).replace(/\//g, "\\");
  const args = (request.installerArgs ?? []).map(quotePowerShell).join(" ");
  const runScript = `$dest = ${quotePowerShell(
    extractDir
  )}; $entry = Join-Path $dest ${quotePowerShell(entry)}; Set-Location -LiteralPath $dest; & $entry ${
    args || ""
  }`;

  steps.push({
    id: "run-archive-entry",
    description: "Run archive entry installer",
    command: "powershell",
    args: ["-NoProfile", "-Command", runScript]
  });

  return steps;
}

export function buildArchiveStepsForHost(
  request: ResolvedInstallRequest,
  sourcePath: string
): InstallStep[] {
  if (process.platform === "win32") {
    return buildWindowsArchiveSteps(request, sourcePath);
  }

  return buildUnixArchiveSteps(request, sourcePath);
}

