import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  listPidsWhere,
  type SafariPipelineTools,
  type SafariToolResult,
  type SafariWebDriverProcess,
  spawnWebDriverProcess
} from '../run-safari/safari-launch'

export interface FakeSafariToolsOptions {
  platformOk?: boolean
  toolchainOk?: boolean
  converter?: {code?: number; output?: string}
  xcodebuild?: {code?: number; output?: string}
  pid?: number | null
  registered?: boolean
  // A stand-in safaridriver to spawn with `-p <port>` appended, or the spawn
  // error to answer with. Unset means no driver at all.
  webdriver?: {command: string; args: string[]} | {spawnError: string}
  // The argv fragment that marks a stand-in Safari in the real process list,
  // paired with `--automation` the way the production matcher pairs `Safari`.
  automationMatch?: string
  // The argv fragment that marks a stand-in container app in the real process
  // list. Unset means the app never shows up as running.
  appMatch?: string
  // What codesign answers for the built app. Unset means the signature the
  // fake xcodebuild wrote into the app: the DEVELOPMENT_TEAM it was given, or
  // ad-hoc without one.
  codesign?: {output: string}
  // What `defaults read com.apple.dt.Xcode IDEProvisioningTeams` answers.
  xcodeTeams?: string
}

export interface FakeSafariTools extends SafariPipelineTools {
  calls: {
    converter: string[][]
    xcodebuild: string[][]
    openApp: string[]
    openSafari: string[]
    resolvePid: string[]
    pluginkit: number
    webdriver: number[]
    codesign: string[]
    xcodeTeams: number
  }
  webdriverProcesses: SafariWebDriverProcess[]
  // Every tool call and logger line in the order the pipeline made them, so a
  // spec can prove what printed before which process ran.
  events: string[]
}

function argAfter(args: string[], flag: string): string {
  const at = args.indexOf(flag)

  return at >= 0 ? String(args[at + 1] || '') : ''
}

// What the real converter leaves behind: a project folder named after the app
// whose pbxproj carries ids derived from the app name, not --bundle-identifier.
function writeConvertedProject(args: string[]) {
  const location = argAfter(args, '--project-location')
  const appName = argAfter(args, '--app-name')
  const projDir = path.join(location, appName, `${appName}.xcodeproj`)
  const derived = appName.replace(/[^A-Za-z0-9]+/g, '-')

  fs.mkdirSync(projDir, {recursive: true})
  fs.writeFileSync(
    path.join(projDir, 'project.pbxproj'),
    [
      'buildSettings = {',
      `  PRODUCT_BUNDLE_IDENTIFIER = "com.converter.${derived}";`,
      '  PRODUCT_NAME = "$(TARGET_NAME)";',
      '};',
      'buildSettings = {',
      `  PRODUCT_BUNDLE_IDENTIFIER = "com.converter.${derived}.Extension";`,
      '};'
    ].join('\n')
  )
}

const FAKE_SIGNATURE_FILE = path.join('Contents', 'fake-codesign.txt')

// The codesign rows a real build carries: the team it was signed with, or
// the ad-hoc marks when no team was given.
function signatureRowsFor(args: string[]): string {
  const team = args
    .map((arg) => /^DEVELOPMENT_TEAM=(.+)$/.exec(arg)?.[1] || '')
    .find((value) => value.length > 0)

  return team
    ? `Identifier=com.fake.app\nFormat=app bundle with Mach-O thin (arm64)\nTeamIdentifier=${team}\n`
    : 'Identifier=com.fake.app\nFormat=app bundle with Mach-O thin (arm64)\nSignature=adhoc\nTeamIdentifier=not set\n'
}

// What a green xcodebuild leaves behind: the .app under the derived data path,
// carrying the signature the arguments asked for.
function writeBuiltApp(args: string[]) {
  const derivedData = argAfter(args, '-derivedDataPath')
  const project = argAfter(args, '-project')
  const appName = path.basename(project, '.xcodeproj')
  const appPath = path.join(
    derivedData,
    'Build',
    'Products',
    'Release',
    `${appName}.app`
  )

  fs.mkdirSync(path.join(appPath, 'Contents'), {recursive: true})
  fs.writeFileSync(
    path.join(appPath, FAKE_SIGNATURE_FILE),
    signatureRowsFor(args),
    'utf8'
  )
}

function readFakeSignature(appPath: string): SafariToolResult {
  try {
    return result(
      0,
      fs.readFileSync(path.join(appPath, FAKE_SIGNATURE_FILE), 'utf8')
    )
  } catch {
    return result(1, `${appPath}: code object is not signed at all`)
  }
}

function result(code: number, output: string): SafariToolResult {
  return {ok: code === 0, code, output}
}

export function fakeSafariTools(
  options: FakeSafariToolsOptions = {}
): FakeSafariTools {
  const platformOk = options.platformOk !== false
  const toolchainOk = platformOk && options.toolchainOk !== false
  const converterCode = options.converter?.code ?? 0
  const xcodebuildCode = options.xcodebuild?.code ?? 0
  const pid = options.pid === undefined ? 4242 : options.pid
  const registered = options.registered !== false

  const webdriver = options.webdriver ?? {
    spawnError: 'Error: spawn safaridriver ENOENT'
  }

  const tools: FakeSafariTools = {
    calls: {
      converter: [],
      xcodebuild: [],
      openApp: [],
      openSafari: [],
      resolvePid: [],
      pluginkit: 0,
      webdriver: [],
      codesign: [],
      xcodeTeams: 0
    },
    webdriverProcesses: [],
    events: [],
    detectToolchain: () => ({
      platformOk,
      developerDir: platformOk ? '/Applications/Xcode.app' : null,
      needsFullXcode: false,
      converter: toolchainOk ? '/usr/bin/safari-web-extension-converter' : null,
      xcodebuild: toolchainOk ? '/usr/bin/xcodebuild' : null,
      ok: toolchainOk
    }),
    runConverter: async (args) => {
      tools.calls.converter.push(args)
      tools.events.push('converter')
      if (converterCode === 0) writeConvertedProject(args)

      return result(converterCode, options.converter?.output ?? '')
    },
    runXcodebuild: async (args) => {
      tools.calls.xcodebuild.push(args)
      tools.events.push('xcodebuild')
      if (xcodebuildCode === 0) writeBuiltApp(args)

      return result(xcodebuildCode, options.xcodebuild?.output ?? '')
    },
    openApp: async (target) => {
      tools.calls.openApp.push(target)
      tools.events.push('openApp')

      return result(0, '')
    },
    openSafari: async (binary) => {
      tools.calls.openSafari.push(binary)
      tools.events.push('openSafari')

      return result(0, '')
    },
    resolvePid: async (bundleId) => {
      tools.calls.resolvePid.push(bundleId)
      tools.events.push('resolvePid')

      return pid
    },
    pluginkitList: async () => {
      tools.calls.pluginkit += 1
      tools.events.push('pluginkit')

      if (!registered) return ''

      // pluginkit lists the appex by the id the converter baked in, which is
      // the id the pipeline polls for even when a pinned Safari was raised.
      const known = [
        ...tools.calls.converter.map((args) =>
          argAfter(args, '--bundle-identifier')
        ),
        ...tools.calls.resolvePid
      ]

      return known.map((bundleId) => `${bundleId}.Extension`).join('\n')
    },
    startWebDriver: async (port) => {
      tools.calls.webdriver.push(port)
      tools.events.push('webdriver')

      const started =
        'command' in webdriver
          ? await spawnWebDriverProcess(webdriver.command, [
              ...webdriver.args,
              '-p',
              String(port)
            ])
          : {ok: false, output: webdriver.spawnError, stop: () => {}}

      tools.webdriverProcesses.push(started)

      return started
    },
    listAutomationPids: () => {
      const match = options.automationMatch
      if (!match) return Promise.resolve([])

      return listPidsWhere(
        (args) => args.includes(match) && args.includes('--automation')
      )
    },
    listAppPids: () => {
      const match = options.appMatch
      if (!match) return Promise.resolve([])

      return listPidsWhere((args) => args.includes(match))
    },
    readCodeSignature: async (appPath) => {
      tools.calls.codesign.push(appPath)
      tools.events.push('codesign')

      return options.codesign
        ? result(0, options.codesign.output)
        : readFakeSignature(appPath)
    },
    readXcodeTeams: async () => {
      tools.calls.xcodeTeams += 1
      tools.events.push('xcodeTeams')

      return options.xcodeTeams ?? ''
    }
  }

  return tools
}
