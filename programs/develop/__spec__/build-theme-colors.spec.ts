import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Firefox reads theme colors as CSS strings and Chromium only as number
// arrays, so a Chromium build ports the exact strings and refuses the rest.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const NOTE = 'as [R, G, B] arrays for'

interface Diagnostic {
  code?: string
  message: string
  file?: string
  severity: string
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, '')
}

function project(theme: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-theme-colors-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'theme-colors', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Theme Colors',
      version: '1.0.0',
      browser_specific_settings: {
        gecko: {
          id: 'theme-colors@example.com',
          data_collection_permissions: {required: ['none']}
        }
      },
      theme
    })
  )

  return root
}

async function build(root: string, browser: 'chrome' | 'edge' | 'firefox') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []

  const record = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }

  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error
  }
  console.log = record
  console.warn = record
  console.error = record
  let summary: {errors_count: number; warnings_count?: number} | undefined
  let failure: (Error & {code?: string; diagnostics?: Diagnostic[]}) | undefined

  try {
    summary = await extensionBuild(root, {
      browser,
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } catch (error) {
    failure = error as typeof failure
  } finally {
    Object.assign(console, original)
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const manifestFile = path.join(root, 'dist', browser, 'manifest.json')

  return {
    summary,
    failure,
    output: stripAnsi(lines.join('\n')),
    manifest: fs.existsSync(manifestFile)
      ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
      : undefined,
    source: JSON.parse(
      fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')
    )
  }
}

describe('theme colors on a Chromium build', () => {
  it('writes hex and rgb() as arrays, says so once, and leaves the source alone', async () => {
    const theme = {
      colors: {
        frame: '#1b263b',
        tab_text: '#FFF',
        toolbar: 'rgb(65, 90, 119)',
        ntp_text: [1, 2, 3, 0.5]
      },
      tints: {buttons: [0.5, -1, 0.5]}
    }
    const root = project(theme)
    const {summary, failure, output, manifest, source} = await build(
      root,
      'chrome'
    )

    expect(failure, output).toBeUndefined()
    expect(summary?.errors_count).toBe(0)
    expect(summary?.warnings_count ?? 0, output).toBe(0)
    expect(manifest.theme).toEqual({
      colors: {
        frame: [27, 38, 59],
        tab_text: [255, 255, 255],
        toolbar: [65, 90, 119],
        ntp_text: [1, 2, 3, 0.5]
      },
      tints: {buttons: [0.5, -1, 0.5]}
    })

    expect(output.split(NOTE)).toHaveLength(2)
    expect(output).toContain(
      'The build wrote theme.colors.frame, theme.colors.tab_text, theme.colors.toolbar as [R, G, B] arrays for chrome'
    )

    expect(output).toContain('frame as [27, 38, 59] for one')
    expect(output).not.toContain('theme.colors.ntp_text')
    expect(source.theme).toEqual(theme)
  }, 180_000)

  it('ports the same strings for another Chromium browser', async () => {
    const root = project({colors: {frame: '#000'}})
    const {failure, output, manifest} = await build(root, 'edge')

    expect(failure, output).toBeUndefined()
    expect(manifest.theme.colors.frame).toEqual([0, 0, 0])
    expect(output).toContain(`${NOTE} edge`)
  }, 180_000)

  it('passes arrays through untouched with no note', async () => {
    const theme = {
      colors: {frame: [27, 38, 59], toolbar: [0, 0, 0, 1]},
      tints: {buttons: [0.1, 0.2, 0.3]}
    }
    const root = project(theme)
    const {summary, failure, output, manifest} = await build(root, 'chrome')

    expect(failure, output).toBeUndefined()
    expect(summary?.warnings_count ?? 0, output).toBe(0)
    expect(manifest.theme).toEqual(theme)
    expect(output).not.toContain(NOTE)
  }, 180_000)

  it.each([
    ['an eight digit hex', '#1b263bcc', '[27, 38, 59, 0.8]'],
    ['a four digit hex', '#fff8', '[255, 255, 255, 0.53]'],
    ['rgba()', 'rgba(1, 2, 3, 0.5)', '[1, 2, 3, 0.5]'],
    ['a percentage rgb()', 'rgb(100%, 0%, 0%)', '[R, G, B]'],
    ['hsl()', 'hsl(0, 100%, 50%)', '[R, G, B]'],
    ['a named color', 'white', '[255, 255, 255]'],
    ['a two member array', [1, 2], '[R, G, B]'],
    ['a channel out of range', [1, 2, 300], '[R, G, B]'],
    ['a fractional channel', [1.5, 2, 3], '[R, G, B]'],
    ['a string channel', ['1', 2, 3], '[R, G, B]'],
    ['an alpha above 1', [1, 2, 3, 2], '[R, G, B, A]']
  ])(
    'fails on %s with the key, the value and the array to write',
    async (_, value, write) => {
      const root = project({colors: {frame: '#000', toolbar: value}})
      const {failure, output, manifest, source} = await build(root, 'chrome')

      expect(failure?.code).toBe('E_COMPILE')
      expect(failure?.diagnostics).toHaveLength(1)
      expect(failure?.diagnostics?.[0]).toMatchObject({
        code: 'E_THEME_INVALID',
        file: 'manifest.json',
        severity: 'error'
      })

      const line = `theme.colors.toolbar ${JSON.stringify(value)}, write ${write}`
      expect(failure?.diagnostics?.[0].message).toContain(line)
      expect(output).toContain(line)
      expect(output).not.toContain('theme.colors.frame "#000"')
      expect(manifest).toBeUndefined()
      expect(source.theme.colors.toolbar).toEqual(value)
    },
    180_000
  )

  it('fails on tints that are not three numbers, all in one error', async () => {
    const root = project({
      colors: {frame: 'red'},
      tints: {buttons: '#fff', frame: [0.1, 0.2], ok: [0, 0, 0]}
    })
    const {failure} = await build(root, 'chrome')

    expect(failure?.diagnostics).toHaveLength(1)
    const [diagnostic] = failure?.diagnostics ?? []
    expect(diagnostic.code).toBe('E_THEME_INVALID')
    expect(diagnostic.message).toContain(
      'theme.colors.frame "red", write [255, 0, 0]'
    )

    expect(diagnostic.message).toContain(
      'theme.tints.buttons "#fff", write [H, S, L]'
    )

    expect(diagnostic.message).toContain(
      'theme.tints.frame [0.1,0.2], write [H, S, L]'
    )

    expect(diagnostic.message).not.toContain('theme.tints.ok')
  }, 180_000)
})

describe('theme colors on a Firefox build', () => {
  it('ships every string and tint as written with no note and no error', async () => {
    const theme = {
      colors: {
        frame: '#1b263b',
        toolbar: 'rgba(1, 2, 3, 0.5)',
        tab_text: 'white'
      },
      tints: {buttons: '#fff'}
    }
    const root = project(theme)
    const {summary, failure, output, manifest} = await build(root, 'firefox')

    expect(failure, output).toBeUndefined()
    expect(summary?.errors_count).toBe(0)
    expect(manifest.theme).toEqual(theme)
    expect(output).not.toContain(NOTE)
    expect(output).not.toContain('theme.colors')
  }, 180_000)
})
