import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('@rspack/core', () => {
  class NoopPlugin {
    public args: unknown
    public affectedHooks?: string
    constructor(args: unknown) {
      this.args = args
    }
    apply() {}
  }

  class RawSourceMock {
    private content: string
    constructor(content: string) {
      this.content = content
    }
    source() {
      return this.content
    }
    size() {
      return this.content.length
    }
  }

  return {
    DefinePlugin: NoopPlugin,
    ProvidePlugin: NoopPlugin,
    Compilation: {PROCESS_ASSETS_STAGE_SUMMARIZE: 1000},
    WebpackError: class extends Error {},
    sources: {RawSource: RawSourceMock}
  }
})

import {EnvPlugin, isEnvFileForAnotherTarget} from '../env'

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')

type CompilationCb = (compilation: unknown) => void

// Runs the plugin against a real project folder and answers the warnings
// every thisCompilation tap pushed, the way rspack would collect them.
function compileWarnings(
  projectPath: string,
  mode: 'development' | 'production',
  browser = 'chrome'
) {
  const taps: CompilationCb[] = []
  const compiler = {
    options: {mode, context: projectPath},
    hooks: {
      thisCompilation: {
        tap: (_name: string, cb: CompilationCb) => {
          taps.push(cb)
        }
      }
    }
  }

  new EnvPlugin({
    browser: browser as never,
    manifestPath: path.join(projectPath, 'manifest.json')
  }).apply(compiler as never)

  const compilation = {
    warnings: [] as Error[],
    errors: [] as Error[],
    assets: {},
    hooks: {processAssets: {tap: () => undefined}},
    updateAsset: () => undefined
  }

  for (const tap of taps) tap(compilation)

  return compilation.warnings.map((warning) => stripAnsi(warning.message))
}

describe('env files named for another target', () => {
  let projectPath: string
  const publicKeys = Object.keys(process.env).filter((key) =>
    key.startsWith('EXTENSION_PUBLIC_')
  )
  const saved = Object.fromEntries(
    publicKeys.map((key) => [key, process.env[key]])
  )

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'env-ignored-'))
    fs.writeFileSync(
      path.join(projectPath, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'x', version: '1.0.0'})
    )

    for (const key of publicKeys) delete process.env[key]
  })

  afterEach(() => {
    fs.rmSync(projectPath, {recursive: true, force: true})
    delete process.env.EXTENSION_PUBLIC_API_URL
    for (const key of publicKeys) process.env[key] = saved[key]
  })

  it('classifies a file by whether another mode or browser owns it', () => {
    expect(isEnvFileForAnotherTarget('.env.development')).toBe(true)
    expect(isEnvFileForAnotherTarget('.env.test')).toBe(true)
    expect(isEnvFileForAnotherTarget('.env.firefox')).toBe(true)
    expect(isEnvFileForAnotherTarget('.env.chrome.development')).toBe(true)
    expect(isEnvFileForAnotherTarget('.env.staging')).toBe(false)
    expect(isEnvFileForAnotherTarget('.env.chrome.staging')).toBe(false)
    expect(isEnvFileForAnotherTarget('.env.local')).toBe(false)
  })

  it('leaves a lone .env.development alone in a production build', () => {
    fs.writeFileSync(
      path.join(projectPath, '.env.development'),
      'EXTENSION_PUBLIC_X=1\n'
    )

    expect(compileWarnings(projectPath, 'production')).toEqual([])
  })

  it('leaves a lone .env.test and another browser file alone as well', () => {
    fs.writeFileSync(
      path.join(projectPath, '.env.test'),
      'EXTENSION_PUBLIC_X=1\n'
    )

    fs.writeFileSync(
      path.join(projectPath, '.env.firefox'),
      'EXTENSION_PUBLIC_X=1\n'
    )

    expect(compileWarnings(projectPath, 'production', 'chrome')).toEqual([])
  })

  it('still asks for a rename when the file name matches no known pattern', () => {
    fs.writeFileSync(
      path.join(projectPath, '.env.staging'),
      'EXTENSION_PUBLIC_X=1\n'
    )

    const warnings = compileWarnings(projectPath, 'production')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Found .env.staging')
    expect(warnings[0]).toContain('undefined in this build')
    expect(warnings[0]).toContain('Rename the file to one of these')
    expect(warnings[0]).toContain('.env.production')
  })

  it('names only the unknown file when a known one sits beside it', () => {
    fs.writeFileSync(
      path.join(projectPath, '.env.development'),
      'EXTENSION_PUBLIC_X=1\n'
    )

    fs.writeFileSync(
      path.join(projectPath, '.env.staging'),
      'EXTENSION_PUBLIC_X=1\n'
    )

    const warnings = compileWarnings(projectPath, 'production')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Found .env.staging,')
    expect(warnings[0]).not.toContain('.env.development,')
  })

  it('does not call the values undefined when extension.config.js defined them', () => {
    fs.writeFileSync(
      path.join(projectPath, '.env.staging'),
      'EXTENSION_PUBLIC_X=1\n'
    )

    process.env.EXTENSION_PUBLIC_API_URL = 'https://api.example.com'

    const warnings = compileWarnings(projectPath, 'production')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('undefined in this build')
    expect(warnings[0]).toContain('Rename the file to one of these')
  })
})
