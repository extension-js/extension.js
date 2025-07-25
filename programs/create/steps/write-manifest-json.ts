//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as path from 'path'
import * as fs from 'fs/promises'
import * as messages from '../lib/messages'

export async function writeManifestJson(
  projectPath: string,
  projectName: string
) {
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

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
      path.join(projectPath, 'manifest.json'),
      JSON.stringify(manifestMetadata, null, 2)
    )
  } catch (error: any) {
    console.error(messages.writingManifestJsonMetadataError(projectName, error))
    throw error
  }
}
