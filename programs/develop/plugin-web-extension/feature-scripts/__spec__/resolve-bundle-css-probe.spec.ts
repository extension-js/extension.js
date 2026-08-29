import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  createContentScriptCssProbeMarkerPattern,
  getContentScriptCssProbeMarker
} from '../contracts'
import contentScriptWrapper from '../steps/add-content-script-wrapper/content-script-wrapper'
import {resolveBundleCssProbeMarker} from '../steps/add-content-script-wrapper/index'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createTempProject() {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-probe-'))
  )
  tempDirs.push(dir)
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"fixture"}\n',
    'utf8'
  )
  return dir
}

function wrapContentScript(source: string): string {
  const projectDir = createTempProject()
  const manifestDir = path.join(projectDir, 'src')
  const contentDir = path.join(manifestDir, 'content')
  fs.mkdirSync(contentDir, {recursive: true})

  const manifestPath = path.join(manifestDir, 'manifest.json')
  const resourcePath = path.join(contentDir, 'scripts.ts')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      manifest_version: 3,
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content/scripts.ts']
        }
      ]
    }),
    'utf8'
  )

  const context = {
    resourcePath,
    _compilation: {},
    emitWarning: vi.fn(),
    getOptions() {
      return {manifestPath, mode: 'production'}
    }
  }

  return contentScriptWrapper.call(context as never, source) as string
}

describe('bundle css probe marker', () => {
  it('bakes a resolvable marker instead of an unconditional sibling fetch', () => {
    const wrapped = wrapContentScript(
      'export default function mount() {\n  return () => {}\n}\n'
    )

    expect(wrapped).toContain(
      getContentScriptCssProbeMarker('content_scripts/content-0')
    )
    expect(wrapped).not.toContain('__EXTENSIONJS_BUNDLE_KEY + ".css"')
  })

  it('resolves the marker to nothing when the build emitted no stylesheet', () => {
    expect(
      resolveBundleCssProbeMarker(
        'content_scripts/content-0.css',
        () => false,
        () => ['content_scripts/content-0.js', 'manifest.json']
      )
    ).toBe('')
  })

  it('resolves the marker to the emitted sibling stylesheet', () => {
    expect(
      resolveBundleCssProbeMarker(
        'content_scripts/content-0.css',
        (name) => name === 'content_scripts/content-0.css',
        () => ['content_scripts/content-0.css']
      )
    ).toBe('content_scripts/content-0.css')
  })

  it('resolves the marker to the hash-busted stylesheet dev emits', () => {
    expect(
      resolveBundleCssProbeMarker(
        'content_scripts/content-0.css',
        () => false,
        () => ['content_scripts/content-0.abc123.css']
      )
    ).toBe('content_scripts/content-0.abc123.css')
  })

  it('never resolves a scripts-folder probe to a stylesheet', () => {
    expect(
      resolveBundleCssProbeMarker(
        'scripts/tool.js.css',
        () => false,
        () => ['content_scripts/content-0.css']
      )
    ).toBe('')
  })

  it('marker pattern matches the marker but not the runtime guard literal', () => {
    const marker = getContentScriptCssProbeMarker('content_scripts/content-0')
    const guard = '"__EXTENSIONJS_CSS_PROBE"'
    const pattern = createContentScriptCssProbeMarkerPattern()

    const matches = `${guard} ${marker}`.match(pattern)
    expect(matches).toEqual([marker])
  })
})
