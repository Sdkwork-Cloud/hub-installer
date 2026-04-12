import path from "node:path";
import os from "node:os";
import { HubInstallerError } from "../errors";
import type { SupportedPlatform } from "../types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getTokenValue(token: string, variables: Record<string, string>): string {
  const tokenValue = variables[token];
  if (tokenValue !== undefined) {
    return tokenValue;
  }

  throw new HubInstallerError("UNKNOWN_VARIABLE", `Unknown template variable: ${token}`);
}

export function renderStringTemplate(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, token: string) =>
    getTokenValue(token, variables)
  );
}

function resolveVariableReferences(input: Record<string, string>): Record<string, string> {
  const output = { ...input };

  for (let index = 0; index < 10; index += 1) {
    let changed = false;
    for (const [key, value] of Object.entries(output)) {
      const next = value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (full, token: string) => {
        const replacement = output[token];
        return replacement ?? full;
      });
      if (next !== value) {
        output[key] = next;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return output;
}

export function renderTemplateDeep<T>(value: T, variables: Record<string, string>): T {
  if (typeof value === "string") {
    return renderStringTemplate(value, variables) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => renderTemplateDeep(entry, variables)) as T;
  }

  if (isRecord(value)) {
    const output: UnknownRecord = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = renderTemplateDeep(entry, variables);
    }
    return output as T;
  }

  return value;
}

export function buildRuntimeVariables(input: {
  baseDirectory: string;
  platform: SupportedPlatform;
  manifestVariables?: Record<string, string>;
  overrideVariables?: Record<string, string>;
  runtimeVariables?: Record<string, string>;
  cwd?: string;
}): Record<string, string> {
  const output: Record<string, string> = {
    platform: input.platform,
    manifestDir: input.baseDirectory,
    cwd: input.cwd ?? process.cwd(),
    home: os.homedir(),
    temp: os.tmpdir(),
    user: os.userInfo().username,
    pathSeparator: path.sep,
    hub_container_runtime: "",
    hub_wsl_distribution: "",
    hub_docker_context: "",
    hub_docker_host: "",
    hub_backup_root: "",
    hub_backup_session_dir: "",
    hub_backup_data_dir: "",
    hub_backup_install_dir: "",
    hub_backup_work_dir: "",
    hub_install_record_file: "",
    hub_install_status: ""
  };

  Object.assign(output, input.runtimeVariables ?? {});
  Object.assign(output, input.manifestVariables ?? {});
  Object.assign(output, input.overrideVariables ?? {});

  return resolveVariableReferences(output);
}
