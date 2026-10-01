import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import {eventsPath, readyContractPath} from '../../lib/session-paths'
import webpackConfig from '../../rspack-config'

const roots: string[] = []

function scaffold() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-restart-ready-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'restart-ready', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'restart-ready',
      version: '0.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<!doctype html><html><body><script src="./popup.js"></script></body></html>'
  )

  fs.writeFileSync(path.join(root, 'popup.js'), "console.log('x')\n")

  return root
}

async function makeCompiler(root: string) {
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'chrome')}
  } as never)
  config.plugins = (config.plugins || []).filter(
    (plugin: {constructor: {name: string}} | undefined) =>
      plugin?.constructor.name !== 'plugin-browsers'
  )

  config.stats = false

  return rspack(config as never)
}

function watchUntilDone(compiler: ReturnType<typeof rspack>) {
  return new Promise<ReturnType<typeof compiler.watch>>((resolve) => {
    const watching = compiler.watch({}, () => resolve(watching))
  })
}

function closeWatch(watching: {close: (callback: () => void) => void}) {
  return new Promise<void>((resolve) => watching.close(() => resolve()))
}

function readReady(root: string) {
  return JSON.parse(
    fs.readFileSync(readyContractPath(root, 'chrome'), 'utf-8')
  ) as Record<string, unknown>
}

function readEvents(root: string) {
  return fs
    .readFileSync(eventsPath(root, 'chrome'), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

describe('the ready contract across an entrypoint-change restart', () => {
  it('never reads stopped while the session is alive and keeps the timeline', async () => {
    const root = scaffold()

    const compilerA = await makeCompiler(root)
    const watchingA = await watchUntilDone(compilerA)

    const before = readReady(root)
    expect(before.status).toBe('ready')
    const eventsBefore = readEvents(root)
    expect(eventsBefore.map((event) => event.type)).toEqual([
      'compile_start',
      'compile_success'
    ])

    const compilerB = await makeCompiler(root)

    const afterB = readReady(root)
    expect(afterB.status).toBe('starting')
    expect(afterB.runId).toBe(before.runId)
    expect(afterB.startedAt).toBe(before.startedAt)
    expect(readEvents(root)).toEqual(eventsBefore)

    await closeWatch(watchingA)

    const duringRestart = readReady(root)
    expect(duringRestart.runId).toBe(before.runId)
    expect(duringRestart.status).toBe('starting')
    expect(duringRestart.code).toBeUndefined()
    expect(readEvents(root)).toEqual(eventsBefore)

    const watchingB = await watchUntilDone(compilerB)

    const afterRestart = readReady(root)
    expect(afterRestart.status).toBe('ready')
    expect(afterRestart.runId).toBe(before.runId)
    expect(afterRestart.startedAt).toBe(before.startedAt)

    const eventsAfter = readEvents(root)
    expect(eventsAfter.slice(0, eventsBefore.length)).toEqual(eventsBefore)
    expect(eventsAfter.slice(eventsBefore.length).map((e) => e.type)).toEqual([
      'compile_start',
      'compile_success'
    ])

    expect(eventsAfter.every((event) => event.runId === before.runId)).toBe(
      true
    )

    await closeWatch(watchingB)

    const ended = readReady(root)
    expect(ended.status).toBe('stopped')
    expect(ended.code).toBe('shutdown')
    expect(readEvents(root).at(-1)?.type).toBe('shutdown')
  }, 120_000)
})
