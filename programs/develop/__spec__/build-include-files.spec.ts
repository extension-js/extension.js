import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, {recursive: true, force: true})
})

// The project lives one level below the temp dir, so a source can sit
// beside it, outside the project root, the way an exported model tree does.
function workspace(
  files: Record<string, string | Buffer>,
  config: string
): {root: string; outside: string} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-include-'))
  tempDirs.push(dir)
  const root = path.join(dir, 'project')
  const outside = path.join(dir, 'training', 'export')
  fs.mkdirSync(root, {recursive: true})
  fs.mkdirSync(outside, {recursive: true})

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'include', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'include',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(path.join(root, 'extension.config.js'), config)

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return {root, outside}
}

async function build(root: string, options: Record<string, unknown> = {}) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      exitOnError: false,
      ...options
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function emittedFiles(root: string, browser = 'chrome') {
  const dist = path.join(root, 'dist', browser)

  return (fs.readdirSync(dist, {recursive: true}) as string[])
    .filter((rel) => fs.statSync(path.join(dist, rel)).isFile())
    .map((rel) => rel.split(path.sep).join('/'))
    .sort()
}

const read = (root: string, rel: string, browser = 'chrome') =>
  fs.readFileSync(path.join(root, 'dist', browser, rel), 'utf8')

describe('the include config', () => {
  it('copies a declared file and a declared folder into the build, from inside or outside the project', async () => {
    const {root} = workspace(
      {
        'project/models/small.onnx': 'SMALL_MODEL',
        'training/export/v1.bin': 'V1_EXPORT',
        'training/export/nested/v2.bin': 'V2_EXPORT'
      },
      [
        'module.exports = {',
        '  include: {',
        "    'models/small.onnx': './models/small.onnx',",
        "    'models/exported': '../training/export'",
        '  }',
        '}',
        ''
      ].join('\n')
    )

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const files = emittedFiles(root)
    expect(files).toContain('models/small.onnx')
    expect(files).toContain('models/exported/v1.bin')
    expect(files).toContain('models/exported/nested/v2.bin')
    expect(read(root, 'models/small.onnx')).toBe('SMALL_MODEL')
    expect(read(root, 'models/exported/nested/v2.bin')).toBe('V2_EXPORT')
  }, 120_000)

  it('layers top-level, browser and command entries key by key', async () => {
    const {root} = workspace(
      {
        'project/data/base.json': '{"from":"top"}',
        'project/data/chrome.json': '{"from":"browser"}',
        'project/data/build.json': '{"from":"build"}',
        'project/data/dev.json': '{"from":"dev"}'
      },
      [
        'module.exports = {',
        "  include: {'data/base.json': './data/base.json', 'data/pick.json': './data/base.json'},",
        "  browser: {chrome: {include: {'data/chrome.json': './data/chrome.json'}}},",
        '  commands: {',
        "    build: {include: {'data/build.json': './data/build.json', 'data/pick.json': './data/build.json'}},",
        "    dev: {include: {'data/dev.json': './data/dev.json'}}",
        '  }',
        '}',
        ''
      ].join('\n')
    )

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const files = emittedFiles(root)
    expect(files).toContain('data/base.json')
    expect(files).toContain('data/chrome.json')
    expect(files).toContain('data/build.json')
    expect(files).not.toContain('data/dev.json')
    // The command layer wins one output path the top level also names.
    expect(read(root, 'data/pick.json')).toBe('{"from":"build"}')
  }, 120_000)

  it('fails the build for a source that is not there and for an output path outside the root', async () => {
    const {root} = workspace(
      {'project/data/here.json': '{}'},
      [
        'module.exports = {',
        '  include: {',
        "    'data/here.json': './data/here.json',",
        "    'data/gone.json': './data/gone.json',",
        "    '../escape.json': './data/here.json',",
        "    'manifest.json': './data/here.json'",
        '  }',
        '}',
        ''
      ].join('\n')
    )
    const printed: string[] = []

    const capture = (...args: unknown[]) => {
      printed.push(args.map(String).join(' '))
    }

    const error = vi.spyOn(console, 'error').mockImplementation(capture)
    const log = vi.spyOn(console, 'log').mockImplementation(capture)

    try {
      await expect(build(root)).rejects.toThrow('Build failed with errors')
    } finally {
      error.mockRestore()
      log.mockRestore()
    }

    // eslint-disable-next-line no-control-regex
    const text = printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    expect(text).toContain('maps data/gone.json to a file that is not there')
    expect(text).toContain('cannot write ../escape.json')
    expect(text).toContain('climbs out of the extension root')
    expect(text).toContain('cannot write manifest.json')
    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
  }, 120_000)
})
