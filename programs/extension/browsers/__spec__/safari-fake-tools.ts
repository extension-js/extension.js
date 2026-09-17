import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  SafariPipelineTools,
  SafariToolResult
} from '../run-safari/safari-launch'

export interface FakeSafariToolsOptions {
  platformOk?: boolean
  toolchainOk?: boolean
  converter?: {code?: number; output?: string}
  xcodebuild?: {code?: number; output?: string}
  pid?: number | null
  registered?: boolean
}

export interface FakeSafariTools extends SafariPipelineTools {
  calls: {
    converter: string[][]
    xcodebuild: string[][]
    openApp: string[]
    openSafari: string[]
    resolvePid: string[]
    pluginkit: number
  }
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

// What a green xcodebuild leaves behind: the .app under the derived data path.
function writeBuiltApp(args: string[]) {
  const derivedData = argAfter(args, '-derivedDataPath')
  const project = argAfter(args, '-project')
  const appName = path.basename(project, '.xcodeproj')

  fs.mkdirSync(
    path.join(derivedData, 'Build', 'Products', 'Release', `${appName}.app`),
    {recursive: true}
  )
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

  const tools: FakeSafariTools = {
    calls: {
      converter: [],
      xcodebuild: [],
      openApp: [],
      openSafari: [],
      resolvePid: [],
      pluginkit: 0
    },
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
    }
  }

  return tools
}
