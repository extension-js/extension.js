import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import type {PlaywrightAutomationCommand, ReadyMetadata} from '../bridge-entry'
import {createReadyContractWriter} from '../plugin-ready-contract'
import type {ReadyContract} from '../types'
import {trackTempFolders} from './helpers/temp-folders'

const developRoot = path.resolve(__dirname, '..')
const writerSourcePath = path.join(
  developRoot,
  'plugin-ready-contract',
  'index.ts'
)
const tempFolder = trackTempFolders()

type WriterOptions = Parameters<typeof createReadyContractWriter>[0]
type Document = Record<string, unknown>

// One shape: the names the bridge still publishes for older callers are the
// public type itself, so a field added to one cannot be missing from another.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const earlierNameIsTheContract: Same<ReadyMetadata, ReadyContract> = true
const earlierCommandIsTheContract: Same<
  PlaywrightAutomationCommand,
  ReadyContract['command']
> = true

// A Windows checkout holds the sources with CRLF, so every read of one
// goes through here and the patterns below match on a plain line feed.
function sourceText(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

// The interface as written in types.ts, one field per two-space line.
function readyContractBody(): string {
  const source = sourceText(path.join(developRoot, 'types.ts'))
  const start = source.indexOf('\nexport interface ReadyContract {\n')

  expect(start, 'types.ts declares no ReadyContract interface').toBeGreaterThan(
    -1
  )

  return source.slice(start, source.indexOf('\n}\n', start))
}

function fieldsOfReadyContract(only: 'all' | 'required' = 'all'): string[] {
  const field =
    only === 'all' ? /^ {2}([A-Za-z]+)\??: /gm : /^ {2}([A-Za-z]+): /gm

  return [...readyContractBody().matchAll(field)]
    .map((match) => match[1])
    .sort()
}

// Every field the writer reads off the document on disk. Those are the ones
// the browser launcher stamps, so the stand-in below stamps each of them.
function fieldsTheWriterReadsBack(): string[] {
  const source = sourceText(writerSourcePath)

  return [
    ...new Set(
      [...source.matchAll(/\bprev\??\.([A-Za-z]+)\b/g)].map((m) => m[1])
    )
  ].sort()
}

const programsRoot = path.resolve(developRoot, '..')
const sharedWriterPath = path.join(
  developRoot,
  'lib',
  'ready-contract-writer.ts'
)

function productSources(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return ['node_modules', 'dist', '__spec__'].includes(entry.name)
        ? []
        : productSources(full)
    }

    return /\.ts$/.test(entry.name) && !/\.(?:spec|d)\.ts$/.test(entry.name)
      ? [full]
      : []
  })
}

// Every file of the engine and the CLI that hands the shared writer a patch.
// The engine's own writer is read apart, off the fields it reads back.
function launcherStampSources(): string[] {
  return ['develop', 'extension']
    .flatMap((program) => productSources(path.join(programsRoot, program)))
    .filter(
      (file) =>
        file !== writerSourcePath &&
        /from '[./]+(?:develop\/)?(?:lib\/)?ready-contract-writer'/.test(
          sourceText(file)
        )
    )
    .sort()
}

// Every field the launchers stamp, read off their stamp code. The writer
// carries any field it does not own across a recompile of the same run, so
// it no longer names these one by one, and the stand-in must learn them here.
function fieldsTheLaunchersStamp(): string[] {
  const fields = new Set<string>()

  for (const file of launcherStampSources()) {
    const source = sourceText(file)

    for (const m of source.matchAll(/\bready\.([A-Za-z]+) =/g)) {
      fields.add(m[1])
    }
  }

  // The pid stamps write through the shared writer's table of field names.
  const shared = sourceText(sharedWriterPath)

  for (const m of shared.matchAll(
    /(?:pid|startedAt|startId): '([A-Za-z]+)'/g
  )) {
    fields.add(m[1])
  }

  return [...fields].sort()
}

function makeProject(): string {
  const root = tempFolder('extjs-ready-contract-')

  fs.mkdirSync(path.join(root, 'src'), {recursive: true})
  fs.mkdirSync(path.join(root, 'extensions', 'helper'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'src', 'manifest.json'),
    JSON.stringify({name: 'Fixture', version: '1.0.0', manifest_version: 3})
  )

  fs.writeFileSync(
    path.join(root, 'extensions', 'helper', 'manifest.json'),
    JSON.stringify({name: 'Helper', version: '1.0.0', manifest_version: 3})
  )

  return root
}

function session(root: string, overrides: Partial<WriterOptions> = {}) {
  const browser = overrides.browser ?? 'chrome'
  const readyPath = path.join(
    root,
    'dist',
    'extension-js',
    browser,
    'ready.json'
  )
  const seen = new Set<string>()

  const writer = createReadyContractWriter({
    packageJsonDir: root,
    browser,
    command: 'dev',
    distPath: path.join(root, 'dist', browser),
    manifestPath: path.join(root, 'src', 'manifest.json'),
    port: 8080,
    host: '127.0.0.1',
    instanceId: 'instance-1',
    instanceExplicit: true,
    controlPort: 8081,
    controlPath: '/control',
    logsPath: path.join(root, 'dist', 'extension-js', browser, 'logs.ndjson'),
    managedExtensionDirs: [path.join(root, 'extensions', 'helper')],
    ...overrides
  })

  const read = (): Document =>
    JSON.parse(fs.readFileSync(readyPath, 'utf8')) as Document

  // Call after each write: the fields of every document add up.
  const record = () => {
    for (const key of Object.keys(read())) seen.add(key)
  }

  // What the launcher does between two compiles of the same run.
  const stamp = (patch: Document) => {
    fs.writeFileSync(readyPath, JSON.stringify({...read(), ...patch}))
  }

  return {writer, read, record, stamp, seen}
}

// The fields the writer owns on every write, which no launcher stamps.
const WRITER_OWNED = new Set([
  'runId',
  'status',
  'startedAt',
  'compiledAt',
  'ts',
  'code',
  'message',
  'managedExtensions',
  'devAdditions',
  'awaitingExecutorSince',
  'endedAsFailedAt',
  'endedAsFailedCode'
])

function launcherStamps(
  value: (field: string) => unknown,
  leaveOut: string[] = []
): Document {
  // Only real stamps: the writer keeps any field the launcher stamps within a
  // run, so a made-up one here would land in the list this spec checks.
  const stamps: Document = {}

  const fields = new Set([
    ...fieldsTheWriterReadsBack(),
    ...fieldsTheLaunchersStamp()
  ])

  for (const field of fields) {
    if (WRITER_OWNED.has(field) || leaveOut.includes(field)) continue

    stamps[field] = value(field)
  }

  return stamps
}

function fieldsTheWriterWrites(): string[] {
  const seen = new Set<string>()

  const keep = (from: Set<string>) => {
    for (const key of from) seen.add(key)
  }

  // A dev session from its first write to its last.
  const dev = session(makeProject(), {readyAwaitsExecutor: true})
  dev.writer.writeStarting()
  dev.record()
  dev.writer.setDevAdditions([
    {kind: 'permission', value: 'scripting', reason: 'reload'}
  ])

  dev.writer.writeReady('2026-11-01T00:00:00.000Z')
  dev.record()
  dev.writer.stampExecutorAttached({
    origin: 'safari-web-extension://ABC-123'
  })

  dev.record()
  dev.writer.stampReload('full', 'manifest.json')
  dev.record()
  dev.writer.stampExecutorDetached()
  dev.record()
  dev.writer.writeError('build_failed', 'the build failed', ['one error'])
  dev.record()
  dev.writer.writeShutdown()
  dev.record()
  keep(dev.seen)

  // A session a host ended as failed, which the watch close leaves as is.
  const ended = session(makeProject())
  ended.writer.writeStarting()
  ended.writer.writeReady()
  ended.writer.writeEndedAsFailed('E_HOST', 'the host ended the session')
  ended.record()
  ended.writer.writeShutdown()
  ended.record()
  keep(ended.seen)

  // A session whose control channel could not bind, on the emulator target.
  const emulator = session(makeProject(), {
    browser: 'chromium-emulator',
    controlPort: null,
    controlPortUnavailableReason: 'the port is taken'
  })
  emulator.writer.writeStarting()
  emulator.writer.writeReady()
  emulator.record()
  keep(emulator.seen)

  // The launcher's stamps, in every JSON shape, then a recompile. The second
  // pass leaves the attach out, since it clears the wait the launcher noted.
  const text = (field: string) =>
    field === 'extensionIdSource'
      ? 'browser'
      : field === 'runtime'
        ? 'detached'
        : '2026-11-01T00:00:00.000Z'

  const shapes: Array<(field: string) => unknown> = [
    // The shape each stamp has in a real session, read off its name.
    (field) =>
      /(Port|Pid|WaitMs|ExitCode)$/.test(field)
        ? 1
        : field === 'safari'
          ? {bundleId: 'dev.example.fixture'}
          : text(field),
    text,
    () => 1,
    () => true,
    () => ({bundleId: 'dev.example.fixture'}),
    () => [{kind: 'browser_flag', value: '--flag', reason: 'dev'}]
  ]

  for (const shape of shapes) {
    for (const leaveOut of [[], ['executorAttachedAt']]) {
      const run = session(makeProject())
      run.writer.writeStarting()
      run.stamp(launcherStamps(shape, leaveOut))
      run.writer.writeReady()
      run.record()
      keep(run.seen)
    }
  }

  // Written where the system has a boot id and a start tick, so on Linux.
  seen.add('pidStartId')

  return [...seen].sort()
}

describe('the ReadyContract type in types.ts', () => {
  it('lists every field the engine writes to ready.json, and no other', () => {
    const written = fieldsTheWriterWrites()

    expect(written.length).toBeGreaterThan(40)
    expect(fieldsOfReadyContract()).toEqual(written)
  })

  it('is the one shape, under the earlier names the bridge still exports', () => {
    expect(earlierNameIsTheContract).toBe(true)
    expect(earlierCommandIsTheContract).toBe(true)

    const declared = ['develop', 'extension']
      .flatMap((program) => productSources(path.join(programsRoot, program)))
      .filter((file) =>
        /\b(?:type|interface) ReadyMetadata\b(?! = ReadyContract\n)/.test(
          sourceText(file)
        )
      )

    expect(declared).toEqual([])
  })

  it('covers every caller that stamps the file, engine and CLI', () => {
    expect(
      launcherStampSources().map((file) =>
        path.relative(programsRoot, file).split(path.sep).join('/')
      )
    ).toEqual([
      'develop/plugin-browsers/launch-timeout-stamp.ts',
      'extension/browsers/browsers-lib/ready-stamp.ts'
    ])

    const typed = fieldsOfReadyContract()
    const stamped = [
      ...fieldsTheLaunchersStamp(),
      ...fieldsTheWriterReadsBack()
    ]

    expect(stamped.length).toBeGreaterThan(60)
    expect(stamped.filter((field) => !typed.includes(field))).toEqual([])

    for (const identity of [
      'browserPid',
      'browserStartedAt',
      'browserStartId',
      'launcherPid',
      'launcherStartedAt',
      'launcherStartId'
    ]) {
      expect(fieldsTheLaunchersStamp()).toContain(identity)
    }
  })

  it('marks as always present only what the first write carries', () => {
    const root = makeProject()
    const first = session(root, {
      manifestPath: path.join(root, 'no-manifest.json'),
      host: undefined,
      instanceId: undefined,
      instanceExplicit: undefined,
      controlPath: undefined,
      logsPath: undefined,
      managedExtensionDirs: undefined
    })
    first.writer.writeStarting()

    // The first write carries pidStartId on Linux alone, so the type keeps
    // it optional and it is left out of the comparison on every system.
    expect(fieldsOfReadyContract('required')).toEqual(
      Object.keys(first.read())
        .filter((field) => field !== 'pidStartId')
        .sort()
    )

    expect(fieldsOfReadyContract('all')).toContain('pidStartId')
    expect('pidStartId' in first.read()).toBe(process.platform === 'linux')
  })
})
