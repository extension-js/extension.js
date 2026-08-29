// ██████╗ ██████╗ ███╗   ██╗███████╗██╗ ██████╗       ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗
// ██╔════╝██╔═══██╗████╗  ██║██╔════╝██║██╔════╝       ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗
// ██║     ██║   ██║██╔██╗ ██║█████╗  ██║██║  ███╗█████╗██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝
// ██║     ██║   ██║██║╚██╗██║██╔══╝  ██║██║   ██║╚════╝██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗
// ╚██████╗╚██████╔╝██║ ╚████║██║     ██║╚██████╔╝      ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║
//  ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝     ╚═╝ ╚═════╝       ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {loadExtensionDevelopModule} from './extension-develop-runtime'

// The wrapper picks the vendor list before calling develop, so the file
// config's commands.<cmd>.browser must be read here; a typed flag wins.
export async function resolveConfigBrowser(
  projectPath: string,
  command: 'dev' | 'build' | 'start' | 'preview'
): Promise<string | undefined> {
  try {
    const develop = await loadExtensionDevelopModule<{
      loadCommandConfig?: (
        p: string,
        c: 'dev' | 'build' | 'start' | 'preview'
      ) => Promise<unknown>
    }>()
    if (typeof develop.loadCommandConfig !== 'function') return undefined
    const config = await develop.loadCommandConfig(projectPath, command)
    const browser = (config as {browser?: unknown})?.browser
    return typeof browser === 'string' && browser.length > 0
      ? browser
      : undefined
  } catch {
    return undefined
  }
}
