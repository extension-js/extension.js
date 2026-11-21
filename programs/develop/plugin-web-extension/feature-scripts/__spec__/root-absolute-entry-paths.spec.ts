import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {listOutput} from '../../../__spec__/helpers/compile-harness'
import {
  build,
  manifest,
  notFoundPaths,
  PAGE,
  project
} from '../../../__spec__/helpers/private-files-project'

// Whole production builds of a manifest that names a file from the root,
// `/x`, by where the file sits and where the manifest sits. The row says
// which output file holds the text of the source file, or what was said.

type Kind = 'js' | 'css'

interface Field {
  kind: Kind
  manifest: (target: string) => Record<string, unknown>
}

const MATCHES = ['https://example.com/*']

const FIELDS: Record<string, Field> = {
  'content_scripts[0].js': {
    kind: 'js',
    manifest: (target) => ({
      content_scripts: [{matches: MATCHES, js: [target]}]
    })
  },
  'content_scripts[0].css': {
    kind: 'css',
    manifest: (target) => ({
      content_scripts: [{matches: MATCHES, js: ['first.js'], css: [target]}]
    })
  },
  'background.service_worker': {
    kind: 'js',
    manifest: (target) => ({background: {service_worker: target}})
  }
}

interface Layout {
  // The folder the manifest sits in, from the project root.
  manifestDir: string
  // The one place the named file is written, from the project root.
  file: (kind: Kind) => string
  target: (kind: Kind) => string
}

const LAYOUTS: Record<string, Layout> = {
  'a file in public/, manifest at the root': {
    manifestDir: '',
    file: (kind) => `public/hosted.${kind}`,
    target: (kind) => `/hosted.${kind}`
  },
  'a file at the root, manifest at the root': {
    manifestDir: '',
    file: (kind) => `content.${kind}`,
    target: (kind) => `/content.${kind}`
  },
  'a file at the root, manifest in src/': {
    manifestDir: 'src/',
    file: (kind) => `content.${kind}`,
    target: (kind) => `/content.${kind}`
  },
  'a file in src/, manifest in src/': {
    manifestDir: 'src/',
    file: (kind) => `src/content.${kind}`,
    target: (kind) => `/content.${kind}`
  },
  'a file in public/, manifest in src/': {
    manifestDir: 'src/',
    file: (kind) => `public/hosted.${kind}`,
    target: (kind) => `/hosted.${kind}`
  },
  'no file at all, manifest at the root': {
    manifestDir: '',
    file: (kind) => `elsewhere/content.${kind}`,
    target: (kind) => `/content.${kind}`
  }
}

const codeOf = (file: string) =>
  file.endsWith('.css')
    ? `a{content:"TEXT-of(${file})"}\n`
    : `console.log("TEXT-of(${file})")\n`

const withoutHash = (name: string) =>
  name.replace(/\.[0-9a-f]{8}(?=\.|$)/, '.<hash>')

async function rowFor(name: string, field: Field, layout: Layout) {
  const file = layout.file(field.kind)
  const root = project({
    [file]: codeOf(file),
    [`${layout.manifestDir}first.js`]: 'console.log("first")\n',
    [`${layout.manifestDir}popup.html`]: PAGE,
    [`${layout.manifestDir}manifest.json`]: manifest(
      field.manifest(layout.target(field.kind))
    )
  })

  if (layout.manifestDir) fs.rmSync(path.join(root, 'manifest.json'))

  const result = await build(root)
  const out = listOutput(path.join(root, 'dist', 'chrome'))
  const held = Object.keys(out)
    .sort()
    .filter((output) => out[output].includes(`TEXT-of(${file})`))
    .map(withoutHash)
  const said = [
    ...result.printed.matchAll(
      /([^\s"]+ does not exist\. Check the \S+ field in your manifest\.json file\.)/g
    )
  ].map((match) => match[1])
  const named = JSON.parse(out['manifest.json'] ?? '{}')
  // The printed lines name a missing file in full, and the diagnostics a
  // failed build rejects with name it from the project root.
  const cut = result.printed.lastIndexOf('\n{"')
  const inManifest =
    name === 'background.service_worker'
      ? named.background?.service_worker
      : named.content_scripts?.[0]?.[field.kind]?.[0]

  return [
    held.length ? `${file} in ${held.join(' + ')}` : 'nothing',
    ...(inManifest ? [`manifest names ${inManifest}`] : []),
    ...(said.length ? [`said ${[...new Set(said)].join(', ')}`] : []),
    ...notFoundPaths(result.printed.slice(0, cut)).map(
      // A Windows build spells the path natively, so the row reads one way.
      (missing) =>
        `NOT FOUND ${missing.replace(root, '<root>').split(path.sep).join('/')}`
    ),
    ...notFoundPaths(result.printed.slice(cut)).map(
      (missing) => `diagnostic NOT FOUND ${missing}`
    ),
    ...(result.errors ? [`errors ${result.errors}`] : [])
  ].join(' | ')
}

const TIMEOUT = 600_000

const EXPECTED: Record<string, Record<string, string>> = {
  'a file in public/, manifest at the root': {
    'content_scripts[0].js':
      'public/hosted.js in content_scripts/content-0.js + hosted.js | manifest names content_scripts/content-0.js',
    'content_scripts[0].css':
      'public/hosted.css in content_scripts/content-0.css + hosted.css | manifest names content_scripts/content-0.css',
    'background.service_worker':
      'public/hosted.js in background/service_worker.js + hosted.js | manifest names background/service_worker.js'
  },
  'a file at the root, manifest at the root': {
    'content_scripts[0].js':
      'content.js in content_scripts/content-0.js | manifest names content_scripts/content-0.js',
    'content_scripts[0].css':
      'content.css in content_scripts/content-0.css | manifest names content_scripts/content-0.css',
    'background.service_worker':
      'content.js in background/service_worker.js | manifest names background/service_worker.js'
  },
  'a file at the root, manifest in src/': {
    'content_scripts[0].js':
      'nothing | said content.js does not exist. Check the content_scripts[0].js field in your manifest.json file. | NOT FOUND <root>/src/content.js | diagnostic NOT FOUND src/content.js | errors 1',
    'content_scripts[0].css':
      'nothing | said content.css does not exist. Check the content_scripts[0].css field in your manifest.json file. | NOT FOUND <root>/src/content.css | diagnostic NOT FOUND src/content.css | errors 1',
    'background.service_worker':
      'nothing | said content.js does not exist. Check the background.service_worker field in your manifest.json file. | NOT FOUND <root>/src/content.js | diagnostic NOT FOUND src/content.js | errors 1'
  },
  'a file in src/, manifest in src/': {
    'content_scripts[0].js':
      'src/content.js in content_scripts/content-0.js | manifest names content_scripts/content-0.js',
    'content_scripts[0].css':
      'src/content.css in content_scripts/content-0.css | manifest names content_scripts/content-0.css',
    'background.service_worker':
      'src/content.js in background/service_worker.js | manifest names background/service_worker.js'
  },
  'a file in public/, manifest in src/': {
    'content_scripts[0].js':
      'public/hosted.js in content_scripts/content-0.js + hosted.js | manifest names content_scripts/content-0.js',
    'content_scripts[0].css':
      'public/hosted.css in content_scripts/content-0.css + hosted.css | manifest names content_scripts/content-0.css',
    'background.service_worker':
      'public/hosted.js in background/service_worker.js + hosted.js | manifest names background/service_worker.js'
  },
  'no file at all, manifest at the root': {
    'content_scripts[0].js':
      'nothing | said content.js does not exist. Check the content_scripts[0].js field in your manifest.json file. | NOT FOUND <root>/content.js | diagnostic NOT FOUND content.js | errors 1',
    'content_scripts[0].css':
      'nothing | said content.css does not exist. Check the content_scripts[0].css field in your manifest.json file. | NOT FOUND <root>/content.css | diagnostic NOT FOUND content.css | errors 1',
    'background.service_worker':
      'nothing | said content.js does not exist. Check the background.service_worker field in your manifest.json file. | NOT FOUND <root>/content.js | diagnostic NOT FOUND content.js | errors 1'
  }
}

describe.each(Object.keys(LAYOUTS))('%s', (layout) => {
  it(
    'is named from the root by each field',
    async () => {
      const actual: Record<string, string> = {}

      for (const [name, field] of Object.entries(FIELDS)) {
        actual[name] = await rowFor(name, field, LAYOUTS[layout])
      }

      expect(actual).toEqual(EXPECTED[layout])
    },
    TIMEOUT
  )
})
