//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {renderExtensionEnvTypes} from '../../develop/lib/extension-env-template'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'

export async function generateExtensionTypes(
  projectPath: string,
  projectName: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
) {
  const extensionEnvFile = path.join(projectPath, 'extension-env.d.ts')
  const fileContent = renderExtensionEnvTypes()

  try {
    await fs.mkdir(projectPath, {recursive: true})

    if (isDebug()) logger.log(messages.writingTypeDefinitions(projectName))

    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (error) {
    logger.error(messages.writingTypeDefinitionsError(error))
    throw error
  }
}
