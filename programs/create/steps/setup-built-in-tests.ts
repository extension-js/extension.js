//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as path from 'path'
import * as fs from 'fs'
import * as messages from '../lib/messages'

export async function setupBuiltInTests(
  projectPath: string,
  projectName: string
) {
  try {
    // Remove the existing test spec templates.spec.ts
    const testSpecPath = path.join(projectPath, 'tests', 'templates.spec.ts')

    if (fs.existsSync(testSpecPath)) {
      fs.unlinkSync(testSpecPath)
    }
  } catch (error: any) {
    console.error(messages.cantSetupBuiltInTests(projectName, error))
    throw error
  }
}
