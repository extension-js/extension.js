import type {BuildOptions} from '../../types'

// One production build of a fixture as a spec runs it: no install, no output,
// Chrome unless the spec names another browser.
export async function buildProject(
  root: string,
  options: Partial<Record<keyof BuildOptions, unknown>> = {}
) {
  const {extensionBuild} = await import('../../command-build')

  return extensionBuild(root, {
    browser: 'chrome',
    silent: true,
    install: false,
    ...options
  } as BuildOptions)
}
