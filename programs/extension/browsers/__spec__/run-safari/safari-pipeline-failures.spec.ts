import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../../browsers-lib/messages'
import {
  packageSafariExtension,
  stopWebDriverRequestWatchers
} from '../../run-safari/safari-launch'
import {
  pbxprojPath,
  resolveSafariBuildConfig,
  xcodeProjectPath
} from '../../run-safari/safari-launch/safari-config'
import {onFakeClock} from '../fake-clock'
import {type FakeSafariTools, fakeSafariTools} from '../safari-fake-tools'

let root: string
let distDir: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-failures-'))
  distDir = path.join(root, 'dist', 'safari')
  fs.mkdirSync(distDir, {recursive: true})
  fs.writeFileSync(
    path.join(distDir, 'manifest.json'),
    JSON.stringify({name: 'SignedExt', version: '1.0.0'})
  )

  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  stopWebDriverRequestWatchers()
  vi.restoreAllMocks()
  fs.rmSync(root, {recursive: true, force: true})
})

function config() {
  return resolveSafariBuildConfig(
    {options: {output: {path: distDir}}} as never,
    {extension: [distDir], browser: 'safari'} as never
  )
}

async function run(tools: FakeSafariTools, host: Record<string, unknown> = {}) {
  const errors: string[] = []

  const quiet = () => {}

  const thrown = await packageSafariExtension(
    {extension: [distDir], browser: 'safari', tools, ...host} as never,
    distDir,
    {
      info: quiet,
      warn: quiet,
      error: (m: unknown) => errors.push(String(m)),
      debug: quiet
    } as never,
    'full'
  ).then(
    () => null,
    (reason: unknown) => reason as Error & {code?: string}
  )

  return {thrown, errors}
}

describe('a Safari packaging tool that fails', () => {
  it('converter: the failure is logged and thrown with E_SAFARI_TOOLCHAIN', async () => {
    const tools = fakeSafariTools({
      converter: {code: 1, output: 'error: manifest.json not found'}
    })
    const {thrown, errors} = await run(tools, {noOpen: true})

    expect(errors).toEqual([
      messages.safariToolFailed(
        'safari-web-extension-converter',
        1,
        'error: manifest.json not found'
      )
    ])

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown?.message).toBe(
      'safari-web-extension-converter failed (exit 1)\nerror: manifest.json not found'
    )

    expect(thrown?.code).toBe('E_SAFARI_TOOLCHAIN')
    expect(tools.calls.xcodebuild).toEqual([])
  })

  it('xcodebuild: the failure is logged and thrown with E_SAFARI_TOOLCHAIN', async () => {
    const tools = fakeSafariTools({
      xcodebuild: {code: 65, output: 'error: no such scheme'}
    })
    const {thrown, errors} = await run(tools, {noOpen: true})

    expect(errors).toEqual([
      messages.safariToolFailed('xcodebuild', 65, 'error: no such scheme')
    ])

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown?.message).toBe(
      'xcodebuild failed (exit 65)\nerror: no such scheme'
    )

    expect(thrown?.code).toBe('E_SAFARI_TOOLCHAIN')
  })

  // The stand-in writes a fresh project the way a passing run does, then
  // answers with a failure.
  function converterThatFailsAfterWriting() {
    const tools = fakeSafariTools()
    const convert = tools.runConverter

    tools.runConverter = async (args) => {
      await convert(args)

      return {ok: false, code: 1, output: 'error: failed after writing'}
    }

    return tools
  }

  it('converter that rewrote the project before it failed: the signing settings and identifiers of before are put back', async () => {
    expect((await run(fakeSafariTools(), {noOpen: true})).thrown).toBeNull()

    // What a person set in Xcode, in their own spelling.
    const projFile = pbxprojPath(config())
    fs.writeFileSync(
      projFile,
      [
        'buildSettings = {',
        '  DEVELOPMENT_TEAM = USERTEAM42;',
        '  CODE_SIGN_STYLE = Automatic;',
        '  PRODUCT_BUNDLE_IDENTIFIER = com.acme.signed;',
        '  PRODUCT_NAME = "$(TARGET_NAME)";',
        '};',
        'buildSettings = {',
        '  PRODUCT_BUNDLE_IDENTIFIER = "com.acme.signed.ext.Extension";',
        '};'
      ].join('\n')
    )

    const {thrown, errors} = await run(converterThatFailsAfterWriting(), {
      noOpen: true,
      forceRegenerate: true
    })

    expect(thrown?.message).toBe(
      'safari-web-extension-converter failed (exit 1)\nerror: failed after writing'
    )

    expect(thrown?.code).toBe('E_SAFARI_TOOLCHAIN')
    expect(errors).toHaveLength(1)
    expect(fs.readFileSync(projFile, 'utf8').split('\n')).toEqual([
      'buildSettings = {',
      '\t\t\t\tCODE_SIGN_STYLE = Automatic;',
      '\t\t\t\tDEVELOPMENT_TEAM = USERTEAM42;',
      '  CURRENT_PROJECT_VERSION = 1;',
      '  MARKETING_VERSION = 1.0;',
      '  PRODUCT_BUNDLE_IDENTIFIER = com.acme.signed;',
      '  PRODUCT_NAME = "$(TARGET_NAME)";',
      '};',
      'buildSettings = {',
      '\t\t\t\tCODE_SIGN_STYLE = Automatic;',
      '\t\t\t\tDEVELOPMENT_TEAM = USERTEAM42;',
      '  CURRENT_PROJECT_VERSION = 1;',
      '  MARKETING_VERSION = 1.0;',
      '  PRODUCT_BUNDLE_IDENTIFIER = "com.acme.signed.ext.Extension";',
      '};'
    ])
  })

  it('first conversion that fails after writing: nothing was there before, so the project stays as the converter wrote it', async () => {
    const {thrown} = await run(converterThatFailsAfterWriting(), {noOpen: true})

    expect(thrown?.code).toBe('E_SAFARI_TOOLCHAIN')
    expect(fs.readFileSync(pbxprojPath(config()), 'utf8').split('\n')).toEqual([
      'buildSettings = {',
      '  CURRENT_PROJECT_VERSION = 1;',
      '  MARKETING_VERSION = 1.0;',
      '  PRODUCT_BUNDLE_IDENTIFIER = "com.converter.SignedExt";',
      '  PRODUCT_NAME = "$(TARGET_NAME)";',
      '};',
      'buildSettings = {',
      '  CURRENT_PROJECT_VERSION = 1;',
      '  MARKETING_VERSION = 1.0;',
      '  PRODUCT_BUNDLE_IDENTIFIER = "com.converter.SignedExt.Extension";',
      '};'
    ])
  })

  it('xcodebuild that fails after a regeneration: the project already carries the signing settings and the configured identifiers', async () => {
    expect((await run(fakeSafariTools(), {noOpen: true})).thrown).toBeNull()

    const projFile = pbxprojPath(config())
    fs.writeFileSync(
      projFile,
      ['buildSettings = {', '  DEVELOPMENT_TEAM = USERTEAM42;', '};'].join('\n')
    )

    const {thrown} = await run(
      fakeSafariTools({xcodebuild: {code: 65, output: 'error: signing'}}),
      {noOpen: true, forceRegenerate: true}
    )

    expect(thrown?.code).toBe('E_SAFARI_TOOLCHAIN')

    const left = fs.readFileSync(projFile, 'utf8')
    const bundleId = config().bundleIdentifier

    expect(left.match(/DEVELOPMENT_TEAM = USERTEAM42;/g)).toHaveLength(2)
    expect(left).toContain(`PRODUCT_BUNDLE_IDENTIFIER = "${bundleId}";`)
    expect(left).toContain(
      `PRODUCT_BUNDLE_IDENTIFIER = "${bundleId}.Extension";`
    )

    expect(left).not.toContain('com.converter')
  })
})

describe('a Safari dev session whose build left no app', () => {
  // Pins today's behavior. Ledger 1374 D23.
  it('opens the Xcode project and then looks five seconds for an app that was never started', async () => {
    const tools = fakeSafariTools()
    let appLookups = 0

    // A build that answers green and leaves no .app behind.
    tools.runXcodebuild = async (args) => {
      tools.calls.xcodebuild.push(args)

      return {ok: true, code: 0, output: ''}
    }

    tools.listAppPids = async () => {
      appLookups += 1

      return []
    }

    const {value, waitedMs} = await onFakeClock(() =>
      run(tools, {announceDevReady: true})
    )

    expect(value.thrown).toBeNull()
    expect(tools.calls.openApp).toEqual([xcodeProjectPath(config())])
    expect(tools.calls.pluginkitAdd).toEqual([])

    // One look before the open, then one every 250 ms until five seconds pass.
    expect(appLookups).toBe(21)
    expect(waitedMs).toBe(5000)
  })
})
