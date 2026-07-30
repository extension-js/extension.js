// ███╗   ██╗ ██████╗       ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗
// ████╗  ██║██╔═══██╗      ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗
// ██╔██╗ ██║██║   ██║█████╗██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝
// ██║╚██╗██║██║   ██║╚════╝██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗
// ██║ ╚████║╚██████╔╝      ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║
// ╚═╝  ╚═══╝ ╚═════╝       ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {loadExtensionDevelopModule} from './extension-develop-runtime'

// The --no-browser flag travels on the environment (set at parse time). The
// file config's commands.<cmd>.noBrowser reaches the same decision, flag wins.
export async function resolveNoBrowser(
  projectPath: string,
  command: 'dev' | 'start' | 'preview'
): Promise<boolean> {
  if (process.env.EXTENSION_CLI_NO_BROWSER === '1') return true
  try {
    const develop = await loadExtensionDevelopModule<{
      loadCommandConfig?: (
        p: string,
        c: 'dev' | 'build' | 'start' | 'preview'
      ) => Promise<unknown>
    }>()
    if (typeof develop.loadCommandConfig !== 'function') return false
    const config = await develop.loadCommandConfig(projectPath, command)
    return (config as {noBrowser?: unknown})?.noBrowser === true
  } catch {
    return false
  }
}
