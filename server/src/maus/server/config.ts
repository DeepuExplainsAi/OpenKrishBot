import { homedir } from "node:os";
import { join } from "node:path";
export const DATA_DIR = join(homedir(), ".openkrishbot");
export { PROVIDER_CREDENTIAL_ENV, stripWorkspaceCredentialEnv } from "./credential-env.ts";
