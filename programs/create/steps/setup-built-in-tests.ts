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
import {CODES} from '../lib/messaging'
import {failStep} from '../lib/utils'

export async function setupBuiltInTests(projectPath: string) {
  try {
    const testSpecPath = path.join(projectPath, 'tests', 'templates.spec.ts')

    if (fs.existsSync(testSpecPath)) {
      fs.unlinkSync(testSpecPath)
    }
  } catch (error) {
    throw failStep(
      messages.cantSetupBuiltInTests(error),
      error,
      CODES.E_DESTINATION_NOT_WRITABLE
    )
  }
}
