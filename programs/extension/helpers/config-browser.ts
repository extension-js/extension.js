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
  mode?: string
): Promise<string | undefined> {
  try {
    const develop: DevelopFor = await loadDevelop()
    if (typeof develop.loadCommandConfig !== 'function') return undefined

    const config = await develop.loadCommandConfig(projectPath, command, {
      mode: mode || undefined,
      browser: STOCK_BROWSER
    })
    const browser = config.browser

    return typeof browser === 'string' && browser.length > 0
      ? browser
      : undefined
  } catch {
    // The engine loads the same config before it builds or launches and fails
    // the run with its own code, so answering unset here keeps one report.
    return undefined
  }
}
