import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {AddScripts} from '../steps/add-scripts'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../contracts'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-add-scripts-'))
  tempDirs.push(dir)
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"fixture"}\n',
    'utf8'
  )
  return dir
}

function createCompiler(context: string) {
  return {
    options: {
      context,
      entry: {}
    },
    hooks: {
      thisCompilation: {
        tap() {}
      }
    },
    rspack: {
      WebpackError: Error
    }
  }
}

describe('AddScripts', () => {
  it('uses a sequential entry module for multi-file content script groups', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    fs.mkdirSync(path.join(manifestDir, 'content'), {recursive: true})
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/one.ts', 'content/two.ts']
          }
        ]
      }),
      'utf8'
    )

    const onePath = path.join(manifestDir, 'content', 'one.ts')
    const twoPath = path.join(manifestDir, 'content', 'two.ts')
    const cssPath = path.join(manifestDir, 'content', 'styles.css')
    fs.writeFileSync(onePath, 'export default 1\n', 'utf8')
    fs.writeFileSync(twoPath, 'export default 2\n', 'utf8')
    fs.writeFileSync(cssPath, '.content { color: red; }\n', 'utf8')

    const compiler = createCompiler(projectDir)

    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {
        'content_scripts/content-0': [onePath, twoPath, cssPath]
      }
    } as any).apply(compiler as any)

    const entry = (compiler.options.entry as any)['content_scripts/content-0']
    expect(entry.layer).toBe(EXTENSIONJS_CONTENT_SCRIPT_LAYER)
    expect(entry.import).toHaveLength(1)

    const sequentialSource = decodeURIComponent(
      String(entry.import[0]).replace('data:text/javascript;charset=utf-8,', '')
    )
    expect(sequentialSource).toContain(JSON.stringify(onePath))
    expect(sequentialSource).toContain(JSON.stringify(twoPath))
    expect(sequentialSource).toContain(JSON.stringify(cssPath))
    expect(sequentialSource.indexOf(JSON.stringify(onePath))).toBeLessThan(
      sequentialSource.indexOf(JSON.stringify(twoPath))
    )
  })

  it('assigns the content-script layer to scripts folder entries without rewriting them', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const scriptsDir = path.join(projectDir, 'scripts')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.mkdirSync(scriptsDir, {recursive: true})
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({manifest_version: 3}),
      'utf8'
    )

    const scriptPath = path.join(scriptsDir, 'standalone.ts')
    fs.writeFileSync(scriptPath, 'export default function run() {}\n', 'utf8')

    const compiler = createCompiler(projectDir)

    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {
        'scripts/standalone': scriptPath
      }
    } as any).apply(compiler as any)

    expect((compiler.options.entry as any)['scripts/standalone']).toEqual({
      import: [scriptPath],
      layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER
    })
  })
})
