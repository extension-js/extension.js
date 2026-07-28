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

export async function writeManifestJson(
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
) {
  // Templates may store the manifest at `src/manifest.json` instead of root.
  // Prefer root if present, fallback to src.
  const manifestJsonPath = await findManifestJsonPath(projectPath)

  const manifestJsonContent = await fs.readFile(manifestJsonPath)
  const manifestJson = JSON.parse(manifestJsonContent.toString())

  const manifestMetadata = {
    ...manifestJson,
    name: path.basename(projectPath),
    author: 'Your Name'
  }

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
}
