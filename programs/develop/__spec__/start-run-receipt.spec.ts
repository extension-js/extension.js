import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {eventsPath, readyContractPath} from '../lib/session-paths'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-start-receipt-'))
const BROWSER = 'chrome'
const COMPANION = path.join(ROOT, 'extensions', 'other')

function write(relPath: string, contents: string) {
  const abs = path.join(ROOT, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture() {
  write(
    'package.json',
    JSON.stringify(
      {private: true, name: 'extjs-start-receipt-spec', version: '0.0.0'},
      null,
      2
    )
  )
  write(
    'manifest.json',
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Start Receipt Fixture',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )
  write('popup.html', '<html><body><h1>popup</h1></body></html>\n')
  write(
    'extensions/other/manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Companion Other',
      version: '1.0.0'
    })
  )
}

function readReady() {
  return JSON.parse(fs.readFileSync(readyContractPath(ROOT, BROWSER), 'utf-8'))
}

function readEvents(): Array<Record<string, unknown>> {
  const file = eventsPath(ROOT, BROWSER)
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf-8')
  if (!raw.trim()) return []
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function managedPaths(ready: {managedExtensions?: {path?: string}[]}) {
  return (ready.managedExtensions || []).map((entry) => entry.path)
}

async function runStart(opts?: {extensions?: string[]}) {
  const previousVitest = process.env.VITEST
  const previousAuthor = process.env.EXTENSION_AUTHOR_MODE
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE

  try {
    const {extensionBuild} = await import('../command-build')
    const {extensionPreview} = await import('../command-preview')

    await extensionBuild(ROOT, {
      browser: BROWSER,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false,
      metadataCommand: 'start',
      ...(opts?.extensions ? {extensions: opts.extensions} : {extensions: []})
    } as never)

    const afterBuild = {
      ready: readReady(),
      events: readEvents()
    }

    await new Promise((resolve) => setTimeout(resolve, 40))

    await extensionPreview(
      ROOT,
      {
        mode: 'production',
        browser: BROWSER,
        metadataCommand: 'start',
        ...(opts?.extensions ? {extensions: opts.extensions} : {extensions: []})
      } as never,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    )

    return {
      afterBuild,
      afterPreview: {
        ready: readReady(),
        events: readEvents()
      }
    }
  } finally {
    if (previousAuthor === undefined) {
      delete process.env.EXTENSION_AUTHOR_MODE
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthor
    }
    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

beforeAll(() => {
  writeFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('start run receipt (real build + preview)', () => {
  it('keeps the compile timeline and the compile stamp through preview', async () => {
    const {afterBuild, afterPreview} = await runStart()

    const types = afterPreview.events.map((event) => event.type)
    expect(types).toContain('compile_start')
    expect(types).toContain('compile_success')
    expect(afterPreview.events).toEqual(afterBuild.events)

    expect(afterPreview.ready.compiledAt).toBe(afterBuild.ready.compiledAt)
    expect(afterPreview.ready.compiledAt).not.toBe(afterPreview.ready.ts)
    expect(afterPreview.ready.startedAt).toBe(afterBuild.ready.startedAt)
    expect(afterPreview.ready.command).toBe('start')
    expect(afterPreview.ready.status).toBe('ready')
    expect(afterPreview.ready.runId).toBe(afterBuild.ready.runId)
  }, 120_000)

  it('starts a fresh run with a clean timeline and drops last-run load refusal', async () => {
    const first = await runStart()
    const firstSuccess = first.afterPreview.events.find(
      (event) => event.type === 'compile_success'
    )
    expect(firstSuccess).toBeTruthy()

    const refused = readReady()
    refused.status = 'error'
    refused.code = 'extension_load_refused'
    refused.message = 'Chrome refused to load the extension'
    refused.extensionLoadRefusedAt = '2026-08-15T00:00:00.000Z'
    refused.extensionLoadRefusedReason = 'Variable $2$ used but not defined.'
    fs.writeFileSync(
      readyContractPath(ROOT, BROWSER),
      JSON.stringify(refused, null, 2)
    )

    const second = await runStart()
    const secondTypes = second.afterPreview.events.map((event) => event.type)
    expect(secondTypes).toContain('compile_start')
    expect(secondTypes).toContain('compile_success')
    expect(
      second.afterPreview.events.some(
        (event) =>
          event.ts === firstSuccess?.ts && event.type === 'compile_success'
      )
    ).toBe(false)
    expect(second.afterPreview.ready.status).toBe('ready')
    expect(second.afterPreview.ready.extensionLoadRefusedAt).toBeUndefined()
    expect(second.afterPreview.ready.code).toBeUndefined()
  }, 120_000)

  it('does not continue a start run from a stale ready file with a foreign runId', async () => {
    await runStart()

    const stale = readReady()
    stale.runId = 'stale-run-from-yesterday'
    stale.status = 'error'
    stale.code = 'extension_load_refused'
    fs.writeFileSync(
      readyContractPath(ROOT, BROWSER),
      JSON.stringify(stale, null, 2)
    )

    const {extensionPreview} = await import('../command-preview')
    await extensionPreview(
      ROOT,
      {
        mode: 'production',
        browser: BROWSER,
        metadataCommand: 'start',
        extensions: []
      } as never,
      async () => {}
    )

    const ready = readReady()
    expect(ready.runId).not.toBe('stale-run-from-yesterday')
    expect(ready.status).toBe('ready')
    expect(ready.code).toBeUndefined()
    const types = readEvents().map((event) => event.type)
    expect(types).not.toContain('compile_success')
  }, 120_000)

  it('lists companions when loaded and forgets them when the next run passes none', async () => {
    const withCompanion = await runStart({extensions: [COMPANION]})
    expect(managedPaths(withCompanion.afterPreview.ready)).toContain(
      path.resolve(COMPANION)
    )

    const cleared = await runStart({extensions: []})
    expect(managedPaths(cleared.afterPreview.ready)).not.toContain(
      path.resolve(COMPANION)
    )

    const stillClear = await runStart({extensions: []})
    expect(managedPaths(stillClear.afterPreview.ready)).not.toContain(
      path.resolve(COMPANION)
    )
  }, 180_000)
})
