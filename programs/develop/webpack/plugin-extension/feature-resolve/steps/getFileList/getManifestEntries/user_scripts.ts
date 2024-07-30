import { type ManifestData } from './types.js';

export function userScripts(manifest: ManifestData) {
  if (
    !manifest ||
    !manifest.user_scripts ||
    !manifest.user_scripts.api_script
  ) {
    return undefined;
  }

  const userScript = manifest.user_scripts.api_script;

  const scriptAbsolutePath = userScript;

  return scriptAbsolutePath;
}
