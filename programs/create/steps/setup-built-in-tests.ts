//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import * as messages from '../lib/messages'

export async function setupBuiltInTests(
  projectPath: string,
  projectName: string,
  logger: {log(...args: any[]): void; error(...args: any[]): void}
) {
  try {
    // Remove the existing test spec templates.spec.ts
    const testSpecPath = path.join(projectPath, 'tests', 'templates.spec.ts')

    if (fs.existsSync(testSpecPath)) {
      fs.unlinkSync(testSpecPath)
    }
  } catch (error: any) {
    logger.error(messages.cantSetupBuiltInTests(projectName, error))
    throw error
  }
}
