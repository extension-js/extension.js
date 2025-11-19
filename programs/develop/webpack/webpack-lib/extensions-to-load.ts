import * as fs from 'fs'
import * as path from 'path'
import {devtoolsEngineFor} from './paths'

export function computeExtensionsToLoad(
  baseDir: string,
  mode: 'development' | 'production' | 'none' | string | undefined,
  browser: string,
  userExtensionOutputPath: string
): string[] {
  const list: string[] = []
  try {
    // Dist roots mirrored by programs/develop build pipeline
    const engine = devtoolsEngineFor(browser as any)
    const devtoolsRoot = path.resolve(baseDir, '../dist/extension-js-devtools')
    const themeRoot = path.resolve(baseDir, '../dist/extension-js-theme')

    const devtoolsForBrowser = path.join(devtoolsRoot, engine)
    const themeForBrowser = path.join(themeRoot, engine)

    // Load DevTools only in non-production (development watch)
    if (mode !== 'production' && fs.existsSync(devtoolsForBrowser)) {
      list.push(devtoolsForBrowser)
    }

    // Always load the theme when available (dev and preview)
    if (fs.existsSync(themeForBrowser)) {
      list.push(themeForBrowser)
    }
  } catch {
    // ignore
  }

  // Always load the user extension last to give it precedence on conflicts
  list.push(userExtensionOutputPath)
  return list
}
