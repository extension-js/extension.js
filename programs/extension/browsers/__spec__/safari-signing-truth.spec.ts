// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import * as messages from '../browsers-lib/messages'
import type {BrowserLogger} from '../browsers-types'
import {packageSafariExtension} from '../run-safari/safari-launch'
import {
  builtAppPath,
  resolveSafariBuildConfig
} from '../run-safari/safari-launch/safari-config'
import {
  describeSignature,
  noAccountForTeam,
  parseCodeSignature,
  parseXcodeTeams,
  readSignatureRecord,
  saveSignatureRecord,
  signatureKey
} from '../run-safari/safari-launch/signature'
import {extensionCheckboxId} from '../run-safari/safari-ui/scripts'
import {type FakeSafariTools, fakeSafariTools} from './safari-fake-tools'
import {fakeSafariUiTools} from './safari-fake-ui-tools'

// Taken from a Mac whose config asked for 62ZL6K4MM4 (the certificate's
// team) while Xcode was signed into JU3XAJJQ2G: the app came out ad-hoc.
const ADHOC_CODESIGN = [
  'Executable=/tmp/Leon.app/Contents/MacOS/Leon',
  'Identifier=dev.extensionjs.Leon',
  'Format=app bundle with Mach-O thin (arm64)',
  'CodeDirectory v=20400 size=1234 flags=0x2(adhoc) hashes=30+7 location=embedded',
  'Signature=adhoc',
  'Info.plist entries=24',
  'TeamIdentifier=not set',
  'Sealed Resources version=2 rules=13 files=12'
].join('\n')

const TEAM_CODESIGN = [
  'Executable=/tmp/Leon.app/Contents/MacOS/Leon',
  'Identifier=dev.extensionjs.Leon',
  'Format=app bundle with Mach-O thin (arm64)',
  'CodeDirectory v=20400 size=1234 flags=0x0(none) hashes=30+7 location=embedded',
  'Signature size=4795',
  'Authority=Apple Development: hello@extension.dev (ABCDE12345)',
  'Authority=Apple Worldwide Developer Relations Certification Authority',
  'TeamIdentifier=JU3XAJJQ2G'
].join('\n')

const NO_ACCOUNT_LINE =
  "error: No Account for Team \"62ZL6K4MM4\". Add a new Account in Accounts settings or verify that your accounts have valid credentials. (in target 'Leon' from project 'Leon')"

const XCODE_TEAMS = `{
    "hello@extension.dev" =     (
                {
            isFreeProvisioningTeam = 0;
            teamID = JU3XAJJQ2G;
            teamName = "Cezar Augusto";
            teamType = Individual;
        }
    );
    "other@example.com" =     (
                {
            isFreeProvisioningTeam = 1;
            teamID = ABCDE12345;
            teamName = "Other Person";
            teamType = Personal;
        }
    );
}`

describe('the signature codesign reads off the built app', () => {
  it('reads the team off a team-signed app', () => {
    expect(parseCodeSignature(TEAM_CODESIGN)).toEqual({
      signed: true,
      team: 'JU3XAJJQ2G'
    })
  })

  it('reads an ad-hoc app as unsigned with no team', () => {
    expect(parseCodeSignature(ADHOC_CODESIGN)).toEqual({
      signed: false,
      team: null
    })
  })

  it('reads an app codesign refuses as unsigned', () => {
    expect(
      parseCodeSignature('/tmp/Leon.app: code object is not signed at all')
    ).toEqual({signed: false, team: null})

    expect(parseCodeSignature('')).toEqual({signed: false, team: null})
  })

  it('keeps one word per signature in the record', () => {
    expect(signatureKey({signed: true, team: 'JU3XAJJQ2G'})).toBe('JU3XAJJQ2G')
    expect(signatureKey({signed: false, team: null})).toBe('adhoc')
    expect(describeSignature('adhoc')).toBe('ad-hoc')
    expect(describeSignature('JU3XAJJQ2G')).toBe('team JU3XAJJQ2G')
  })

  it('round-trips the record under the Xcode project folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-sig-'))
    const config = {
      extensionDir: path.join(root, 'dist', 'safari'),
      projectLocation: path.join(root, 'dist', 'safari-xcode'),
      appName: 'Leon',
      bundleIdentifier: 'dev.extensionjs.Leon',
      bundleIdDerived: true,
      macOsOnly: true,
      language: 'swift' as const,
      open: true
    }

    try {
      expect(readSignatureRecord(config)).toBeNull()
      saveSignatureRecord(config, {signed: true, team: 'JU3XAJJQ2G'})
      expect(readSignatureRecord(config)).toBe('JU3XAJJQ2G')
      saveSignatureRecord(config, {signed: false, team: null})
      expect(readSignatureRecord(config)).toBe('adhoc')
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })
})

describe('the No Account for Team line in xcodebuild output', () => {
  it('names the team xcodebuild had no account for', () => {
    const output = `Build settings from command line:\n${NO_ACCOUNT_LINE}\n** BUILD FAILED **`
    expect(noAccountForTeam(output)).toBe('62ZL6K4MM4')
  })

  it('finds nothing in a clean build', () => {
    expect(noAccountForTeam('** BUILD SUCCEEDED **')).toBeNull()
    expect(noAccountForTeam('')).toBeNull()
  })
})

describe('the teams Xcode is signed into', () => {
  it('lists every team with its name from the Xcode defaults', () => {
    expect(parseXcodeTeams(XCODE_TEAMS)).toEqual([
      {id: 'JU3XAJJQ2G', name: 'Cezar Augusto'},
      {id: 'ABCDE12345', name: 'Other Person'}
    ])
  })

  it('answers no team for anything it cannot read', () => {
    expect(parseXcodeTeams('')).toEqual([])
    expect(
      parseXcodeTeams(
        'The domain/default pair of (com.apple.dt.Xcode, IDEProvisioningTeams) does not exist'
      )
    ).toEqual([])
  })
})

describe('the setup line words the signature the app carries', () => {
  it('names the team a signed app carries', () => {
    const line = messages.safariNextSteps('Leon', true, {team: 'JU3XAJJQ2G'})
    expect(line).toMatch(/Signed with team JU3XAJJQ2G/)
    expect(line).not.toMatch(/your team id/)
  })

  it('says ad-hoc although a team was set, and that Xcode has no account for it', () => {
    const line = messages.safariNextSteps('Leon', false, {
      team: null,
      requestedTeam: '62ZL6K4MM4',
      noAccount: true,
      knownTeams: [{id: 'JU3XAJJQ2G', name: 'Cezar Augusto'}]
    })

    expect(line).toMatch(
      /Ad-hoc signed although developmentTeam 62ZL6K4MM4 was set: Xcode has no account for that team\./
    )

    expect(line).toMatch(
      /Sign in to Xcode \(Settings, Accounts\) with the Apple ID that owns team 62ZL6K4MM4\./
    )

    expect(line).toMatch(
      /Set developmentTeam to a team Xcode knows: JU3XAJJQ2G \(Cezar Augusto\)\./
    )

    expect(line).toMatch(/Drop developmentTeam for an ad-hoc build\./)
    expect(line).not.toMatch(/only while unsigned extensions are allowed/)
    expect(line).toMatch(/Allow unsigned extensions/)
    expect(line).not.toMatch(/!/)
  })

  it('does not claim a missing account when xcodebuild never said so', () => {
    const line = messages.safariNextSteps('Leon', false, {
      team: null,
      requestedTeam: '62ZL6K4MM4'
    })

    expect(line).toMatch(
      /Ad-hoc signed although developmentTeam 62ZL6K4MM4 was set: Xcode did not sign with it\./
    )

    expect(line).toMatch(/Set developmentTeam to a team Xcode is signed into\./)
    expect(line).not.toMatch(/no account/)
  })

  it('keeps the plain ad-hoc line when no team was asked for', () => {
    expect(messages.safariNextSteps('Leon', false, {team: null})).toMatch(
      /only while unsigned extensions are allowed/
    )
  })

  it('says a changed signature makes Safari treat the build as a new extension', () => {
    const line = messages.safariSigningChanged(
      'Leon',
      'ad-hoc',
      'team JU3XAJJQ2G'
    )

    expect(line).toMatch(
      /Leon is now team JU3XAJJQ2G signed and the last build was ad-hoc signed, so Safari treats it as a new extension and the setup steps run again\./
    )
  })
})

describe('the xcodebuild failure names the missing account before the tail', () => {
  it('puts the cause and the three remedies between the label and the raw tail', () => {
    const cause = messages.safariNoAccountForTeam('62ZL6K4MM4', [
      {id: 'JU3XAJJQ2G', name: 'Cezar Augusto'}
    ])
    const line = messages.safariToolFailed(
      'xcodebuild',
      65,
      NO_ACCOUNT_LINE,
      cause
    )
    const labelAt = line.indexOf('failed (exit 65).')
    const causeAt = line.indexOf(
      "Xcode has no account for team 62ZL6K4MM4, so it couldn't sign the app with it."
    )
    const tailAt = line.indexOf('── last output ──')

    expect(labelAt).toBeGreaterThanOrEqual(0)
    expect(causeAt).toBeGreaterThan(labelAt)
    expect(tailAt).toBeGreaterThan(causeAt)
    expect(line).toMatch(
      /- Sign in to Xcode \(Settings, Accounts\) with the Apple ID that owns team 62ZL6K4MM4\./
    )

    expect(line).toMatch(
      /- Set developmentTeam to a team Xcode knows: JU3XAJJQ2G \(Cezar Augusto\)\./
    )

    expect(line).toMatch(/- Drop developmentTeam for an ad-hoc build\./)
  })

  it('leaves a failure without the line as it was', () => {
    expect(messages.safariToolFailed('xcodebuild', 65, 'tail')).toBe(
      messages.safariToolFailed('xcodebuild', 65, 'tail', undefined)
    )
  })
})

describe('the pipeline reads the signature off the app it built', () => {
  let root: string
  let distDir: string

  function collectingLogger(logs: string[]): BrowserLogger {
    const push = (...args: unknown[]) => logs.push(args.map(String).join(' '))

    return {info: push, warn: push, error: push, debug: push}
  }

  function configFor(extra: Record<string, unknown> = {}) {
    return resolveSafariBuildConfig(
      {options: {output: {path: distDir}}} as never,
      {extension: [distDir], browser: 'safari', ...extra} as never
    )
  }

  async function run(
    host: Record<string, unknown>,
    tools: FakeSafariTools = fakeSafariTools()
  ) {
    fs.mkdirSync(distDir, {recursive: true})
    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify({name: 'MyExt', version: '1.0.0', manifest_version: 3})
    )

    fs.mkdirSync(path.join(distDir, '..', 'extension-js', 'safari'), {
      recursive: true
    })

    fs.writeFileSync(
      path.join(distDir, '..', 'extension-js', 'safari', 'ready.json'),
      JSON.stringify({status: 'ready', browser: 'safari', command: 'dev'})
    )

    // The appex the enabling step registers with pluginkit.
    fs.mkdirSync(
      path.join(
        builtAppPath(configFor()),
        'Contents',
        'PlugIns',
        'MyExt Extension.appex'
      ),
      {recursive: true}
    )

    const logs: string[] = []
    const outcome = await packageSafariExtension(
      {extension: [distDir], browser: 'safari', tools, ...host} as never,
      distDir,
      collectingLogger(logs),
      'full'
    ).then(
      () => ({error: null as Error | null}),
      (error: Error) => ({error})
    )

    return {logs, tools, error: outcome.error}
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-truth-'))
    distDir = path.join(root, 'dist', 'safari')
    process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'
  })

  afterEach(() => {
    delete process.env.EXTENSION_CLI_BANNER_PRINTED
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('asks codesign about the app it built and words the setup line from the answer', async () => {
    const {logs, tools, error} = await run({developmentTeam: 'JU3XAJJQ2G'})

    expect(error).toBeNull()
    expect(tools.calls.codesign).toEqual([expect.stringMatching(/MyExt\.app$/)])

    expect(logs).toContain(
      messages.safariNextSteps('MyExt', true, {
        team: 'JU3XAJJQ2G',
        requestedTeam: 'JU3XAJJQ2G',
        noAccount: false,
        knownTeams: []
      })
    )

    expect(logs.join('\n')).toMatch(/Signed with team JU3XAJJQ2G/)
    expect(tools.calls.xcodeTeams).toBe(0)
  })

  it('says ad-hoc although a team was set when the app carries no team', async () => {
    const tools = fakeSafariTools({
      xcodebuild: {
        code: 0,
        output: `${NO_ACCOUNT_LINE}\n** BUILD SUCCEEDED **`
      },
      codesign: {output: ADHOC_CODESIGN},
      xcodeTeams: XCODE_TEAMS
    })
    const {logs, error} = await run({developmentTeam: '62ZL6K4MM4'}, tools)

    expect(error).toBeNull()
    expect(logs).toContain(
      messages.safariNextSteps('MyExt', false, {
        team: null,
        requestedTeam: '62ZL6K4MM4',
        noAccount: true,
        knownTeams: [
          {id: 'JU3XAJJQ2G', name: 'Cezar Augusto'},
          {id: 'ABCDE12345', name: 'Other Person'}
        ]
      })
    )

    const text = logs.join('\n')
    expect(text).toMatch(/Xcode has no account for that team/)
    expect(text).toMatch(/JU3XAJJQ2G \(Cezar Augusto\)/)
    expect(text).not.toMatch(/Signed with/)
    expect(tools.calls.xcodeTeams).toBe(1)
  })

  it('names the missing account in the failure before the raw tail', async () => {
    const tools = fakeSafariTools({
      xcodebuild: {code: 65, output: `${NO_ACCOUNT_LINE}\n** BUILD FAILED **`},
      xcodeTeams: XCODE_TEAMS
    })
    const {logs, error} = await run({developmentTeam: '62ZL6K4MM4'}, tools)

    expect(error?.message).toMatch(/xcodebuild failed \(exit 65\)/)
    expect(error?.message).toMatch(/Xcode has no account for team 62ZL6K4MM4/)
    expect(logs).toContain(
      messages.safariToolFailed(
        'xcodebuild',
        65,
        `${NO_ACCOUNT_LINE}\n** BUILD FAILED **`,
        messages.safariNoAccountForTeam('62ZL6K4MM4', [
          {id: 'JU3XAJJQ2G', name: 'Cezar Augusto'},
          {id: 'ABCDE12345', name: 'Other Person'}
        ])
      )
    )

    expect(tools.calls.codesign).toEqual([])
  })

  it('says the signature changed when a build switches from ad-hoc to a team', async () => {
    const first = await run({})
    expect(first.error).toBeNull()
    expect(first.logs.join('\n')).not.toMatch(/treats it as a new extension/)

    const second = await run({developmentTeam: 'JU3XAJJQ2G'})
    expect(second.error).toBeNull()
    expect(second.logs).toContain(
      messages.safariSigningChanged('MyExt', 'ad-hoc', 'team JU3XAJJQ2G')
    )

    // The record now holds the team, so the same build again says nothing.
    const third = await run({developmentTeam: 'JU3XAJJQ2G'})
    expect(third.logs.join('\n')).not.toMatch(/treats it as a new extension/)
    expect(
      readSignatureRecord(configFor({developmentTeam: 'JU3XAJJQ2G'}))
    ).toBe('JU3XAJJQ2G')
  })

  it('flips the switch Safari filed the ad-hoc app under, not the configured team', async () => {
    const ui = fakeSafariUiTools()
    const scripts: string[] = []
    const runScript = ui.runScript

    ui.runScript = (source) => {
      scripts.push(source)

      return runScript(source)
    }

    const tools = fakeSafariTools({
      xcodebuild: {
        code: 0,
        output: `${NO_ACCOUNT_LINE}\n** BUILD SUCCEEDED **`
      },
      codesign: {output: ADHOC_CODESIGN}
    })
    const {logs, error} = await run(
      {
        developmentTeam: '62ZL6K4MM4',
        enableExtension: true,
        uiTools: ui,
        announceDevReady: true
      },
      tools
    )

    expect(error).toBeNull()
    expect(logs).toContain(messages.safariEnabled('MyExt', 'Allow'))
    const bundleId = configFor().bundleIdentifier
    const enabledScripts = scripts.filter((source) =>
      source.includes(extensionCheckboxId(bundleId))
    )
    expect(enabledScripts.length).toBeGreaterThan(0)
    expect(
      scripts.some((source) =>
        source.includes(extensionCheckboxId(bundleId, '62ZL6K4MM4'))
      )
    ).toBe(false)
  })
})
