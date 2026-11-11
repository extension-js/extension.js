import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import type {BuildSummary} from '../../lib/build-summary'
import {
  browserReadLine,
  declaresNativeBrowserNamespace
} from '../feature-browser-global'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  background: string,
  manifestExtras: Record<string, unknown> = {}
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-browser-global-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'guarded', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'guarded',
      version: '1.0.0',
      manifest_version: 3,
      background: {service_worker: 'background.js'},
      ...manifestExtras
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), background)

  if (manifestExtras.devtools_page) {
    fs.writeFileSync(
      path.join(root, String(manifestExtras.devtools_page)),
      '<!doctype html><title>devtools</title>'
    )
  }

  return root
}

async function buildChrome(root: string): Promise<BuildSummary> {
  const {extensionBuild} = await import('../../command-build')
  const env = {VITEST: process.env.VITEST}
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (env.VITEST === undefined) delete process.env.VITEST
    else process.env.VITEST = env.VITEST
  }
}

function compatibilityWarning(summary: BuildSummary): string | undefined {
  return (summary.warnings || []).find((line) => /uses browser\.\*/.test(line))
}

describe('browserReadLine', () => {
  it('names the first line that reads browser.* outside a guard', () => {
    expect(
      browserReadLine(
        [
          'const promiseNamespace = false',
          "if (promiseNamespace && typeof browser !== 'undefined') { chrome = browser }",
          'export function openWelcomeTabFirefox() {',
          '  browser.tabs.create({url: "welcome.html"})',
          '}'
        ].join('\n')
      )
    ).toBe(4)

    expect(
      browserReadLine("if (typeof browser !== 'undefined') console.log(1)")
    ).toBeUndefined()

    expect(
      browserReadLine('const api = window.browser.runtime')
    ).toBeUndefined()
  })
})

describe('declaresNativeBrowserNamespace', () => {
  it('holds from Chromium 148, and from 152 with a devtools_page', () => {
    expect(declaresNativeBrowserNamespace({})).toBe(false)
    expect(
      declaresNativeBrowserNamespace({minimum_chrome_version: '147'})
    ).toBe(false)

    expect(
      declaresNativeBrowserNamespace({minimum_chrome_version: '148'})
    ).toBe(true)

    expect(
      declaresNativeBrowserNamespace({minimum_chrome_version: '148.0.7778.0'})
    ).toBe(true)

    expect(
      declaresNativeBrowserNamespace({
        minimum_chrome_version: '148',
        devtools_page: 'devtools.html'
      })
    ).toBe(false)

    expect(
      declaresNativeBrowserNamespace({
        minimum_chrome_version: '152',
        devtools_page: 'devtools.html'
      })
    ).toBe(true)

    expect(
      declaresNativeBrowserNamespace({minimum_chrome_version: 'latest'})
    ).toBe(false)
  })
})

describe('the Compatibility warning on a production chrome build', () => {
  it('stays quiet for a read behind a typeof guard', async () => {
    const summary = await buildChrome(
      project(
        "if (typeof browser !== 'undefined') console.log(browser.runtime.id)\n"
      )
    )

    expect(summary.errors_count).toBe(0)
    expect(compatibilityWarning(summary)).toBeUndefined()
  }, 180_000)

  it('stays quiet for a read behind a branch on EXTENSION_PUBLIC_BROWSER', async () => {
    const summary = await buildChrome(
      project(
        [
          "const isFirefoxLike = import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox'",
          'if (isFirefoxLike) {',
          '  browser.runtime.onInstalled.addListener(() => console.log(browser.runtime.id))',
          '}',
          "if (process.env.EXTENSION_PUBLIC_BROWSER === 'firefox') console.log(browser.runtime.id)",
          'console.log(chrome.runtime.id)',
          ''
        ].join('\n')
      )
    )

    expect(summary.errors_count).toBe(0)
    expect(compatibilityWarning(summary)).toBeUndefined()
  }, 180_000)

  it('names the file and line of an unguarded read and says the build may throw', async () => {
    const summary = await buildChrome(
      project(
        [
          'console.log("start")',
          'export function id() { return browser.runtime.id }',
          'console.log(id())',
          ''
        ].join('\n')
      )
    )

    const warning = compatibilityWarning(summary)
    expect(warning).toBeDefined()
    expect(warning).toContain('background.js:2 uses browser.*')
    expect(warning).toContain(
      'may throw "browser is not defined" if this code runs on chrome'
    )

    expect(warning).toContain('has natively only from Chromium 148.')
    expect(warning).toContain('Set minimum_chrome_version to "148"')
    expect(warning).not.toContain('build throws')
    expect(warning).toContain('guard the read with a typeof browser check')
  }, 180_000)

  const unguarded = 'console.log(browser.runtime.id)\n'

  it('stays quiet when the manifest refuses every Chromium without the namespace', async () => {
    const summary = await buildChrome(
      project(unguarded, {minimum_chrome_version: '148'})
    )

    expect(summary.errors_count).toBe(0)
    expect(compatibilityWarning(summary)).toBeUndefined()
  }, 180_000)

  it('still warns below the floor, and names 152 for a devtools_page', async () => {
    const below = compatibilityWarning(
      await buildChrome(project(unguarded, {minimum_chrome_version: '147'}))
    )

    expect(below).toContain('has natively only from Chromium 148.')

    const devtools = compatibilityWarning(
      await buildChrome(
        project(unguarded, {
          minimum_chrome_version: '148',
          devtools_page: 'devtools.html'
        })
      )
    )

    expect(devtools).toContain(
      'has natively only from Chromium 152 for an extension with a devtools_page.'
    )

    expect(devtools).toContain('Set minimum_chrome_version to "152"')
  }, 180_000)
})
