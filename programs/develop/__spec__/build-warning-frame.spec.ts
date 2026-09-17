import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

// A warning the manifest step writes opens with the channel glyph and names
// its own fix, so the build report must print it once, as written. A plain
// warning the bundler reports with no glyph still gets the frame around it.

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-warning-frame-'))
const GLYPH = '⏵⏵⏵'

function write(relPath: string, contents: string) {
  const abs = path.join(ROOT, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

async function build() {
  const {extensionBuild} = await import('../command-build')
  const printed: string[] = []

  const record = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation(record)
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(record)

  let failure: unknown

  try {
    await extensionBuild(ROOT, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } catch (error) {
    failure = error
  } finally {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  }

  // Color codes can split words mid-phrase; strip them before matching.
  const lines = printed
    .join('\n')
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*m/g, '')
    .split('\n')

  return {failure, lines}
}

function count(haystack: string, needle: string) {
  return haystack.split(needle).length - 1
}

beforeAll(() => {
  write('package.json', JSON.stringify({private: true, name: 'warning-frame'}))

  // edge:homepage_url is dropped from a chrome build with a self-framed
  // warning. public/ beside src/manifest.json draws the plain layout
  // warning the frame is for.
  write(
    'src/manifest.json',
    JSON.stringify({
      name: 'Warning Frame Fixture',
      version: '1.0.0',
      manifest_version: 3,
      'edge:homepage_url': 'https://example.com'
    })
  )

  write('src/public/note.txt', 'shipped')
})

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('build warnings that frame themselves (real build)', () => {
  it('prints the vendor-prefix warning once, with no frame around it', async () => {
    const {failure, lines} = await build()

    expect(failure).toBeUndefined()

    const index = lines.findIndex((line) =>
      line.includes('edge:homepage_url now applies only to Edge builds')
    )
    expect(index).toBeGreaterThan(-1)

    const head = lines[index]
    expect(count(head, GLYPH)).toBe(1)
    expect(head).not.toMatch(/Compatibility:/)
    expect(head).not.toContain('⚠')

    // The remedy the warning wrote follows it, and nothing else does.
    expect(lines[index + 1]).toMatch(/^Rename it to chromium:homepage_url/)
    expect(lines[index + 2]).not.toMatch(/Source:|Hint:/)
    expect(lines.join('\n')).not.toContain('⚠')
  }, 120_000)

  it('keeps the frame on a warning the bundler reports without a glyph', async () => {
    const {failure, lines} = await build()

    expect(failure).toBeUndefined()

    const index = lines.findIndex((line) =>
      line.includes('The public folder sits in the legacy next-to-manifest')
    )
    expect(index).toBeGreaterThan(-1)

    const head = lines[index]
    expect(count(head, GLYPH)).toBe(1)
    expect(head).toMatch(new RegExp(`^${GLYPH} [A-Za-z-]+: The public folder`))
    expect(lines[index + 1]).toMatch(/^│ {2}Source: /)

    // The warning names its own fix, so the generic hint stays off.
    expect(lines[index + 2] ?? '').not.toMatch(/Hint:/)
  }, 120_000)
})
