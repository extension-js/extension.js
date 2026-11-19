import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import * as browsers from '../../index'
import {createSafariPackager} from '../../run-safari/safari-packager'
import {fakeSafariTools} from '../safari-fake-tools'

// The packager runs the real pipeline against a fake tool host, so these
// exercise resolve, compose and the whole control flow without spawning
// xcrun or xcodebuild.

describe('createSafariPackager', () => {
  let distDir: string
  let tools: ReturnType<typeof fakeSafariTools>

  beforeEach(() => {
    tools = fakeSafariTools()
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
    const result = await createSafariPackager({tools})(distDir)

    expect(result).toMatchObject({
      appName: 'Packager Demo',
      bundleId: 'dev.extensionjs.Packager-Demo',
      bundleIdDerived: true,
      macOsOnly: true
    })

    expect(result.appPath).toMatch(/Packager Demo\.app$/)
    expect(result.xcodeProjectPath).toContain(`${distDir}-xcode`)
    expect(tools.calls.converter).toHaveLength(1)
    expect(tools.calls.xcodebuild).toHaveLength(1)
    // The factory defaults to noOpen, the build command's contract.
    expect(tools.calls.openApp).toHaveLength(0)
  })

  it('honors identity configured on the factory', async () => {
    const result = await createSafariPackager({
      appName: 'Renamed',
      bundleId: 'com.example.mine',
      macOsOnly: false,
      tools
    })(distDir)

    expect(result.appName).toBe('Renamed')
    expect(result.bundleId).toBe('com.example.mine')
    expect(result.bundleIdDerived).toBe(false)
    expect(result.macOsOnly).toBe(false)
    expect(tools.calls.converter[0]).toContain('com.example.mine')
    expect(tools.calls.converter[0]).not.toContain('--macos-only')
  })

  it('lets per-call overrides win over the factory identity', async () => {
    const result = await createSafariPackager({appName: 'Factory', tools})(
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
      bundleId: 'com.example.kept',
      tools
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
    const result = await createSafariPackager({
      browser: 'webkit-based',
      tools
    })(distDir, 'resync')

    expect(result.appName).toBe('Packager Demo')
    expect(tools.calls.xcodebuild).toHaveLength(1)
  })

  it('dry run describes the commands without running a tool', async () => {
    const result = await createSafariPackager({dryRun: true, tools})(distDir)

    expect(result.appName).toBe('Packager Demo')
    expect(tools.calls.converter).toHaveLength(0)
    expect(tools.calls.xcodebuild).toHaveLength(0)
  })
})

// A dev session's first package is Safari's launch, so a failed one stamps
// the session contract the way every other launcher does.
describe('a Safari package that fails', () => {
  let root: string
  let distDir: string
  let readyPath: string
  const silent = {info() {}, warn() {}, error() {}, debug() {}}

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-stamp-'))
    distDir = path.join(root, 'dist', 'safari')
    fs.mkdirSync(distDir, {recursive: true})
    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify({name: 'Stamp Demo', version: '1.0.0'})
    )

    readyPath = path.join(root, 'dist', 'extension-js', 'safari', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({status: 'ready', browser: 'safari', pid: process.pid})
    )
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  const readContract = () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

  const failingPackager = (announceDevReady?: boolean) =>
    createSafariPackager({
      tools: fakeSafariTools({xcodebuild: {code: 65, output: 'BUILD FAILED'}}),
      logger: silent,
      announceDevReady
    })

  it('stamps a failed first package in a dev session and rethrows it', async () => {
    await expect(failingPackager(true)(distDir, 'full')).rejects.toMatchObject({
      code: 'E_SAFARI_TOOLCHAIN',
      printed: true
    })

    expect(readContract()).toMatchObject({
      status: 'error',
      code: 'browser_launch_failed',
      browserLaunchFailedCode: 'E_SAFARI_TOOLCHAIN',
      browserLaunchFailedReason: expect.stringContaining('xcodebuild failed')
    })
  })

  it('leaves the contract ready when a resync fails, since the earlier build still runs', async () => {
    await expect(failingPackager(true)(distDir, 'resync')).rejects.toThrow(
      'xcodebuild failed'
    )

    expect(readContract().status).toBe('ready')
  })

  it('leaves the contract to the build command when a build package fails', async () => {
    await expect(failingPackager()(distDir, 'full')).rejects.toThrow(
      'xcodebuild failed'
    )

    expect(readContract().status).toBe('ready')
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
})
