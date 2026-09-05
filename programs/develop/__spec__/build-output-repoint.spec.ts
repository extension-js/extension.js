import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, describe, expect, it} from 'vitest'

// A config that re-points output.path is resolved by the bundler against the
// compiler context. The CLI's wipe, receipt and summary must resolve it the
// same way, whatever directory the build is run from.
const roots: string[] = []
const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
})

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function tmp(prefix: string) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix))
  )
  roots.push(dir)
  return dir
}

function fixture(config: string, pageName = 'one') {
  const root = tmp('extjs-repoint-')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'repoint', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'repoint',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )
  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.mkdirSync(path.join(root, 'pages'), {recursive: true})
  writePage(root, pageName)
  fs.writeFileSync(path.join(root, 'extension.config.js'), config)
  return root
}

function writePage(root: string, name: string) {
  fs.writeFileSync(
    path.join(root, 'pages', `${name}.html`),
    `<!doctype html><title>${name}</title><script src="./${name}.js"></script>`
  )
  fs.writeFileSync(
    path.join(root, 'pages', `${name}.js`),
    `console.log("${name}")\n`
  )
}

async function build(root: string, cwd: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  process.chdir(cwd)
  const lines: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
    return {summary, output: lines.join('\n')}
  } finally {
    console.log = originalLog
    process.chdir(originalCwd)
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

const listFiles = (dir: string) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, {recursive: true}).map(String).sort()
    : []

const REPOINT = `module.exports = {config: (c) => ({...c, output: {...c.output, path: 'build'}})}\n`

describe('a re-pointed output folder', () => {
  it('lands in the project from any cwd and never touches the cwd folder', async () => {
    const root = fixture(REPOINT)
    const elsewhere = tmp('extjs-elsewhere-')
    fs.mkdirSync(path.join(elsewhere, 'build'))
    fs.writeFileSync(path.join(elsewhere, 'build', 'SENTINEL.txt'), 'PRECIOUS')

    const fromElsewhere = await build(root, elsewhere)
    expect(
      fs.readFileSync(path.join(elsewhere, 'build', 'SENTINEL.txt'), 'utf8')
    ).toBe('PRECIOUS')
    expect(fs.existsSync(path.join(root, 'build', 'manifest.json'))).toBe(true)
    // The receipt names the folder the artifacts landed in.
    expect(fromElsewhere.summary.output_path).toBe(path.join(root, 'build'))
    expect(fromElsewhere.output, fromElsewhere.output).toMatch(
      /built for production in .*build/
    )

    const fromRoot = await build(root, root)
    expect(fromRoot.summary.output_path).toBe(path.join(root, 'build'))
    expect(fs.existsSync(path.join(root, 'build', 'manifest.json'))).toBe(true)
  }, 180_000)

  it('wipes the real output folder so a renamed entry leaves no stale bundle', async () => {
    const root = fixture(REPOINT, 'one')
    const elsewhere = tmp('extjs-elsewhere-')
    await build(root, elsewhere)
    expect(
      listFiles(path.join(root, 'build')).some((f) => f.includes('one'))
    ).toBe(true)

    fs.rmSync(path.join(root, 'pages', 'one.html'))
    fs.rmSync(path.join(root, 'pages', 'one.js'))
    writePage(root, 'two')
    await build(root, elsewhere)
    const files = listFiles(path.join(root, 'build'))
    expect(files.some((f) => f.includes('two'))).toBe(true)
    expect(files.some((f) => f.includes('one'))).toBe(false)
  }, 180_000)

  it('follows a re-pointed compile context too', async () => {
    const root = fixture(
      `const path = require('node:path')\n` +
        `module.exports = {config: (c) => ({...c, context: path.join(__dirname, 'ctx'), output: {...c.output, path: 'build'}})}\n`
    )
    fs.mkdirSync(path.join(root, 'ctx'))
    const elsewhere = tmp('extjs-elsewhere-')
    fs.mkdirSync(path.join(elsewhere, 'build'))
    fs.writeFileSync(path.join(elsewhere, 'build', 'SENTINEL.txt'), 'PRECIOUS')

    const built = await build(root, elsewhere)
    expect(fs.existsSync(path.join(elsewhere, 'build', 'SENTINEL.txt'))).toBe(
      true
    )
    expect(
      fs.existsSync(path.join(root, 'ctx', 'build', 'manifest.json'))
    ).toBe(true)
    expect(built.summary.output_path).toBe(path.join(root, 'ctx', 'build'))
  }, 180_000)
})
