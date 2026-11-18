import fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {installManifestDiskWriteGuard} from '../index'
import {buildRestartBundle} from '../session-restart-handler'

const roots: string[] = []
const compilers: Compiler[] = []

function compilerIn(root: string) {
  const compiler = rspack({
    mode: 'development',
    context: root,
    entry: {background: path.join(root, 'index.js')},
    output: {path: path.join(root, 'dist', 'chrome')},
    stats: 'none',
    infrastructureLogging: {level: 'none'}
  })
  compilers.push(compiler)

  return compiler
}

afterEach(async () => {
  for (const compiler of compilers.splice(0)) {
    await new Promise<void>((resolve) => compiler.close(() => resolve()))
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

// The session's own bookkeeping, driven as the dev server drives it.
function sessionState(serving: Compiler) {
  let active: Compiler | null = serving
  let unfinished: (() => void) | null = null

  return {
    active: () => active,
    setActive: (compiler: Compiler | null) => {
      active = compiler
    },
    setUnfinished: (release: (() => void) | null) => {
      unfinished = release
    },
    takeUnfinishedRelease: () => {
      const release = unfinished
      unfinished = null

      return release
    }
  }
}

describe('building the next bundle of a restart', () => {
  it('puts the session back when the build throws after the compiler exists', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-restart-bundle-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'index.js'), 'export const a = 1\n')
    const manifestPath = path.join(root, 'dist', 'chrome', 'manifest.json')
    fs.mkdirSync(path.dirname(manifestPath), {recursive: true})

    const serving = compilerIn(root)
    const releaseServingGuard = installManifestDiskWriteGuard(manifestPath)
    const state = sessionState(serving)
    let abandoned: Compiler | undefined
    let closed = 0

    try {
      await expect(
        buildRestartBundle({
          build: async () => {
            abandoned = compilerIn(root)
            const close = abandoned.close.bind(abandoned)
            vi.spyOn(abandoned, 'close').mockImplementation((callback) => {
              closed++
              close(callback)
            })

            state.setActive(abandoned)
            state.setUnfinished(installManifestDiskWriteGuard(manifestPath))

            throw new Error('a plugin threw while the server was wired')
          },
          activeCompiler: state.active,
          setActiveCompiler: state.setActive,
          takeUnfinishedRelease: state.takeUnfinishedRelease
        })
      ).rejects.toThrow('a plugin threw while the server was wired')

      expect(abandoned).toBeDefined()
      expect(state.active()).toBe(serving)
      expect(closed).toBe(1)
      expect(state.takeUnfinishedRelease()).toBeNull()

      // The serving bundle still guards the manifest.
      fs.writeFileSync(manifestPath, '{"guarded": true}')
      expect(fs.existsSync(manifestPath)).toBe(false)
    } finally {
      releaseServingGuard()
    }

    // One release was owed per install: the guard is gone with the last one.
    fs.writeFileSync(manifestPath, '{"guarded": false}')
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe('{"guarded": false}')
  })

  it('hands back the bundle and keeps its compiler when the build succeeds', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-restart-bundle-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'index.js'), 'export const a = 1\n')
    const serving = compilerIn(root)
    const next = compilerIn(root)
    const state = sessionState(serving)

    const bundle = await buildRestartBundle({
      build: async () => {
        state.setActive(next)

        return {compiler: next}
      },
      activeCompiler: state.active,
      setActiveCompiler: state.setActive,
      takeUnfinishedRelease: state.takeUnfinishedRelease
    })

    expect(bundle.compiler).toBe(next)
    expect(state.active()).toBe(next)
  })
})
