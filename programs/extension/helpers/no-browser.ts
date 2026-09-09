// ███╗   ██╗ ██████╗       ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗
// ████╗  ██║██╔═══██╗      ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗
// ██╔██╗ ██║██║   ██║█████╗██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝
// ██║╚██╗██║██║   ██║╚════╝██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗
// ██║ ╚████║╚██████╔╝      ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║
// ╚═╝  ╚═══╝ ╚═════╝       ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {loadExtensionDevelopModule} from './extension-develop-runtime'

// --no-browser and --no-open used to read as the same sentence. One line, shared
// by every command that takes both, names the one that stops the launch.
export const BROWSER_LAUNCH_HELP_FOOTER =
  '\nTo stop the browser launch, use --no-browser.\n' +
  'To launch the browser without opening a tab for your extension, use --no-open.\n'

// The browser process still starts under --no-open. What it skips is the tab
// Extension.js opens for the extension after launch.
export const NO_OPEN_FLAG_DESCRIPTION =
  'launch the browser but do not open a tab for your extension. To stop the browser launch itself, use --no-browser'

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
