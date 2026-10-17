import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {buildBridgeProducerSource} from '../producer-runtime'
import {
  controlledBuildDir,
  type ProductionControlSession,
  startProductionControl
} from '../production-control'
import {readControlToken} from '../session-token'

let tmpDir: string | undefined
let session: ProductionControlSession | undefined

afterEach(async () => {
  await session?.close()
  session = undefined

  if (tmpDir) fs.rmSync(tmpDir, {recursive: true, force: true})

  tmpDir = undefined
})

const WORKER = 'console.log("production worker")\n'

function makeProject(): {projectDir: string; distPath: string} {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-production-control-'))
  const distPath = path.join(tmpDir, 'dist', 'chrome')
  fs.mkdirSync(path.join(distPath, 'background'), {recursive: true})
  fs.writeFileSync(
    path.join(distPath, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      background: {service_worker: 'background/service_worker.js'}
    })
  )

  fs.writeFileSync(
    path.join(distPath, 'background', 'service_worker.js'),
    WORKER
  )

  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}')

  return {projectDir: tmpDir, distPath}
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.once('error', () => resolve(false))
  })
}

describe('startProductionControl', () => {
  it('loads a copy of the production build that carries the producer and leaves dist/ untouched', async () => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    expect(session.controlledPath).toBe(
      controlledBuildDir(projectDir, 'chrome')
    )

    expect(path.resolve(session.controlledPath)).not.toBe(
      path.resolve(distPath)
    )

    const shipped = fs.readFileSync(
      path.join(distPath, 'background', 'service_worker.js'),
      'utf-8'
    )
    expect(shipped).toBe(WORKER)
    expect(
      fs.existsSync(path.join(distPath, 'extension-js-control.json'))
    ).toBe(false)

    const controlled = fs.readFileSync(
      path.join(session.controlledPath, 'background', 'service_worker.js'),
      'utf-8'
    )
    expect(controlled).toContain('__extjsBridgeProducerInstalled')
    expect(controlled).toContain(String(session.controlPort))
    expect(controlled).toContain(session.instanceId)
    expect(controlled.endsWith(WORKER)).toBe(true)

    const asset = JSON.parse(
      fs.readFileSync(
        path.join(session.controlledPath, 'extension-js-control.json'),
        'utf-8'
      )
    )
    expect(asset).toEqual({
      port: session.controlPort,
      instanceId: session.instanceId
    })

    expect(
      fs.existsSync(path.join(session.controlledPath, 'manifest.json'))
    ).toBe(true)
  })

  it('listens on the control port until closed', async () => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    expect(session.controlPort).toBeGreaterThan(0)
    expect(await canConnect(session.controlPort)).toBe(true)

    const port = session.controlPort
    await session.close()
    session = undefined
    expect(await canConnect(port)).toBe(false)
  })

  it('writes the eval token only with allowEval and clears it on close', async () => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    expect(readControlToken(projectDir, 'chrome')).toBeNull()
    await session.close()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowEval: true
    })

    expect(readControlToken(projectDir, 'chrome')).toEqual(expect.any(String))

    await session.close()
    session = undefined
    expect(readControlToken(projectDir, 'chrome')).toBeNull()
  })

  it('rebuilds the copy on every start so a stale producer never survives', async () => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    const first = session.instanceId
    fs.writeFileSync(path.join(session.controlledPath, 'stale.txt'), 'x')
    await session.close()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    expect(session.instanceId).not.toBe(first)
    expect(fs.existsSync(path.join(session.controlledPath, 'stale.txt'))).toBe(
      false
    )

    const controlled = fs.readFileSync(
      path.join(session.controlledPath, 'background', 'service_worker.js'),
      'utf-8'
    )
    expect(controlled).not.toContain(first)
    const perProducer = buildBridgeProducerSource({
      controlPort: session.controlPort,
      instanceId: session.instanceId
    }).split('__extjsBridgeProducerInstalled').length
    expect(controlled.split('__extjsBridgeProducerInstalled').length).toBe(
      perProducer
    )
  })
})
