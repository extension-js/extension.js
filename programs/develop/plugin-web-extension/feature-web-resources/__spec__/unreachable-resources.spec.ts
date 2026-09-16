import {describe, expect, it} from 'vitest'
import {
  collectGetUrlLiterals,
  findUnreachableRuntimeResources,
  isResourceCovered,
  normalizeResourcePath
} from '../web-resources-lib/unreachable-resources'

describe('unreachable web accessible resources', () => {
  it('reads plain getURL names and skips computed ones', () => {
    const source = `
      chrome.runtime.getURL("injected.js")
      browser.runtime.getURL('data/one.json')
      runtime.getURL(\`dynamic-\${index}.json\`)
    `

    expect(collectGetUrlLiterals(source)).toEqual([
      'data/one.json',
      'injected.js'
    ])
  })

  it('treats a leading slash and a glob as covering the file', () => {
    expect(isResourceCovered(['/injected.js'], 'injected.js')).toBe(true)
    expect(isResourceCovered(['assets/*.png'], 'assets/logo.png')).toBe(true)
    expect(isResourceCovered(['assets/*.png'], 'logo.png')).toBe(false)
    expect(normalizeResourcePath('./a\\b.json')).toBe('a/b.json')
  })

  it('names an emitted file the manifest never makes page-reachable', () => {
    expect(
      findUnreachableRuntimeResources({
        source: 'chrome.runtime.getURL("injected.js")',
        emittedAssetNames: ['injected.js', 'payload.json'],
        declaredResources: ['payload.json']
      })
    ).toEqual(['injected.js'])
  })

  it('stays quiet for declared files, tooling files and unknown names', () => {
    expect(
      findUnreachableRuntimeResources({
        source: [
          'chrome.runtime.getURL("payload.json")',
          'chrome.runtime.getURL("manifest.json")',
          'runtime.getURL("extension-js-control.json")',
          'runtime.getURL("hot/1.hot-update.json")',
          'chrome.runtime.getURL("never-emitted.json")'
        ].join('\n'),
        emittedAssetNames: [
          'payload.json',
          'manifest.json',
          'extension-js-control.json',
          'hot/1.hot-update.json'
        ],
        declaredResources: ['payload.json']
      })
    ).toEqual([])
  })
})
