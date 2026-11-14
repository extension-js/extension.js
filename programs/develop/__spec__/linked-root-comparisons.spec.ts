import {type ChildProcess, spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {readyContractPath} from '../lib/session-paths'
import {resolveCompanionExtensionsConfig} from '../plugin-special-folders/folder-extensions/resolve-config'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()
const children: ChildProcess[] = []

afterAll(() => {
  for (const child of children) child.kill('SIGKILL')
})

function linkedProject(): {real: string; linked: string} | undefined {
  const base = fs.realpathSync(makeTempFolder('extjs-linked-compare-'))
  const real = path.join(base, 'real-project')
  const linked = path.join(base, 'linked-project')

  fs.mkdirSync(real)
  fs.writeFileSync(
    path.join(real, 'package.json'),
    JSON.stringify({private: true, name: 'linked-compare', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(real, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'linked-compare',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(real, 'background.js'), 'console.log(1)\n')

  try {
    fs.symlinkSync(real, linked, 'dir')
  } catch {
    return undefined
  }

  return {real, linked}
}

const canLink = Boolean(linkedProject())

function companion(root: string, name: string): string {
  const dir = path.join(root, 'extensions', name)

  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name, version: '0.0.0'})
  )

  return dir
}

describe.skipIf(!canLink)(
  'a project named by a linked path and a real one',
  () => {
    it('takes a companion named by the other spelling of the project', async () => {
      const {real, linked} = linkedProject() as {real: string; linked: string}
      const byReal = companion(real, 'by-real')
      const byLinked = path.join(linked, 'extensions', 'by-linked')

      companion(real, 'by-linked')

      await expect(
        resolveCompanionExtensionsConfig({
          projectRoot: linked,
          browser: 'chrome',
          config: {paths: [byReal]}
        })
      ).resolves.toEqual(expect.objectContaining({paths: [byReal]}))

      await expect(
        resolveCompanionExtensionsConfig({
          projectRoot: real,
          browser: 'chrome',
          config: {paths: [byLinked]}
        })
      ).resolves.toEqual(expect.objectContaining({paths: [byLinked]}))
    })

    it('still refuses a companion outside the project under either spelling', async () => {
      const {real, linked} = linkedProject() as {real: string; linked: string}
      const outside = path.join(path.dirname(real), 'elsewhere')

      fs.mkdirSync(outside)

      await expect(
        resolveCompanionExtensionsConfig({
          projectRoot: linked,
          browser: 'chrome',
          config: {paths: [outside]}
        })
      ).rejects.toThrow(/Companion extensions must be inside/)
    })

    it.each([
      ['the session by its real path, the build by the linked one', true],
      ['the session by the linked path, the build by its real one', false]
    ])(
      'refuses to build over a live dev session dist: %s',
      async (_label, sessionIsReal) => {
        const {real, linked} = linkedProject() as {real: string; linked: string}
        const sessionRoot = sessionIsReal ? real : linked
        const buildRoot = sessionIsReal ? linked : real
        const child = spawn(
          process.execPath,
          ['-e', 'setInterval(() => {}, 1000)'],
          {stdio: 'ignore'}
        )

        children.push(child)

        const contractPath = readyContractPath(sessionRoot, 'chrome')

        fs.mkdirSync(path.dirname(contractPath), {recursive: true})
        fs.writeFileSync(
          contractPath,
          JSON.stringify({
            schemaVersion: 2,
            schema: 1,
            status: 'ready',
            command: 'dev',
            browser: 'chrome',
            runId: 'dev-run',
            distPath: path.join(sessionRoot, 'dist', 'chrome'),
            pid: child.pid
          })
        )

        const distDir = path.join(real, 'dist', 'chrome')

        fs.mkdirSync(distDir, {recursive: true})
        fs.writeFileSync(path.join(distDir, 'manifest.json'), '{"dev":true}')

        const {extensionBuild} = await import('../command-build')
        const previous = process.env.VITEST

        process.env.VITEST = 'true'

        let error: (Error & {code?: string}) | undefined

        try {
          await extensionBuild(buildRoot, {
            browser: 'chrome',
            silent: true,
            install: false,
            mode: 'production',
            exitOnError: false
          } as never)
        } catch (caught) {
          error = caught as Error & {code?: string}
        } finally {
          if (previous === undefined) delete process.env.VITEST
          else process.env.VITEST = previous
        }

        expect(error?.code).toBe('E_DEV_SESSION_DIST_SHARED')
        expect(
          fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf-8')
        ).toBe('{"dev":true}')
      },
      120000
    )
  }
)
