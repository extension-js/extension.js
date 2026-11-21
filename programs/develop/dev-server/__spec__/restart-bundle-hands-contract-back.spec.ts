import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  holdServingContract,
  ReadyContractPlugin
} from '../../plugin-ready-contract'
import {buildRestartBundle} from '../session-restart-handler'

const tempFolder = trackTempFolders()

type Tap = (...args: unknown[]) => unknown

// A compiler as the contract plugin sees it: it applies, then builds finish.
function compilerOf(root: string) {
  const taps: Record<string, Tap[]> = {}
  const hooks = new Proxy(
    {},
    {
      get: (_target, name: string) => ({
        tap: (_tapName: unknown, run: Tap) => {
          taps[name] = [...(taps[name] || []), run]
        }
      })
    }
  )
  const compiler = {hooks, close: (done: () => void) => done()}

  new ReadyContractPlugin({
    packageJsonDir: root,
    browser: 'chrome',
    mode: 'development',
    outputPath: path.join(root, 'dist', 'chrome'),
    manifestPath: path.join(root, 'manifest.json'),
    port: 8080
  }).apply(compiler as never)

  return {
    compiler,
    finishBuild() {
      for (const run of taps.done || []) {
        run({hasErrors: () => false, compilation: {}})
      }
    }
  }
}

function contractOf(root: string) {
  const readyPath = path.join(
    root,
    'dist',
    'extension-js',
    'chrome',
    'ready.json'
  )

  return {
    readyPath,
    read: () =>
      JSON.parse(fs.readFileSync(readyPath, 'utf8')) as Record<string, unknown>
  }
}

describe('a restart whose next bundle fails after its compiler was built', () => {
  it('leaves ready.json ready and the serving compiler still writing it', async () => {
    const root = tempFolder('extjs-restart-contract-')
    const contract = contractOf(root)
    const serving = compilerOf(root)
    let active: {close: (done: () => void) => void} | null = serving.compiler

    serving.finishBuild()

    const before = contract.read()
    expect(before.status).toBe('ready')

    await expect(
      buildRestartBundle({
        holdContract: () => holdServingContract(contract.readyPath),
        build: async () => {
          active = compilerOf(root).compiler

          throw new Error('a later plugin could not apply')
        },
        activeCompiler: () => active,
        setActiveCompiler: (compiler) => {
          active = compiler
        }
      })
    ).rejects.toThrow('a later plugin could not apply')

    expect(active).toBe(serving.compiler)
    expect(contract.read()).toEqual(before)

    // The build that keeps serving answers its next compile on the contract.
    fs.writeFileSync(
      contract.readyPath,
      JSON.stringify({...before, compiledAt: '2020-01-01T00:00:00.000Z'})
    )

    serving.finishBuild()

    expect(contract.read().compiledAt).not.toBe('2020-01-01T00:00:00.000Z')
  })

  it('keeps the contract of the next compiler when its bundle is built', async () => {
    const root = tempFolder('extjs-restart-contract-')
    const contract = contractOf(root)
    const serving = compilerOf(root)
    let active: {close: (done: () => void) => void} | null = serving.compiler

    serving.finishBuild()

    const next = await buildRestartBundle({
      holdContract: () => holdServingContract(contract.readyPath),
      build: async () => {
        const built = compilerOf(root)
        active = built.compiler

        return built
      },
      activeCompiler: () => active,
      setActiveCompiler: (compiler) => {
        active = compiler
      }
    })

    expect(contract.read().status).toBe('starting')

    // The compiler that was replaced does not speak for the session.
    serving.finishBuild()
    expect(contract.read().status).toBe('starting')

    next.finishBuild()
    expect(contract.read().status).toBe('ready')
  })
})
