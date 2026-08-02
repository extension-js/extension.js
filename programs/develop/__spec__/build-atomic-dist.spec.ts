import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {DIST_STAGING_PREFIX} from '../lib/atomic-dist'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-build-atomic-'))
const DIST_PARENT = path.join(ROOT, 'dist')
const DIST = path.join(DIST_PARENT, 'chrome')

function writeFixture() {
  fs.writeFileSync(
    path.join(ROOT, 'package.json'),
    JSON.stringify(
      {private: true, name: 'extjs-build-atomic-spec', version: '0.0.0'},
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, atomic dist',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(ROOT, 'popup.html'),
    '<html><body><h1>popup</h1></body></html>\n'
  )
}

async function buildFixture() {
  const {extensionBuild} = await import('../command-build')

  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE

  try {
    return await extensionBuild(ROOT, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } finally {
    if (previousAuthorMode === undefined) {
      delete process.env.EXTENSION_AUTHOR_MODE
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
    }
    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

// The atomicity contract under test: a dist that carries a manifest.json
// must also carry every page the manifest references.
function manifestViolations(distDir: string): string[] {
  const manifestPath = path.join(distDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return []
  let manifest: {action?: {default_popup?: string}}
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  } catch {
    return [`${manifestPath} is unreadable`]
  }
  const missing: string[] = []
  const popup = manifest.action?.default_popup
  if (popup && !fs.existsSync(path.join(distDir, popup))) {
    missing.push(popup)
  }
  return missing
}

function stagingLitter(): string[] {
  try {
    return fs
      .readdirSync(DIST_PARENT)
      .filter((name) => name.startsWith(DIST_STAGING_PREFIX))
  } catch {
    return []
  }
}

beforeAll(() => {
  writeFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('build: atomic dist publish (real rspack)', () => {
  it('publishes a complete dist and leaves no staging litter', async () => {
    const summary = await buildFixture()
    expect(summary.errors_count).toBe(0)
    expect(summary.output_path).toBe(DIST)

    expect(fs.existsSync(path.join(DIST, 'manifest.json'))).toBe(true)
    expect(manifestViolations(DIST)).toEqual([])
    expect(stagingLitter()).toEqual([])
  }, 120_000)

  it('never exposes a manifest without its pages while a build runs', async () => {
    const violations: string[] = []
    const timer = setInterval(() => {
      violations.push(...manifestViolations(DIST))
    }, 10)

    try {
      await buildFixture()
    } finally {
      clearInterval(timer)
    }

    expect(violations).toEqual([])
    expect(manifestViolations(DIST)).toEqual([])
  }, 120_000)

  it('keeps the last-good dist when the next build fails to compile', async () => {
    const goodManifest = fs.readFileSync(
      path.join(DIST, 'manifest.json'),
      'utf-8'
    )

    // Reference a page that does not exist so the compile errors out.
    const source = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8')
    )
    source.options_page = 'options.html'
    fs.writeFileSync(
      path.join(ROOT, 'manifest.json'),
      JSON.stringify(source, null, 2)
    )

    try {
      await expect(buildFixture()).rejects.toThrow('Build failed with errors')

      expect(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf-8')).toBe(
        goodManifest
      )
      expect(manifestViolations(DIST)).toEqual([])
      expect(stagingLitter()).toEqual([])
    } finally {
      delete source.options_page
      fs.writeFileSync(
        path.join(ROOT, 'manifest.json'),
        JSON.stringify(source, null, 2)
      )
    }
  }, 120_000)

  it('keeps the last-good dist when the build is interrupted after emit', async () => {
    const goodManifest = fs.readFileSync(
      path.join(DIST, 'manifest.json'),
      'utf-8'
    )

    // The sabotage plugin dies after assets hit the staging dir but before
    // the promote, the same window a SIGINT or OOM kill lands in.
    const configPath = path.join(ROOT, 'extension.config.js')
    fs.writeFileSync(
      configPath,
      [
        'module.exports = {',
        '  config: (config) => {',
        '    config.plugins = config.plugins || []',
        '    config.plugins.push({',
        '      apply(compiler) {',
        "        compiler.hooks.afterEmit.tap('spec-interrupt', () => {",
        "          throw new Error('simulated interrupt after emit')",
        '        })',
        '      }',
        '    })',
        '    return config',
        '  }',
        '}',
        ''
      ].join('\n')
    )

    try {
      await expect(buildFixture()).rejects.toThrow()

      expect(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf-8')).toBe(
        goodManifest
      )
      expect(manifestViolations(DIST)).toEqual([])
      expect(stagingLitter()).toEqual([])
    } finally {
      fs.rmSync(configPath, {force: true})
    }
  }, 120_000)

  it('sweeps staging dirs a crashed build left behind', async () => {
    const stale = path.join(DIST_PARENT, `${DIST_STAGING_PREFIX}chrome-dead0`)
    fs.mkdirSync(stale, {recursive: true})
    fs.writeFileSync(path.join(stale, 'manifest.json'), '{}')

    const summary = await buildFixture()
    expect(summary.errors_count).toBe(0)
    expect(fs.existsSync(stale)).toBe(false)
    expect(stagingLitter()).toEqual([])
    expect(manifestViolations(DIST)).toEqual([])
  }, 120_000)
})
