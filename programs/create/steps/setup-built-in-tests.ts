//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'
import * as messages from '../lib/messages'

export async function setupBuiltInTests(
  projectPath: string,
  projectName: string
) {
  try {
    // Remove the existing test spec templates.spec.ts
    const testSpecPath = path.join(projectPath, 'tests', 'templates.spec.ts')
    await fs.unlink(testSpecPath)
  } catch (error: any) {
    console.error(messages.cantSetupBuiltInTests(projectName, error))

    process.exit(1)
  }
}
