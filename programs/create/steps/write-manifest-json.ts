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

export async function writeManifestJson(
  projectPath: string,
  projectName: string,
  logger: {log(...args: any[]): void; error(...args: any[]): void}
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
    logger.log(messages.writingManifestJsonMetadata())
    await fs.writeFile(
      manifestJsonPath,
      JSON.stringify(manifestMetadata, null, 2)
    )
  } catch (error: any) {
    logger.error(messages.writingManifestJsonMetadataError(projectName, error))
    throw error
  }
}
