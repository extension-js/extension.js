import type {BrowserDefaulted, BuildOptions} from '../../types'

// One production build of a fixture as a spec runs it: no install, no output,
// Chrome unless the spec names another browser.
export async function buildProject(
  root: string,
  options: BrowserDefaulted<BuildOptions> = {}
) {
  const {extensionBuild} = await import('../../command-build')

  return extensionBuild(root, {
    browser: 'chrome',
    silent: true,
    install: false,
    ...options
  })
}
