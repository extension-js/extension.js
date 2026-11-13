import {describe, expect, it} from 'vitest'
import {collectReferencedRuntimePayloads} from '../collect-entry-imports'

const emitted = [
  'pages/demo.html',
  'sidebar/index.html',
  'models/weights.bin',
  'engine.wasm',
  'content_scripts/content-0.js'
]

describe('extension pages a content script mentions', () => {
  it('does not expose a page the script only names', () => {
    const source =
      'chrome.runtime.sendMessage({open: "pages/demo.html"})\r\n// see sidebar/index.html\r\n'

    expect(collectReferencedRuntimePayloads(source, emitted)).toEqual([])
  })

  it('exposes a page the script asks runtime.getURL for', () => {
    const source =
      'frame.src = chrome.runtime.getURL("pages/demo.html")\nconst other = "sidebar/index.html"\n'

    expect(collectReferencedRuntimePayloads(source, emitted)).toEqual([
      'pages/demo.html'
    ])
  })

  it('reads the request through a leading slash and the browser namespace', () => {
    const source = "frame.src = browser.runtime.getURL('/sidebar/index.html')\n"

    expect(collectReferencedRuntimePayloads(source, emitted)).toEqual([
      'sidebar/index.html'
    ])
  })

  it('keeps exposing a data payload the script names', () => {
    const source =
      'fetch(base + "models/weights.bin")\nWebAssembly.instantiateStreaming(fetch(base + "engine.wasm"))\n'

    expect(collectReferencedRuntimePayloads(source, emitted).sort()).toEqual([
      'engine.wasm',
      'models/weights.bin'
    ])
  })
})
