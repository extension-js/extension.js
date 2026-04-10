// Content script entry naming contracts — inlined from develop's
// plugin-web-extension/feature-scripts/contracts.ts to avoid cross-package import.

export const CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX = 'content_scripts/content-'

export function getCanonicalContentScriptEntryName(index: number): string {
  return `${CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX}${index}`
}
