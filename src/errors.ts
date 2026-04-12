export class HubInstallerError extends Error {
  public readonly code: string;

  public readonly cause?: unknown;

  public constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "HubInstallerError";
    this.code = code;
    this.cause = cause;
  }
}

