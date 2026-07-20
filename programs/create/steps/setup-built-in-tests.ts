//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as messages from '../lib/messages'

export async function setupBuiltInTests(
  projectPath: string,
  projectName: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
) {
  try {
    const testSpecPath = path.join(projectPath, 'tests', 'templates.spec.ts')

    if (fs.existsSync(testSpecPath)) {
      fs.unlinkSync(testSpecPath)
    }
  } catch (error) {
    logger.error(messages.cantSetupBuiltInTests(projectName, error))
    throw error
  }
}
