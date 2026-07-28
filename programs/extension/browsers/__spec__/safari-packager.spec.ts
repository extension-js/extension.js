import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import * as browsers from '../index'
import {createSafariPackager} from '../run-safari/safari-packager'

// Under VITEST the pipeline takes its dry-run branch, so these exercise the
// real resolve/compose path without spawning xcrun or xcodebuild.

describe('createSafariPackager', () => {
  let distDir: string

  beforeEach(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-pkg-'))
    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify({name: 'Packager Demo', version: '1.0.0'})
    )
  })

  afterEach(() => {
    try {
      fs.rmSync(distDir, {recursive: true, force: true})
      fs.rmSync(`${distDir}-xcode`, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  it('produces a callback that reports the resolved app identity', async () => {
    const result = await createSafariPackager()(distDir)

    expect(result).toMatchObject({
      appName: 'Packager Demo',
      bundleId: 'dev.extensionjs.Packager-Demo',
      bundleIdDerived: true,
      macOsOnly: true
    })
    expect(result.appPath).toMatch(/Packager Demo\.app$/)
    expect(result.xcodeProjectPath).toContain(`${distDir}-xcode`)
  })

  it('honors identity configured on the factory', async () => {
    const result = await createSafariPackager({
      appName: 'Renamed',
      bundleId: 'com.example.mine',
      macOsOnly: false
    })(distDir)

    expect(result.appName).toBe('Renamed')
    expect(result.bundleId).toBe('com.example.mine')
    expect(result.bundleIdDerived).toBe(false)
    expect(result.macOsOnly).toBe(false)
  })

  it('lets per-call overrides win over the factory identity', async () => {
    const result = await createSafariPackager({appName: 'Factory'})(
      distDir,
      'full',
      {appName: 'Override', bundleId: 'com.example.override'}
    )

    expect(result.appName).toBe('Override')
    expect(result.bundleId).toBe('com.example.override')
  })

  it('does not let an unset override erase the factory identity', async () => {
    // develop always sends the full override record, with undefined in every
    // slot the user left alone; a naive spread would wipe the configured id.
    const result = await createSafariPackager({
      appName: 'Kept',
      bundleId: 'com.example.kept'
    })(distDir, 'full', {
      appName: undefined,
      bundleId: undefined,
      macOsOnly: undefined,
      forceRegenerate: undefined,
      safariBinary: undefined
    })

    expect(result.appName).toBe('Kept')
    expect(result.bundleId).toBe('com.example.kept')
  })

  it('accepts webkit-based as the target vendor', async () => {
    const result = await createSafariPackager({browser: 'webkit-based'})(
      distDir,
      'resync'
    )

    expect(result.appName).toBe('Packager Demo')
  })
})

describe('the browsers entry publishes the Safari packaging surface', () => {
  it('exports what a library caller needs to drive a Safari package', () => {
    for (const name of [
      'createSafariPackager',
      'packageSafariExtension',
      'safariBuildPreflight',
      'safariPreflightError',
      'isValidBundleId',
      'resolveSafariBuildConfig',
      'builtAppPath',
      'xcodeProjectPath',
      'macOsSchemeName'
    ]) {
      expect(
        typeof (browsers as Record<string, unknown>)[name],
        `extension/browsers must export ${name}: without it a programmatic ` +
          `caller cannot package a Safari app at all, because develop only ` +
          `packages when a safariPackager is injected.`
      ).toBe('function')
    }
  })

  it('validates bundle ids through the exported entry', () => {
    expect(browsers.isValidBundleId('com.example.my-extension')).toBe(true)
    expect(browsers.isValidBundleId('single-segment')).toBe(false)
  })
})
