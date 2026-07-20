import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  findNearestDenoConfigSync,
  findNearestProjectManifestDirSync,
  findNearestProjectManifestSync,
  hasProjectDependency,
  parseJsoncSafe,
  parseNpmSpecifier,
  readDenoConfigDependencies,
  readProjectDependencies,
  stripJsoncExtensions
} from '../project-manifest'

const created: string[] = []

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {}
  }
  created.length = 0
})

describe('parseJsoncSafe', () => {
  it('parses line comments, block comments, and trailing commas', () => {
    const source = `{
      // Deno configuration for this project.
      "nodeModulesDir": "auto", /* inline note */
      "tasks": {
        "dev": "extension dev",
      },
    }`
    expect(parseJsoncSafe(source)).toEqual({
      nodeModulesDir: 'auto',
      tasks: {dev: 'extension dev'}
    })
  })

  it('preserves comment-looking and comma-containing string contents', () => {
    const source = `{
      "url": "https://example.com/path", // real comment
      "note": "a, }",
      "glob": "/* not a comment */"
    }`
    expect(parseJsoncSafe(source)).toEqual({
      url: 'https://example.com/path',
      note: 'a, }',
      glob: '/* not a comment */'
    })
  })

  it('handles escaped quotes inside strings', () => {
    expect(parseJsoncSafe('{"a": "say \\"hi\\" // ok",}')).toEqual({
      a: 'say "hi" // ok'
    })
  })

  it('parses empty input as an empty object', () => {
    expect(parseJsoncSafe('')).toEqual({})
    expect(parseJsoncSafe('// only a comment')).toEqual({})
  })

  it('still throws on invalid syntax', () => {
    expect(() => parseJsoncSafe('{"a": }')).toThrow()
  })

  it('strips a UTF-8 BOM', () => {
    expect(parseJsoncSafe('﻿{"a": 1}')).toEqual({a: 1})
  })
})

describe('stripJsoncExtensions', () => {
  it('drops trailing commas before ] as well as }', () => {
    expect(JSON.parse(stripJsoncExtensions('[1, 2, /* x */ 3,]'))).toEqual([
      1, 2, 3
    ])
  })
})

describe('parseNpmSpecifier', () => {
  it('parses plain, scoped, versionless, and path forms', () => {
    expect(parseNpmSpecifier('npm:react@^18.3.1')).toEqual({
      name: 'react',
      version: '^18.3.1'
    })
    expect(parseNpmSpecifier('npm:@angular/core@17.0.0')).toEqual({
      name: '@angular/core',
      version: '17.0.0'
    })
    expect(parseNpmSpecifier('npm:react')).toEqual({
      name: 'react',
      version: '*'
    })
    expect(parseNpmSpecifier('npm:/preact@10.19.3/hooks')).toEqual({
      name: 'preact',
      version: '10.19.3'
    })
    expect(parseNpmSpecifier('npm:@scope/pkg')).toEqual({
      name: '@scope/pkg',
      version: '*'
    })
  })

  it('rejects non-npm specifiers', () => {
    expect(parseNpmSpecifier('jsr:@std/path')).toBeUndefined()
    expect(parseNpmSpecifier('./local.ts')).toBeUndefined()
    expect(parseNpmSpecifier(42)).toBeUndefined()
    expect(parseNpmSpecifier('npm:')).toBeUndefined()
  })
})

describe('readDenoConfigDependencies', () => {
  it('reads npm: imports, registering package names and aliases', () => {
    const dir = makeTempDir('extjs-deno-deps-')
    fs.writeFileSync(
      path.join(dir, 'deno.jsonc'),
      `{
        // npm dependencies live in the imports map
        "imports": {
          "react": "npm:react@^18.3.1",
          "react-dom/": "npm:react-dom@^18.3.1/",
          "my-utils": "npm:lodash@^4.17.21",
          "@std/path": "jsr:@std/path@^1.0.0",
          "local": "./src/local.ts",
        },
      }`
    )

    const deps = readDenoConfigDependencies(path.join(dir, 'deno.jsonc'))
    expect(deps.react).toBe('^18.3.1')
    expect(deps['react-dom']).toBe('^18.3.1')
    expect(deps.lodash).toBe('^4.17.21')
    expect(deps['my-utils']).toBe('^4.17.21')
    expect(deps['@std/path']).toBeUndefined()
    expect(deps.local).toBeUndefined()
  })
})

describe('readProjectDependencies / hasProjectDependency', () => {
  it('merges package.json fields with deno.json(c) npm: imports', () => {
    const dir = makeTempDir('extjs-merged-deps-')
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: {vue: '^3.4.0'},
        devDependencies: {typescript: '5.3.3'}
      })
    )
    fs.writeFileSync(
      path.join(dir, 'deno.jsonc'),
      `{"imports": {"react": "npm:react@^18.3.1", "vue": "npm:vue@^2.0.0"}}`
    )

    const deps = readProjectDependencies(dir)
    expect(deps.react).toBe('^18.3.1')
    expect(deps.typescript).toBe('5.3.3')
    expect(deps.vue).toBe('^3.4.0')

    expect(hasProjectDependency(dir, 'react')).toBe(true)
    expect(hasProjectDependency(dir, 'svelte')).toBe(false)
  })

  it('detects dependencies in a deno.jsonc-only project (no package.json)', () => {
    const dir = makeTempDir('extjs-deno-only-')
    fs.writeFileSync(
      path.join(dir, 'deno.jsonc'),
      `{
        "nodeModulesDir": "auto",
        "imports": {
          "extension": "npm:extension@^4.0.0",
          "preact": "npm:preact@^10.19.3", // framework
        },
      }`
    )

    expect(hasProjectDependency(dir, 'preact')).toBe(true)
    expect(hasProjectDependency(dir, 'react')).toBe(false)
  })

  it('returns an empty map when no manifest exists', () => {
    const dir = makeTempDir('extjs-no-manifest-')
    expect(readProjectDependencies(dir)).toEqual({})
  })
})

describe('manifest find-up helpers', () => {
  it('finds a deno.jsonc-only directory as a project manifest dir', () => {
    const dir = makeTempDir('extjs-findup-')
    const nested = path.join(dir, 'src', 'content')
    fs.mkdirSync(nested, {recursive: true})
    fs.writeFileSync(path.join(dir, 'deno.jsonc'), '{}')

    expect(findNearestProjectManifestDirSync(nested, 6)).toBe(dir)
  })

  it('prefers package.json when a directory has both manifests', () => {
    const dir = makeTempDir('extjs-findup-both-')
    fs.writeFileSync(path.join(dir, 'package.json'), '{}')
    fs.writeFileSync(path.join(dir, 'deno.jsonc'), '{}')

    const found = findNearestProjectManifestSync(
      path.join(dir, 'manifest.json')
    )
    expect(found).toBe(path.join(dir, 'package.json'))
  })

  it('finds the nearest deno config walking up from the manifest', () => {
    const dir = makeTempDir('extjs-findup-deno-')
    const nested = path.join(dir, 'src')
    fs.mkdirSync(nested, {recursive: true})
    fs.writeFileSync(path.join(dir, 'deno.json'), '{}')

    expect(findNearestDenoConfigSync(path.join(nested, 'manifest.json'))).toBe(
      path.join(dir, 'deno.json')
    )
  })
})
