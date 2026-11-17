//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  projectBringsOwnChromeTypes,
  renderExtensionEnvTypes
} from '../../develop/lib/extension-env-template'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'
import {failStep} from '../lib/utils'

export async function generateExtensionTypes(
  projectPath: string,
  projectName: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
) {
  const extensionEnvFile = path.join(projectPath, 'extension-env.d.ts')
  const fileContent = renderExtensionEnvTypes(
    undefined,
    {},
    {ownChromeTypes: projectBringsOwnChromeTypes(projectPath)}
  )

  try {
    await fs.mkdir(projectPath, {recursive: true})

    if (isDebug()) logger.log(messages.writingTypeDefinitions(projectName))

    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (error) {
    throw failStep(messages.writingTypeDefinitionsError(error), error)
  }
}
