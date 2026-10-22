import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {resolveUserDeclaredWAR} from '../web-resources-lib/resolve-war'

const created: string[] = []

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

function project(files: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'war-glob-'))
  )
  created.push(root)

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

function resolveWith(root: string, resources: string[]) {
  const emitted = new Map<string, string>()
  const compilation = {
    options: {
      mode: 'production',
      context: root,
      output: {path: path.join(root, 'dist')}
    },
    outputOptions: {path: path.join(root, 'dist')},
    errors: [],
    warnings: [],
    assets: {},
    getAsset: (name: string) =>
      emitted.has(name)
        ? {name, source: {source: () => emitted.get(name)}}
        : undefined,
    getAssets: () => [],
    emitAsset: (name: string, source: {source: () => unknown}) => {
      emitted.set(name, String(source.source()))
    },
    fileDependencies: new Set<string>(),
    contextDependencies: new Set<string>()
  } as unknown as Compilation

  resolveUserDeclaredWAR(
    compilation,
    path.join(root, 'manifest.json'),
    {
      manifest_version: 3,
      web_accessible_resources: [{matches: ['<all_urls>'], resources}]
    } as never,
    'chrome'
  )

  return emitted
}

describe('web_accessible_resources globs', () => {
  it('ships every file a folder glob matches, nested files included', () => {
    const root = project({
      'manifest.json': '{}',
      'data/a.txt': 'a',
      'data/b.js': 'var b = 1',
      'data/sub/c.txt': 'c',
      'other/d.txt': 'd'
    })

    const emitted = resolveWith(root, ['data/*'])

    expect([...emitted.keys()].sort()).toEqual([
      'data/a.txt',
      'data/b.js',
      'data/sub/c.txt'
    ])

    expect(emitted.get('data/sub/c.txt')).toBe('c')
  })

  it('keeps the extension filter of a glob', () => {
    const root = project({
      'manifest.json': '{}',
      'lib/x.css': 'x',
      'lib/y.js': 'y'
    })

    expect([...resolveWith(root, ['lib/*.css']).keys()]).toEqual(['lib/x.css'])
  })

  it('leaves sources the build compiles out of the copy', () => {
    const root = project({
      'manifest.json': '{}',
      'lib/helper.ts': 'export const x: number = 1',
      'lib/view.jsx': 'export default null',
      'lib/plain.js': 'var p = 1'
    })

    expect([...resolveWith(root, ['lib/*']).keys()]).toEqual(['lib/plain.js'])
  })

  it('copies nothing for a root wildcard, which names the built output', () => {
    const root = project({'manifest.json': '{}', 'notes.txt': 'n'})

    expect(resolveWith(root, ['*']).size).toBe(0)
  })
})
