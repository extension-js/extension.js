import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  createPlaywrightMetadataWriter,
  type ReadyMetadata
} from '../plugin-playwright'
import type {ReadyContract} from '../types'
import {trackTempFolders} from './helpers/temp-folders'

const developRoot = path.resolve(__dirname, '..')
const writerSourcePath = path.join(developRoot, 'plugin-playwright', 'index.ts')
const tempFolder = trackTempFolders()

type WriterOptions = Parameters<typeof createPlaywrightMetadataWriter>[0]
type Document = Record<string, unknown>

// The writer's own type has to fit the public one: a field it declares with
// another type, or one the public type lacks, fails the typecheck gate here.
type SharedFields = Pick<Required<ReadyContract>, keyof ReadyMetadata>
type WriterTypeFits =
  Required<ReadyMetadata> extends SharedFields ? true : never
const writerTypeFits: WriterTypeFits = true

// The interface as written in types.ts, one field per two-space line.
function readyContractBody(): string {
  const source = fs
    .readFileSync(path.join(developRoot, 'types.ts'), 'utf8')
    .replace(/\r\n/g, '\n')
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
  const source = fs.readFileSync(writerSourcePath, 'utf8')

  return [
    ...new Set(
      [...source.matchAll(/\bprev\??\.([A-Za-z]+)\b/g)].map((m) => m[1])
    )
  ].sort()
}

// Every field the launchers stamp, read off their stamp code. The writer
// carries any field it does not own across a recompile of the same run, so
// it no longer names these one by one, and the stand-in must learn them here.
const launcherStampSources = [
  path.join(developRoot, 'plugin-browsers', 'launch-timeout-stamp.ts'),
  path.join(
    developRoot,
    '..',
    'extension',
    'browsers',
    'browsers-lib',
    'ready-stamp.ts'
  )
]

function fieldsTheLaunchersStamp(): string[] {
  const fields = new Set<string>()

  for (const file of launcherStampSources) {
    const source = fs.readFileSync(file, 'utf8')

    for (const m of source.matchAll(/\bready\.([A-Za-z]+) =/g)) {
      fields.add(m[1])
    }

    // The pid stamps write through a key typed as a union of literal names.
    for (const m of source.matchAll(/Key: ((?:'[A-Za-z]+'(?: \| )?)+)/g)) {
      for (const name of m[1].matchAll(/'([A-Za-z]+)'/g)) fields.add(name[1])
    }
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

  const writer = createPlaywrightMetadataWriter({
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

  it('holds every field of the type the writer declares for itself', () => {
    expect(writerTypeFits).toBe(true)
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

    expect(fieldsOfReadyContract('required')).toEqual(
      Object.keys(first.read()).sort()
    )
  })
})
