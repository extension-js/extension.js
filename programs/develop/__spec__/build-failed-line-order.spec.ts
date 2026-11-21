import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

afterEach(() => vi.restoreAllMocks())

// The last lines of a failed build are the ones still on screen, so they are
// the errors and the count. Warnings come first and scroll away above them.
describe('the lines of a build that fails with a warning beside the error', () => {
  it('prints the warning, then the error, then the count', async () => {
    const root = fs.realpathSync(tempFolder('extjs-line-order-'))
    const printed: string[] = []

    writeExtensionProject(root, {
      manifest: {name: 'Probe', background: {service_worker: 'background.js'}},
      packageJson: {name: 'probe', version: '1.0.0'}
    })

    fs.writeFileSync(
      path.join(root, 'background.js'),
      "import './a-module-that-is-not-there'\n"
    )

    fs.writeFileSync(
      path.join(root, 'extension.config.js'),
      `module.exports = {config: (config) => {
  config.plugins = [...(config.plugins || []), {apply(compiler) {
    compiler.hooks.thisCompilation.tap('warns', (compilation) => {
      compilation.warnings.push(new Error('THE_WARNING_MARK'))
    })
  }}]
  return config
}}\n`
    )

    for (const channel of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, channel).mockImplementation((...parts: unknown[]) => {
        printed.push(parts.join(' '))
      })
    }

    await buildProject(root, {silent: false}).catch(() => {})

    const output = printed.join('\n')
    const warningAt = output.indexOf('THE_WARNING_MARK')
    const errorAt = output.indexOf('a-module-that-is-not-there')
    const countAt = output.search(/Build failed with 1 error/)

    expect(warningAt).toBeGreaterThan(-1)
    expect(errorAt).toBeGreaterThan(warningAt)
    expect(countAt).toBeGreaterThan(errorAt)
    expect(output.slice(countAt)).not.toContain('THE_WARNING_MARK')
    expect(output.match(/THE_WARNING_MARK/g)).toHaveLength(1)
  }, 60_000)
})
