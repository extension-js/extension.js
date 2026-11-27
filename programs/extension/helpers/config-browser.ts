// ██████╗ ██████╗ ███╗   ██╗███████╗██╗ ██████╗       ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗
// ██╔════╝██╔═══██╗████╗  ██║██╔════╝██║██╔════╝       ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗
// ██║     ██║   ██║██╔██╗ ██║█████╗  ██║██║  ███╗█████╗██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝
// ██║     ██║   ██║██║╚██╗██║██╔══╝  ██║██║   ██║╚════╝██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗
// ╚██████╗╚██████╔╝██║ ╚████║██║     ██║╚██████╔╝      ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║
//  ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝     ╚═╝ ╚═════╝       ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  type DevelopFor,
  loadExtensionDevelopModule
} from './extension-develop-runtime'

// The browser that runs when neither a flag nor the config names one.
const STOCK_BROWSER = 'chromium'

// The wrapper picks the vendor list before calling develop, so the file
// config's commands.<cmd>.browser must be read here. A typed flag wins.
// No browser is known yet, so the config is read as the stock one would
// read it, which is how the engine makes the same probe.
export async function resolveConfigBrowser(
  projectPath: string,
  command: 'dev' | 'build' | 'start' | 'preview',
  loadDevelop: () => Promise<DevelopFor> = loadExtensionDevelopModule,
  // The mode a build was asked for. Unset, it follows the command.
  mode?: string,
  // False when the run was told not to install, or never installs.
  install?: boolean
): Promise<string | undefined> {
  try {
    const develop: DevelopFor = await loadDevelop()
    const load = develop.loadCommandConfig
    if (typeof load !== 'function') return undefined

    const read = async () => {
      const {browser} = await load(projectPath, command, {
        mode: mode || undefined,
        browser: STOCK_BROWSER
      })

      return typeof browser === 'string' && browser.length > 0
        ? browser
        : undefined
    }

    try {
      return await read()
    } catch (error) {
      // A config that resolves a declared package fails in a folder with no
      // node_modules, so the install runs first and the read repeats.
      const installMissing = develop.installMissingProjectDependencies

      if (install === false || typeof installMissing !== 'function') throw error
      if (!(await installMissing(projectPath))) throw error

      return await read()
    }
  } catch {
    // The engine loads the same config before it builds or launches and fails
    // the run with its own code, so answering unset here keeps one report.
    return undefined
  }
}
