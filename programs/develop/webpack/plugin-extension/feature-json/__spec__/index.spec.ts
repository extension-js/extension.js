import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {rspack, Configuration} from '@rspack/core'
import {JsonPlugin} from '../index'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const assertFileIsEmitted = async (filePath: string) => {
  const fileIsEmitted = await fs.promises.access(filePath, fs.constants.F_OK)
  return expect(fileIsEmitted).toBeUndefined()
}

export const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.promises.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

describe('JsonPlugin', () => {
  describe('declarative_net_request ruleset emission', () => {
    const tmpRoot = path.join(os.tmpdir(), 'extjs-json-dnr-')
    let projectDir = ''
    let outputPath = ''

    beforeAll(async () => {
      projectDir = await fs.promises.mkdtemp(tmpRoot)

      // project structure
      const dnrDir = path.join(projectDir, 'declarative_net_request')
      const publicDir = path.join(projectDir, 'public')
      await fs.promises.mkdir(dnrDir, {recursive: true})
      await fs.promises.mkdir(publicDir, {recursive: true})

      // files
      await fs.promises.writeFile(
        path.join(dnrDir, 'ruleset_1.json'),
        JSON.stringify([]),
        'utf8'
      )
      await fs.promises.writeFile(
        path.join(publicDir, 'public_ruleset.json'),
        JSON.stringify({ignored: true}),
        'utf8'
      )

      // manifest.json
      const manifest = {
        name: 'JsonPlugin DNR Test',
        version: '0.0.0',
        manifest_version: 3,
        declarative_net_request: {
          rule_resources: [
            {
              id: 'ruleset_1',
              enabled: true,
              path: 'declarative_net_request/ruleset_1.json'
            }
          ]
        }
      }
      await fs.promises.writeFile(
        path.join(projectDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      )

      // package.json (needed so build can resolve nearest package)
      await fs.promises.writeFile(
        path.join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'jsonplugin-dnr-test',
          version: '0.0.0',
          private: true
        }),
        'utf8'
      )

      await extensionBuild(projectDir, {browser: 'chrome', silent: true})
      outputPath = path.resolve(projectDir, 'dist', 'chrome')
    })

    afterAll(async () => {
      if (projectDir && fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, {recursive: true, force: true})
      }
    })

    it('emits ruleset JSON to output', async () => {
      const rulesetJson = path.join(
        outputPath,
        'declarative_net_request',
        'ruleset_1.json'
      )
      await assertFileIsEmitted(rulesetJson)
    })

    it('does not emit JSON from the public folder (excluded)', async () => {
      const publicRulesetJson = path.join(
        outputPath,
        'public',
        'public_ruleset.json'
      )
      await assertFileIsNotEmitted(publicRulesetJson)
    })
  })

  describe('storage.managed_schema emission', () => {
    const tmpRoot = path.join(os.tmpdir(), 'extjs-json-storage-')
    let projectDir = ''
    let outputPath = ''

    beforeAll(async () => {
      projectDir = await fs.promises.mkdtemp(tmpRoot)

      const storageDir = path.join(projectDir, 'storage')
      await fs.promises.mkdir(storageDir, {recursive: true})

      await fs.promises.writeFile(
        path.join(storageDir, 'managed_schema.json'),
        JSON.stringify({title: 'schema'}),
        'utf8'
      )

      const manifest = {
        name: 'JsonPlugin Storage Test',
        version: '0.0.0',
        manifest_version: 3,
        storage: {
          managed_schema: 'storage/managed_schema.json'
        }
      }
      await fs.promises.writeFile(
        path.join(projectDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      )

      await fs.promises.writeFile(
        path.join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'jsonplugin-storage-test',
          version: '0.0.0',
          private: true
        }),
        'utf8'
      )

      await extensionBuild(projectDir, {browser: 'chrome', silent: true})
      outputPath = path.resolve(projectDir, 'dist', 'chrome')
    })

    afterAll(async () => {
      if (projectDir && fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, {recursive: true, force: true})
      }
    })

    it('emits managed_schema JSON to output', async () => {
      const emitted = path.join(outputPath, 'storage', 'managed_schema.json')
      await assertFileIsEmitted(emitted)
    })
  })

  describe('exclusion when manifest references public path', () => {
    const tmpRoot = path.join(os.tmpdir(), 'extjs-json-exclude-')
    let projectDir = ''
    let outputPath = ''

    beforeAll(async () => {
      projectDir = await fs.promises.mkdtemp(tmpRoot)

      const publicDir = path.join(projectDir, 'public')
      await fs.promises.mkdir(publicDir, {recursive: true})

      // Put a JSON inside public and reference it in the manifest
      const publicJsonPath = path.join(publicDir, 'ruleset_public.json')
      await fs.promises.writeFile(
        publicJsonPath,
        JSON.stringify({a: 1}),
        'utf8'
      )

      const manifest = {
        name: 'JsonPlugin Exclude Test',
        version: '0.0.0',
        manifest_version: 3,
        declarative_net_request: {
          rule_resources: [
            {
              id: 'ruleset_public',
              enabled: true,
              path: 'public/ruleset_public.json'
            }
          ]
        }
      }

      await fs.promises.writeFile(
        path.join(projectDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      )

      await fs.promises.writeFile(
        path.join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'jsonplugin-exclude-test',
          version: '0.0.0',
          private: true
        }),
        'utf8'
      )

      await extensionBuild(projectDir, {browser: 'chrome', silent: true})
      outputPath = path.resolve(projectDir, 'dist', 'chrome')
    })

    afterAll(async () => {
      if (projectDir && fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, {recursive: true, force: true})
      }
    })

    it('does not emit JSON that lives under public/', async () => {
      const emitted = path.join(
        outputPath,
        'declarative_net_request',
        'ruleset_public.json'
      )
      await assertFileIsNotEmitted(emitted)
    })
  })

  describe('multiple rule_resources emission', () => {
    const tmpRoot = path.join(os.tmpdir(), 'extjs-json-multi-')
    let projectDir = ''
    let outputPath = ''

    beforeAll(async () => {
      projectDir = await fs.promises.mkdtemp(tmpRoot)

      const dnrDir = path.join(projectDir, 'declarative_net_request')
      await fs.promises.mkdir(dnrDir, {recursive: true})

      await fs.promises.writeFile(
        path.join(dnrDir, 'ruleset_1.json'),
        JSON.stringify([{a: 1}]),
        'utf8'
      )
      await fs.promises.writeFile(
        path.join(dnrDir, 'ruleset_2.json'),
        JSON.stringify([{b: 2}]),
        'utf8'
      )

      const manifest = {
        name: 'JsonPlugin Multi Rules Test',
        version: '0.0.0',
        manifest_version: 3,
        declarative_net_request: {
          rule_resources: [
            {
              id: 'ruleset_1',
              enabled: true,
              path: 'declarative_net_request/ruleset_1.json'
            },
            {
              id: 'ruleset_2',
              enabled: true,
              path: 'declarative_net_request/ruleset_2.json'
            }
          ]
        }
      }

      await fs.promises.writeFile(
        path.join(projectDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      )

      await fs.promises.writeFile(
        path.join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'jsonplugin-multi-test',
          version: '0.0.0',
          private: true
        }),
        'utf8'
      )

      await extensionBuild(projectDir, {browser: 'chrome', silent: true})
      outputPath = path.resolve(projectDir, 'dist', 'chrome')
    })

    afterAll(async () => {
      if (projectDir && fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, {recursive: true, force: true})
      }
    })

    it('emits all declared rulesets', async () => {
      await assertFileIsEmitted(
        path.join(outputPath, 'declarative_net_request', 'ruleset_1.json')
      )
      await assertFileIsEmitted(
        path.join(outputPath, 'declarative_net_request', 'ruleset_2.json')
      )
    })
  })

  describe('direct JsonPlugin invocation (array handling and warnings)', () => {
    const tmpRoot = path.join(os.tmpdir(), 'extjs-json-direct-')
    let projectDir = ''
    let outputPath = ''

    beforeAll(async () => {
      projectDir = await fs.promises.mkdtemp(tmpRoot)
      outputPath = path.join(projectDir, 'dist')

      // Prepare JSON files used by plugin includeList
      const dataDir = path.join(projectDir, 'data')
      await fs.promises.mkdir(dataDir, {recursive: true})
      const aPath = path.join(dataDir, 'a.json')
      const b1Path = path.join(dataDir, 'b1.json')
      const b2Path = path.join(dataDir, 'b2.json')
      await fs.promises.writeFile(aPath, JSON.stringify({a: true}), 'utf8')
      await fs.promises.writeFile(b1Path, JSON.stringify({b: 1}), 'utf8')
      await fs.promises.writeFile(b2Path, JSON.stringify({b: 2}), 'utf8')

      // minimal entry to satisfy rspack
      const srcDir = path.join(projectDir, 'src')
      await fs.promises.mkdir(srcDir, {recursive: true})
      const entryJs = path.join(srcDir, 'index.js')
      await fs.promises.writeFile(entryJs, 'console.log("ok")', 'utf8')

      const config: Configuration = {
        mode: 'production',
        entry: {main: entryJs},
        output: {path: outputPath, clean: true},
        plugins: [
          new JsonPlugin({
            manifestPath: path.join(projectDir, 'manifest.json'),
            includeList: {
              'features/a': aPath,
              'features/b': [b1Path, b2Path],
              'features/missing': path.join(projectDir, 'nope.json')
            },
            excludeList: {}
          })
        ]
      }

      await new Promise<void>((resolve, reject) => {
        const compiler = rspack(config)
        compiler.run((err, stats) => {
          if (err) return reject(err)
          if (stats?.hasErrors()) return reject(new Error('Compilation failed'))
          resolve()
        })
      })
    })

    afterAll(async () => {
      if (projectDir && fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, {recursive: true, force: true})
      }
    })

    it('emits single and array resources (array uses last file content)', async () => {
      const aOut = path.join(outputPath, 'features', 'a.json')
      const bOut = path.join(outputPath, 'features', 'b.json')
      await assertFileIsEmitted(aOut)
      await assertFileIsEmitted(bOut)
      const data = await fs.promises.readFile(bOut, 'utf8')
      expect(JSON.parse(data)).toEqual({b: 2})
    })

    it('skips missing file and does not emit it', async () => {
      const missingOut = path.join(outputPath, 'features', 'missing.json')
      await assertFileIsNotEmitted(missingOut)
    })
  })
})
