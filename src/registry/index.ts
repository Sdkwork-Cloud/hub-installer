export * from "./types";
export {
  DEFAULT_REGISTRY_FILE_NAMES,
  type LoadRegistryOptions,
  loadSoftwareRegistryFromFile,
  loadSoftwareRegistryFromSource
} from "./loader";
export { validateSoftwareRegistry } from "./validate";
export {
  DEFAULT_REGISTRY_CANDIDATES,
  getDefaultRegistrySource,
  resolveSoftwareEntry
} from "./resolver";
export {
  backupSoftwareFromRegistry,
  getRegistryEntry,
  installSoftwareFromRegistry,
  listRegistryEntries,
  loadRegistry,
  uninstallSoftwareFromRegistry
} from "./service";
export {
  runRegistryDoctor,
  type DoctorTarget,
  type RegistryDoctorCheck,
  type RegistryDoctorOptions,
  type RegistryDoctorReport
} from "./doctor";
