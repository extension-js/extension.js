//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {randomUUID} from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {readManifestJson} from '../lib/find-manifest-json'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'

// Every key that can hold a Firefox add-on id, plain or browser-prefixed.
// `applications` is the retired MV2 spelling of the same block.
const ADDON_ID_HOLDER =
  /^(?:[a-z][a-z0-9-]*:)?(?:browser_specific_settings|applications)$/
const ADDON_ID_BLOCKS = ['gecko', 'gecko_android']

// The braces form Firefox has always accepted for an add-on id, and the one
// shape that needs no domain: an `@extension.js` or `@my-name` suffix claims a
// namespace the project does not own.
export function createAddonId(): string {
  return `{${randomUUID()}}`
}

// A gecko id IS the add-on, so a template that ships one hands the same
// identity to every project cut from it: two differently named scaffolds built
// the same `init@extension.js` add-on. The id cannot simply go, because
// Firefox requires one from MV3 on and addons-linter fails the store check
// without it, so each project gets a fresh one of its own.
//
// One id per manifest, reused across the blocks it has: `gecko` and
// `gecko_android` describe the same add-on, not two.
function rewriteAddonIds(
  manifest: Record<string, unknown>,
  generateAddonId: () => string
): {replaced: string[]; addonId?: string} {
  const replaced: string[] = []
  let addonId: string | undefined

  for (const key of Object.keys(manifest)) {
    if (!ADDON_ID_HOLDER.test(key)) continue

    const settings = manifest[key]
    if (!settings || typeof settings !== 'object') continue

    const holder = settings as Record<string, unknown>

    for (const blockName of ADDON_ID_BLOCKS) {
      const block = holder[blockName]
      if (!block || typeof block !== 'object') continue

      const gecko = block as Record<string, unknown>
      const current = gecko.id

      // An id belongs in `gecko`. A `gecko_android` block carries one only
      // when the template put it there, and then it is the same add-on, so it
      // is replaced rather than left pointing at the template.
      if (typeof current !== 'string' && blockName !== 'gecko') continue

      if (!addonId) addonId = generateAddonId()
      if (typeof current === 'string') replaced.push(current)

      gecko.id = addonId
    }
  }

  return {replaced, addonId}
}

/* @invariant The manifest is the extension's identity, so every field it
 * carries out of here is either the user's or generated for this project
 * alone. The template's own name is replaced, its author is dropped, and its
 * Firefox add-on id is replaced with a fresh GUID: an author we cannot read is
 * not a string we may invent and `Your Name` reached the store listing, while
 * an id asserts nothing about the author and only says which add-on this is,
 * so generating one tells the truth where inheriting the template's did not.
 * A manifest with no gecko block keeps none: a block we invent would be a
 * Firefox opinion the template never expressed. */
export async function writeManifestJson(
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void},
  // Injected so a spec can pin the written shape instead of matching a UUID.
  generateAddonId: () => string = createAddonId
): Promise<string> {
  // Templates may store the manifest at `src/manifest.json` instead of root.
  // Prefer root if present, fallback to src.
  const {manifestJsonPath, manifestJson} = await readManifestJson(projectPath)
  const templateName = String(manifestJson.name || '').trim()

  const manifestMetadata: Record<string, unknown> = {
    ...structuredClone(manifestJson),
    name: path.basename(projectPath)
  }
  delete manifestMetadata.author
  const {replaced, addonId} = rewriteAddonIds(manifestMetadata, generateAddonId)

  try {
    if (isDebug()) {
      logger.log(messages.writingManifestJsonMetadata())

      if (addonId) {
        logger.log(messages.wroteProjectAddonId(addonId, replaced))
      }
    }

    await fs.writeFile(
      manifestJsonPath,
      JSON.stringify(manifestMetadata, null, 2)
    )
  } catch (error) {
    logger.error(messages.writingManifestJsonMetadataError(error))

    throw error
  }

  return templateName
}
