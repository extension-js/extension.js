import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {CssPlugin} from '../index'

const tempDirs: string[] = []

afterEach(() => {
  delete process.env.EXTENSION_STRICT_REFS
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-dead-url-'))
  tempDirs.push(dir)
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}', 'utf8')
  return dir
}

function armPlugin(projectDir: string) {
  const warnings: any[] = []
  let beforeResolve: ((data: any) => false | void) | null = null
  let onCompilation: ((c: any) => void) | null = null

  const compiler: any = {
    options: {context: projectDir, mode: 'production'},
    hooks: {
      thisCompilation: {tap: (_: any, fn: any) => (onCompilation = fn)},
      normalModuleFactory: {
        tap: (_: any, fn: any) =>
          fn({
            hooks: {
              beforeResolve: {tap: (__: any, cb: any) => (beforeResolve = cb)}
            }
          })
      },
      beforeRun: {tapPromise: () => {}},
      watchRun: {tapPromise: () => {}}
    }
  }

  void new CssPlugin({
    manifestPath: path.join(projectDir, 'manifest.json')
  } as any).apply(compiler)

  onCompilation!({warnings})
  return {resolve: beforeResolve!, warnings}
}

describe('CssPlugin dead url() tolerance (§23: Chrome silently 404s them)', () => {
  it('cancels a root-absolute url() with no file anywhere and warns once', () => {
    const dir = createProject()
    const issuer = path.join(dir, 'cs.css')
    const {resolve, warnings} = armPlugin(dir)

    const data = {
      request: '/img/missing.png',
      context: dir,
      contextInfo: {issuer}
    }
    expect(resolve(data)).toBe(false)
    expect(resolve(data)).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0].message)).toContain('NOT FOUND')
  })

  it('leaves resolvable refs and non-CSS issuers alone', () => {
    const dir = createProject()
    fs.mkdirSync(path.join(dir, 'img'))
    fs.writeFileSync(path.join(dir, 'img', 'real.png'), 'x')
    const issuer = path.join(dir, 'cs.css')
    const {resolve, warnings} = armPlugin(dir)

    expect(
      resolve({request: '/img/real.png', context: dir, contextInfo: {issuer}})
    ).toBeUndefined()
    expect(
      resolve({
        request: '/img/missing.png',
        context: dir,
        contextInfo: {issuer: path.join(dir, 'index.js')}
      })
    ).toBeUndefined()
    expect(
      resolve({
        request: 'some-pkg/styles.css',
        context: dir,
        contextInfo: {issuer}
      })
    ).toBeUndefined()
    expect(warnings).toHaveLength(0)
  })

  it('keeps the fatal under EXTENSION_STRICT_REFS=true', () => {
    process.env.EXTENSION_STRICT_REFS = 'true'
    const dir = createProject()
    const issuer = path.join(dir, 'cs.css')
    const {resolve, warnings} = armPlugin(dir)

    expect(
      resolve({
        request: '/img/missing.png',
        context: dir,
        contextInfo: {issuer}
      })
    ).toBeUndefined()
    expect(warnings).toHaveLength(0)
  })
})
