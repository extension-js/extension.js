import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  BrowserLauncherFn,
  DevOptions,
  BrowserController as EngineBrowserController,
  BrowserLaunchOptions as EngineBrowserLaunchOptions,
  BrowserType as EngineBrowserType,
  SafariPackagerFn as EngineSafariPackagerFn,
  SafariPackagerOverrides as EngineSafariPackagerOverrides
} from 'extension-develop'
import type {LogContext as EngineLogContext} from 'extension-develop/bridge'
import type {LogEventLike as EngineLogEventLike} from 'extension-develop/contracts'
import type {PreviewLauncherFn} from 'extension-develop/preview'
import {describe, expect, it} from 'vitest'
// @ts-expect-error plain ESM script without types, shared with the script specs
import {workspaceSourceEntries} from '../../../scripts/lib/workspace-source-entries.mjs'
import type {
  LocalizableManifest as EngineLocalizableManifest,
  LocalizedNameOptions as EngineLocalizedNameOptions
} from '../../develop/lib/localized-manifest-name'
import type {
  BrowserController,
  BrowserLaunchOptions,
  SafariPackagerFn,
  SafariPackagerOverrides
} from '../browsers'
import type {
  BrowserLogSinkEvent,
  ExtensionLoadRetryResult,
  PluginInterface
} from '../browsers/browsers-types'
import type {PreviewBrowserSession} from '../browsers/run-only'
import type {LogEventLike} from '../commands/logs'
import type {
  LocalizableManifest,
  LocalizedNameOptions
} from '../helpers/localized-manifest-name'
import type {LogContext} from '../helpers/log-contexts'
import type {LogLevel} from '../helpers/normalize-options'
import {SUPPORTED_BROWSER_TARGETS} from '../helpers/vendors'
import type {Agrees, Fits, Same} from './helpers/type-agreement'

// A type written here by hand beside the engine's goes on agreeing with it
// only while someone remembers to edit both, so the typecheck gate compares.
type EngineLogSinkEvent = Parameters<
  NonNullable<EngineBrowserLaunchOptions['logSink']>
>[0]
type EngineLoadRetryResult = Awaited<
  ReturnType<NonNullable<EngineBrowserController['retryExtensionLoad']>>
>
type EnginePreviewSession = Exclude<
  Awaited<ReturnType<PreviewLauncherFn>>,
  void
>
type EngineLaunched = Awaited<ReturnType<BrowserLauncherFn>>
type LogKeys =
  | 'logLevel'
  | 'logContexts'
  | 'logFormat'
  | 'logTimestamps'
  | 'logColor'
  | 'logUrl'
  | 'logTab'

const everyKeptCopyAgreesWithTheEngine: [
  Agrees<BrowserLaunchOptions, EngineBrowserLaunchOptions>,
  Agrees<BrowserController, EngineBrowserController>,
  Fits<BrowserController, EngineLaunched>,
  Agrees<BrowserLogSinkEvent, EngineLogSinkEvent>,
  Agrees<ExtensionLoadRetryResult, EngineLoadRetryResult>,
  Agrees<PreviewBrowserSession, EnginePreviewSession>,
  Agrees<SafariPackagerOverrides, EngineSafariPackagerOverrides>,
  Fits<SafariPackagerFn, EngineSafariPackagerFn>,
  Agrees<Pick<PluginInterface, LogKeys>, Pick<DevOptions, LogKeys>>,
  Same<LogContext, EngineLogContext>,
  Same<LogLevel, NonNullable<DevOptions['logLevel']>>,
  // The printers read more fields than the engine's filter does.
  Fits<LogEventLike, EngineLogEventLike>,
  Agrees<LocalizableManifest, EngineLocalizableManifest>,
  Agrees<LocalizedNameOptions, EngineLocalizedNameOptions>
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true
]

void everyKeptCopyAgreesWithTheEngine

// Every target, and no other, or this object does not compile.
const engineTargets: Record<EngineBrowserType, true> = {
  chrome: true,
  edge: true,
  firefox: true,
  chromium: true,
  brave: true,
  opera: true,
  vivaldi: true,
  yandex: true,
  waterfox: true,
  librewolf: true,
  zen: true,
  floorp: true,
  'chromium-based': true,
  'gecko-based': true,
  'firefox-based': true,
  safari: true,
  'webkit-based': true,
  'chromium-emulator': true
}

const extensionRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(extensionRoot, '..', '..')
const engineRoot = path.resolve(extensionRoot, '..', 'develop')
// The packages this one loads at run time and must not retype by hand.
const siblingRoots = ['develop', 'create', 'install'].map((name) =>
  path.resolve(extensionRoot, '..', name)
)
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', '__spec__'])

// A type declared here under a name the engine also declares. Each one is
// either another thing with the same name or a copy a check above compares.
const KEPT_ON_PURPOSE: Array<{file: string; names: string[]; why: string}> = [
  {
    file: 'config-types.ts',
    names: [
      'BrowserConfig',
      'BrowserType',
      'CompanionExtensionsConfig',
      'ConfigHookContext',
      'ExcludeFilesConfig',
      'FileConfig',
      'IncludeFileEntry',
      'IncludeFilesConfig',
      'PerfBudgetsConfig',
      'SpecialFoldersConfig'
    ],
    why: 'The published config types, which load no bundler types. Compared in public-config-layers.spec.ts.'
  },
  {
    file: 'browsers/index.ts',
    names: ['BrowserController', 'BrowserLaunchOptions'],
    why: 'The published launcher contract, which loads no engine types. Compared above.'
  },
  {
    file: 'browsers/browsers-types.ts',
    names: ['BrowserLogSinkEvent', 'ExtensionLoadRetryResult'],
    why: 'Part of the published launcher contract. Compared above.'
  },
  {
    file: 'browsers/browsers-types.ts',
    names: ['BrowserConfig', 'PluginInterface'],
    why: 'Another thing under the same name: what a launcher holds for one run, not a config block or a bundler plugin.'
  },
  {
    file: 'browsers/run-only.ts',
    names: ['PreviewBrowserSession'],
    why: 'Part of the published launcher contract. Compared above.'
  },
  {
    file: 'browsers/run-safari/safari-packager.ts',
    names: ['SafariPackagerFn', 'SafariPackagerOverrides'],
    why: 'The published Safari packager contract. Compared above.'
  },
  {
    file: 'commands/build.ts',
    names: ['BuildOptions'],
    why: 'Another thing under the same name: the flags as the parser read them.'
  },
  {
    file: 'commands/dev.ts',
    names: ['DevOptions'],
    why: 'Another thing under the same name: the flags as the parser read them.'
  },
  {
    file: 'commands/preview.ts',
    names: ['PreviewOptions'],
    why: 'Another thing under the same name: the flags as the parser read them.'
  },
  {
    file: 'commands/start.ts',
    names: ['StartOptions'],
    why: 'Another thing under the same name: the flags as the parser read them.'
  },
  {
    file: 'commands/logs.ts',
    names: ['LogEventLike'],
    why: 'The fields the printers read, more than the engine filter names. Compared above.'
  },
  {
    file: 'helpers/messaging.ts',
    names: [
      'CardInput',
      'CardRow',
      'Channel',
      'Diagnostic',
      'Envelope',
      'EnvelopeError',
      'EnvelopeErrorRefs',
      'EnvelopeExtras',
      'ErrorCode'
    ],
    why: 'Each package prints with its own copy of this file. Compared in messaging-primitives-drift.spec.ts.'
  },
  {
    file: 'helpers/log-contexts.ts',
    names: ['LogContext'],
    why: 'Help text lists the contexts before the engine loads. Compared above.'
  },
  {
    file: 'helpers/normalize-options.ts',
    names: ['LogLevel'],
    why: 'The --logs filter level. The engine uses the name for the level of one log line. Compared above with the option it feeds.'
  }
]

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return SKIPPED_FOLDERS.has(entry.name) ? [] : sourceFiles(full)
    }

    return /\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)
      ? [full]
      : []
  })
}

// The names a file declares and exports as a type, a class included.
function declaredTypeNames(text: string): string[] {
  return [
    ...text.matchAll(
      /^[ \t]*export\s+(?:declare\s+)?(?:abstract\s+)?(?:type|interface|class)\s+([A-Za-z_$][\w$]*)/gm
    )
  ].map((match) => match[1])
}

// Only what is written as a type: a copied function is another matter.
function declaredTypeAndInterfaceNames(text: string): string[] {
  return [
    ...text.matchAll(
      /^[ \t]*export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)\s*[=<{]|^[ \t]*export\s+(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)\s+extends\b/gm
    )
  ].map((match) => match[1] ?? match[2])
}

function moduleSpecifiers(text: string): string[] {
  return [...text.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)].map(
    (match) => match[1]
  )
}

function resolveSource(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier)

  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

// The entry files a package exports, in source form. The published manifest
// names built files only, so the workspace map is where the sources are read.
function entryFiles(packageRoot: string): string[] {
  return Object.values(workspaceSourceEntries as Record<string, string>)
    .map((file) => path.resolve(repoRoot, file))
    .filter((file) => path.dirname(file) === packageRoot)
}

// What an entry exports comes from the files it names, so every type those
// files export counts: a copy of one is a copy of an engine type.
function enginePublicTypeNames(): Set<string> {
  const names = new Set<string>()
  const files = new Set<string>([path.join(engineRoot, 'types.ts')])

  for (const entry of siblingRoots.flatMap(entryFiles)) {
    files.add(entry)

    for (const specifier of moduleSpecifiers(fs.readFileSync(entry, 'utf8'))) {
      const resolved = resolveSource(entry, specifier)
      if (resolved) files.add(resolved)
    }
  }

  for (const file of files) {
    for (const name of declaredTypeNames(fs.readFileSync(file, 'utf8'))) {
      names.add(name)
    }
  }

  return names
}

function copiedNames(engineNames: Set<string>): string[] {
  return sourceFiles(extensionRoot).flatMap((file) => {
    const relative = path
      .relative(extensionRoot, file)
      .split(path.sep)
      .join('/')

    return declaredTypeAndInterfaceNames(fs.readFileSync(file, 'utf8'))
      .filter((name) => engineNames.has(name))
      .map((name) => `${relative}: ${name}`)
  })
}

const keptOnPurpose = KEPT_ON_PURPOSE.flatMap(({file, names}) =>
  names.map((name) => `${file}: ${name}`)
)

describe('the types the CLI shares with the build engine', () => {
  it('reads an exported type, interface and class and skips the rest', () => {
    const text =
      'export type A = 1\n' +
      '  export interface B extends A {}\n' +
      'export declare type C<T> = T\n' +
      'export class D {}\n' +
      'type E = 1\n' +
      'export const F = 1\n' +
      "export type {G} from './g'\n"

    expect(declaredTypeNames(text)).toEqual(['A', 'B', 'C', 'D'])
    expect(declaredTypeAndInterfaceNames(text)).toEqual(['A', 'B', 'C'])
    expect(moduleSpecifiers(text)).toEqual(['./g'])
  })

  it('finds the types the engine and its sibling packages export', () => {
    const names = enginePublicTypeNames()

    expect(entryFiles(engineRoot).length).toBeGreaterThan(3)
    // One from types.ts, one an entry re-exports, one beside a re-export.
    expect(names).toContain('FileConfig')
    expect(names).toContain('BrowserLaunchOptions')
    expect(names).toContain('BrowserLogSinkEvent')
    expect(names).toContain('CommandOp')
    expect(names).toContain('CreateResult')
    expect(names).toContain('UninstallResult')
  })

  it('are imported from the engine, never declared again under its name', () => {
    const copied = copiedNames(enginePublicTypeNames()).sort()

    expect(
      copied.filter((name) => !keptOnPurpose.includes(name)),
      'Import the type from extension-develop with `import type`. A copy ' +
        'drifts from the engine and no check notices. If it must stay, ' +
        'compare it in this file and add it to KEPT_ON_PURPOSE with the reason.'
    ).toEqual([])
  })

  it('lists no exception that is not one any more', () => {
    const copied = copiedNames(enginePublicTypeNames())

    expect(keptOnPurpose.filter((name) => !copied.includes(name))).toEqual([])

    for (const {why} of KEPT_ON_PURPOSE) expect(why.length).toBeGreaterThan(20)
  })

  it('keep the published declarations free of an engine import', () => {
    const published = [
      path.join(extensionRoot, 'config-types.ts'),
      ...sourceFiles(path.join(extensionRoot, 'browsers'))
    ]
    const importing = published.filter((file) =>
      /(?:from\s+|import\(\s*)['"]extension-develop(?:\/[^'"]*)?['"]/.test(
        fs.readFileSync(file, 'utf8')
      )
    )

    // A project that reads these would have to load the bundler's types.
    expect(published.length).toBeGreaterThan(10)
    expect(importing.map((file) => path.relative(extensionRoot, file))).toEqual(
      []
    )
  })

  it('name the same browser targets as the engine', () => {
    expect([...SUPPORTED_BROWSER_TARGETS].sort()).toEqual(
      Object.keys(engineTargets).sort()
    )
  })
})
