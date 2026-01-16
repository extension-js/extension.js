//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs/promises'
import * as messages from '../lib/messages'

export async function writeManifestJson(
  projectPath: string,
  projectName: string
) {
  // Templates may store the manifest at `src/manifest.json` instead of root.
  // Prefer root if present, fallback to src.
  const manifestJsonPath = await (async () => {
    const root = path.join(projectPath, 'manifest.json')
    const src = path.join(projectPath, 'src', 'manifest.json')
    try {
      await fs.access(root)
      return root
    } catch {}
    return src
  })()

  const manifestJsonContent = await fs.readFile(manifestJsonPath)
  const manifestJson = JSON.parse(manifestJsonContent.toString())

  const manifestMetadata = {
    ...manifestJson,
    name: path.basename(projectPath),
    author: 'Your Name'
  }

  try {
    console.log(messages.writingManifestJsonMetadata())
    await fs.writeFile(
      manifestJsonPath,
      JSON.stringify(manifestMetadata, null, 2)
    )
  } catch (error: any) {
    console.error(messages.writingManifestJsonMetadataError(projectName, error))
    throw error
  }
}
