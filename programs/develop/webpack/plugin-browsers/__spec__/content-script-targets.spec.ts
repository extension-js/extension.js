import {describe, expect, it} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  collectContentScriptDependencyPaths,
  getChangedContentScriptEntryNames,
  getContentScriptRulesFromManifest,
  normalizeModuleResourcePath,
  resolveEmittedContentScriptFile,
  selectContentScriptRules,
  urlMatchesAnyContentScriptRule
} from '../browsers-lib/content-script-targets'

describe('content-script targets helper', () => {
  it('matches urls against manifest content script rules', () => {
    const rules = getContentScriptRulesFromManifest({
      content_scripts: [
        {
          matches: ['https://*.example.com/*'],
          exclude_matches: ['https://admin.example.com/*']
        }
      ]
    })

    expect(
      urlMatchesAnyContentScriptRule('https://docs.example.com/page', rules)
    ).toBe(true)
    expect(
      urlMatchesAnyContentScriptRule('https://admin.example.com/page', rules)
    ).toBe(false)
    expect(urlMatchesAnyContentScriptRule('https://other.test/', rules)).toBe(
      false
    )
  })

  it('applies include and exclude globs after the base match pattern', () => {
    const rules = getContentScriptRulesFromManifest({
      content_scripts: [
        {
          matches: ['https://example.com/*'],
          include_globs: ['*allowed*'],
          exclude_globs: ['*blocked*']
        }
      ]
    })

    expect(
      urlMatchesAnyContentScriptRule('https://example.com/allowed', rules)
    ).toBe(true)
    expect(
      urlMatchesAnyContentScriptRule(
        'https://example.com/blocked-allowed',
        rules
      )
    ).toBe(false)
  })

  it('resolveEmittedContentScriptFile prefers canonical path then dev hashed name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-out-'))
    const cs = path.join(root, 'content_scripts')
    fs.mkdirSync(cs)

    const canonicalJs = path.join(cs, 'content-0.js')
    fs.writeFileSync(canonicalJs, '//')
    expect(resolveEmittedContentScriptFile(root, 0, 'js')).toBe(canonicalJs)
    fs.unlinkSync(canonicalJs)

    const hashedJs = path.join(cs, 'content-0.deadbeef.js')
    fs.writeFileSync(hashedJs, '//')
    expect(resolveEmittedContentScriptFile(root, 0, 'js')).toBe(hashedJs)

    fs.rmSync(root, {recursive: true, force: true})
  })

  it('selects only the rules that correspond to changed content entries', () => {
    const rules = getContentScriptRulesFromManifest({
      content_scripts: [
        {matches: ['https://one.example/*']},
        {matches: ['https://two.example/*']}
      ]
    })

    expect(
      selectContentScriptRules(rules, [
        'content_scripts/content-1',
        'content_scripts/content-9'
      ])
    ).toEqual([rules[1]])
  })

  it('preserves manifest world metadata for reinjection decisions', () => {
    const rules = getContentScriptRulesFromManifest({
      content_scripts: [
        {matches: ['https://one.example/*']},
        {matches: ['https://two.example/*'], world: 'MAIN'}
      ]
    })

    expect(rules[0]?.world).toBe('extension')
    expect(rules[1]?.world).toBe('main')
  })

  it('tracks nested module resources for content script dependency changes', () => {
    const contentAppPath = '/project/src/content/ContentApp.tsx'
    const compilation = {
      entrypoints: new Map([
        [
          'content_scripts/content-0',
          {
            chunks: [{}]
          }
        ]
      ]),
      chunkGraph: {
        getChunkModulesIterable: () => [
          {
            modules: [
              {resource: '/project/src/content/index.tsx'},
              {resource: contentAppPath}
            ]
          }
        ]
      }
    } as any

    const dependencyPaths = collectContentScriptDependencyPaths(compilation)

    expect(dependencyPaths.get('content_scripts/content-0')).toContain(
      contentAppPath
    )
    expect(
      getChangedContentScriptEntryNames([contentAppPath], dependencyPaths)
    ).toEqual(['content_scripts/content-0'])
  })

  it('normalizes wrapped module resource paths back to real source files', () => {
    const sourcePath = '/project/src/content/scripts.tsx'
    const compilation = {
      entrypoints: new Map([
        [
          'content_scripts/content-0',
          {
            chunks: [{}]
          }
        ]
      ]),
      chunkGraph: {
        getChunkModulesIterable: () => [
          {
            resource:
              '/virtual/loader.js!/project/src/content/scripts.tsx?__extjs_inner=1'
          }
        ]
      }
    } as any

    const dependencyPaths = collectContentScriptDependencyPaths(compilation)

    expect(dependencyPaths.get('content_scripts/content-0')).toContain(
      sourcePath
    )
    expect(
      getChangedContentScriptEntryNames([sourcePath], dependencyPaths)
    ).toEqual(['content_scripts/content-0'])
    expect(
      normalizeModuleResourcePath(
        '/virtual/loader.js!/project/src/content/scripts.tsx?__extjs_inner=1'
      )
    ).toBe(sourcePath)
  })

  it('tracks only content script entrypoints regardless of source path layout', () => {
    const contentChunk = {id: 'content-chunk'}
    const scriptsChunk = {id: 'scripts-chunk'}
    const backgroundChunk = {id: 'background-chunk'}
    const oddContentPath = '/project/features/odd/deeply/nested.entry.mtsx'
    const unrelatedScriptPath = '/project/scripts/hello.ts'
    const backgroundPath = '/project/background/index.ts'
    const compilation = {
      entrypoints: new Map([
        [
          'content_scripts/content-7',
          {
            chunks: [contentChunk]
          }
        ],
        [
          'scripts/hello',
          {
            chunks: [scriptsChunk]
          }
        ],
        [
          'background/scripts',
          {
            chunks: [backgroundChunk]
          }
        ]
      ]),
      chunkGraph: {
        getChunkModulesIterable: (chunk: unknown) => {
          if (chunk === contentChunk) {
            return [
              {
                resource: oddContentPath,
                modules: [{resource: '/project/ui/ContentRoot.tsx'}]
              }
            ]
          }
          if (chunk === scriptsChunk) {
            return [{resource: unrelatedScriptPath}]
          }
          if (chunk === backgroundChunk) {
            return [{resource: backgroundPath}]
          }
          return []
        }
      }
    } as any

    const dependencyPaths = collectContentScriptDependencyPaths(compilation)

    expect([...dependencyPaths.keys()]).toEqual(['content_scripts/content-7'])
    expect(dependencyPaths.get('content_scripts/content-7')).toContain(
      oddContentPath
    )
    expect(
      getChangedContentScriptEntryNames([oddContentPath], dependencyPaths)
    ).toEqual(['content_scripts/content-7'])
    expect(
      getChangedContentScriptEntryNames([unrelatedScriptPath], dependencyPaths)
    ).toEqual([])
    expect(
      getChangedContentScriptEntryNames([backgroundPath], dependencyPaths)
    ).toEqual([])
  })

  it('tracks sequential multi-script entries and their local import chain', () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-content-targets-')
    )
    const sourceDir = path.join(projectDir, 'src', 'content')
    fs.mkdirSync(sourceDir, {recursive: true})

    const helperPath = path.join(sourceDir, 'helper.js')
    const entryOnePath = path.join(sourceDir, 'one.js')
    const entryTwoPath = path.join(sourceDir, 'two.js')
    fs.writeFileSync(helperPath, 'export const label = "helper"\n', 'utf8')
    fs.writeFileSync(
      entryOnePath,
      'import "./two.js"\nimport {label} from "./helper.js"\nconsole.log(label)\n',
      'utf8'
    )
    fs.writeFileSync(entryTwoPath, 'console.log("two")\n', 'utf8')

    try {
      const compilation = {
        options: {
          entry: {
            'content_scripts/content-0': {
              import: [
                `data:text/javascript;charset=utf-8,${encodeURIComponent(
                  [
                    '/* extension.js sequential entry: content_scripts/content-0 */',
                    `import ${JSON.stringify(entryOnePath)};`,
                    `import ${JSON.stringify(entryTwoPath)};`
                  ].join('\n')
                )}`
              ]
            }
          }
        },
        entrypoints: new Map([
          [
            'content_scripts/content-0',
            {
              chunks: [{}]
            }
          ]
        ]),
        chunkGraph: {
          getChunkModulesIterable: () => []
        }
      } as any

      const dependencyPaths = collectContentScriptDependencyPaths(compilation)
      const trackedPaths = [
        ...(dependencyPaths.get('content_scripts/content-0') || new Set())
      ]

      expect(trackedPaths).toEqual(
        expect.arrayContaining([entryOnePath, entryTwoPath, helperPath])
      )
      expect(
        getChangedContentScriptEntryNames([helperPath], dependencyPaths)
      ).toEqual(['content_scripts/content-0'])
    } finally {
      fs.rmSync(projectDir, {recursive: true, force: true})
    }
  })
})
