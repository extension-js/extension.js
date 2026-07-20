// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Build minimal fixture extensions, one per candidate refusal shape.
// Every fixture is MV3 + valid baseline EXCEPT the single field under test.
import * as fs from 'fs'
import * as path from 'path'
import {fileURLToPath} from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
fs.rmSync(root, {recursive: true, force: true})

// A real 1x1 transparent PNG so "valid icon" baselines actually decode.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

const base = (name) => ({
  manifest_version: 3,
  name,
  version: '1.0'
})

/** @type {Array<{id: string, expect: 'refuse'|'load', manifest: object, files?: Record<string, string|Buffer>}>} */
const fixtures = [
  // ---- candidates: expect REFUSE ----
  {
    id: '01-name-missing',
    expect: 'refuse',
    manifest: {manifest_version: 3, version: '1.0'}
  },
  {id: '02-name-empty', expect: 'refuse', manifest: {...base(''), name: ''}},
  {
    id: '03-default-locale-no-tree',
    expect: 'refuse',
    manifest: {...base('f03'), default_locale: 'en'}
  },
  {
    id: '04-locales-tree-no-default',
    expect: 'refuse',
    manifest: base('f04'),
    files: {
      '_locales/en/messages.json': JSON.stringify({greeting: {message: 'hi'}})
    }
  },
  {
    id: '05-msg-unresolved',
    expect: 'refuse',
    manifest: {...base('__MSG_appName__'), default_locale: 'en'},
    files: {
      '_locales/en/messages.json': JSON.stringify({other: {message: 'x'}})
    }
  },
  {
    id: '06-war-string-array',
    expect: 'refuse',
    manifest: {...base('f06'), web_accessible_resources: ['img.png']},
    files: {'img.png': PNG_1PX}
  },
  {
    id: '07-war-no-matches-no-ids',
    expect: 'refuse',
    manifest: {
      ...base('f07'),
      web_accessible_resources: [{resources: ['img.png']}]
    },
    files: {'img.png': PNG_1PX}
  },
  {
    id: '08-war-no-resources',
    expect: 'refuse',
    manifest: {
      ...base('f08'),
      web_accessible_resources: [{matches: ['https://example.com/*']}]
    }
  },
  {
    id: '09-cs-missing-matches',
    expect: 'refuse',
    manifest: {...base('f09'), content_scripts: [{js: ['c.js']}]},
    files: {'c.js': '// noop'}
  },
  {
    id: '10-cs-empty-matches',
    expect: 'refuse',
    manifest: {...base('f10'), content_scripts: [{matches: [], js: ['c.js']}]},
    files: {'c.js': '// noop'}
  },
  {
    id: '11-min-chrome-version-high',
    expect: 'refuse',
    manifest: {...base('f11'), minimum_chrome_version: '999.0'}
  },
  {
    id: '12-mv3-background-page',
    expect: 'refuse',
    manifest: {...base('f12'), background: {page: 'bg.html'}},
    files: {'bg.html': '<!doctype html>'}
  },
  {
    id: '13-mv3-persistent-true',
    expect: 'refuse',
    manifest: {
      ...base('f13'),
      background: {service_worker: 'sw.js', persistent: true}
    },
    files: {'sw.js': '// noop'}
  },
  {
    id: '14-mv3-persistent-false',
    expect: 'refuse',
    manifest: {
      ...base('f14'),
      background: {service_worker: 'sw.js', persistent: false}
    },
    files: {'sw.js': '// noop'}
  },
  {
    id: '15-icon-bad-bytes',
    expect: 'refuse',
    manifest: {...base('f15'), icons: {128: 'icon.png'}},
    files: {'icon.png': 'this is not a png'}
  },
  {
    id: '16-icon-svg',
    expect: 'refuse',
    manifest: {...base('f16'), icons: {128: 'icon.svg'}},
    files: {
      'icon.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="red"/></svg>'
    }
  },
  {
    id: '17-run-at-invalid',
    expect: 'refuse',
    manifest: {
      ...base('f17'),
      content_scripts: [
        {matches: ['<all_urls>'], js: ['c.js'], run_at: 'document_ready'}
      ]
    },
    files: {'c.js': '// noop'}
  },
  {
    id: '18-cs-js-nonstring',
    expect: 'refuse',
    manifest: {
      ...base('f18'),
      content_scripts: [{matches: ['<all_urls>'], js: [42]}]
    }
  },
  {
    id: '19-managed-schema-missing',
    expect: 'refuse',
    manifest: {
      ...base('f19'),
      permissions: ['storage'],
      storage: {managed_schema: 'schema.json'}
    }
  },

  // ---- negative controls: expect LOAD ----
  {
    id: '90-ctl-unknown-permission',
    expect: 'load',
    manifest: {...base('f90'), permissions: ['notARealPermission']}
  },
  {
    id: '91-ctl-mv3-browser-action',
    expect: 'load',
    manifest: {...base('f91'), browser_action: {default_title: 'x'}}
  },
  {
    id: '92-ctl-valid-baseline',
    expect: 'load',
    manifest: {...base('f92'), icons: {128: 'icon.png'}},
    files: {'icon.png': PNG_1PX}
  }
]

for (const f of fixtures) {
  const dir = path.join(root, f.id)
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(f.manifest, null, 2)
  )
  for (const [rel, content] of Object.entries(f.files || {})) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }
}
fs.writeFileSync(
  path.join(root, 'index.json'),
  JSON.stringify(
    fixtures.map(({id, expect}) => ({id, expect})),
    null,
    2
  )
)
console.log(`built ${fixtures.length} fixtures in ${root}`)
