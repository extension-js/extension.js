import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {setupCompilerDoneDiagnostics} from '../compiler-hooks'

let root: string
let manifestPath: string
let errors: ReturnType<typeof vi.spyOn>

function fakeCompiler() {
  let done: ((stats: unknown) => void) | undefined

  return {
    compiler: {
      hooks: {
        done: {tap: (_: string, cb: (stats: unknown) => void) => (done = cb)}
      }
    },
    fire: (stats: unknown) => done?.(stats)
  }
}

function failingStats() {
  return {
    hasErrors: () => true,
    hasWarnings: () => true,
    toString: () =>
      [
        'ERROR in manifest.json',
        'Check the background.service_worker field in your manifest.json file.',
        'ERROR in manifest.json',
        "Can't read your manifest.json file.",
        ''
      ].join('\n'),
    toJson: () => ({warnings: [], assets: [{name: 'x'}], entrypoints: {a: {}}})
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-manifest-gone-'))
  manifestPath = path.join(root, 'src', 'manifest.json')
  fs.mkdirSync(path.dirname(manifestPath), {recursive: true})
  fs.writeFileSync(manifestPath, '{}')
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, {recursive: true, force: true})
})

const printed = () =>
  errors.mock.calls.map((call) => call.map(String).join(' ')).join('\n')

describe('a compile whose manifest vanished mid-session', () => {
  it('prints one error naming the manifest instead of every consequence', () => {
    const {compiler, fire} = fakeCompiler()
    setupCompilerDoneDiagnostics(compiler as never, 8080, manifestPath)

    fire(failingStats())
    expect(printed()).toContain('Build error')
    errors.mockClear()

    fs.rmSync(path.dirname(manifestPath), {recursive: true, force: true})
    fire(failingStats())

    const output = printed()
    expect(errors).toHaveBeenCalledTimes(1)
    expect(output).toContain('disappeared during the session')
    expect(output).toContain(path.basename(path.dirname(manifestPath)))
    expect(output).not.toContain('Build error')
    expect(output).not.toContain('background.service_worker')
  })

  it('says it once while the manifest stays missing and resumes when it is back', () => {
    const {compiler, fire} = fakeCompiler()
    setupCompilerDoneDiagnostics(compiler as never, 8080, manifestPath)
    fire(failingStats())
    errors.mockClear()

    fs.rmSync(manifestPath)
    fire(failingStats())
    fire(failingStats())
    expect(errors).toHaveBeenCalledTimes(1)
    expect(printed()).toContain('manifest.json file disappeared')

    fs.writeFileSync(manifestPath, '{}')
    errors.mockClear()
    fire(failingStats())
    expect(printed()).toContain('Build error')
  })

  it('names the project directory when the whole tree is gone', () => {
    const {compiler, fire} = fakeCompiler()
    setupCompilerDoneDiagnostics(compiler as never, 8080, manifestPath)
    fire(failingStats())
    errors.mockClear()

    fs.rmSync(root, {recursive: true, force: true})
    fire(failingStats())
    expect(printed()).toContain('project directory disappeared')
  })

  it('leaves a manifest that never existed to the resolver', () => {
    const {compiler, fire} = fakeCompiler()
    setupCompilerDoneDiagnostics(
      compiler as never,
      8080,
      path.join(root, 'nowhere', 'manifest.json')
    )

    fire(failingStats())
    expect(printed()).toContain('Build error')
    expect(printed()).not.toContain('disappeared')
  })
})
