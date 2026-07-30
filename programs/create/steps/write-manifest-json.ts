//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {findManifestJsonPath} from '../lib/find-manifest-json'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'

/* @invariant The manifest is the extension's identity, so every field it
 * carries out of here is either the user's or absent. The template's own name
 * is replaced and its author is dropped: an author we cannot read is not a
 * string we may invent, and `Your Name` reached the store listing. */
export async function writeManifestJson(
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
): Promise<string> {
  // Templates may store the manifest at `src/manifest.json` instead of root.
  // Prefer root if present, fallback to src.
  const manifestJsonPath = await findManifestJsonPath(projectPath)

  const manifestJsonContent = await fs.readFile(manifestJsonPath)
  const manifestJson = JSON.parse(manifestJsonContent.toString())
  const templateName = String(manifestJson.name || '').trim()

  const manifestMetadata: Record<string, unknown> = {
    ...manifestJson,
    name: path.basename(projectPath)
  }
  delete manifestMetadata.author

  try {
    if (isDebug()) logger.log(messages.writingManifestJsonMetadata())
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
