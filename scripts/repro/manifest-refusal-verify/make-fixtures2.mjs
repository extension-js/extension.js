// Batch 2: edge cases that decide the exact grammar of the static checks.
import * as fs from 'fs'
import * as path from 'path'
import {fileURLToPath} from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures2')
fs.rmSync(root, {recursive: true, force: true})

const base = (name) => ({manifest_version: 3, name, version: '1.0'})
const msgs = (obj) => JSON.stringify(obj)

const fixtures = [
  // default_locale declared, _locales EXISTS but has no catalog for it
  {id: '20-locale-missing-catalog', expect: 'refuse',
    manifest: {...base('f20'), default_locale: 'en'},
    files: {'_locales/fr/messages.json': msgs({greeting: {message: 'salut'}})}},
  // empty-but-valid messages.json for the default locale
  {id: '21-locale-empty-messages', expect: 'load',
    manifest: {...base('f21'), default_locale: 'en'},
    files: {'_locales/en/messages.json': '{}'}},
  // malformed JSON in the default catalog
  {id: '22-locale-bad-json', expect: 'refuse',
    manifest: {...base('f22'), default_locale: 'en'},
    files: {'_locales/en/messages.json': '{oops'}},
  // WAR dict with resources + use_dynamic_url only (no matches/extension_ids)
  {id: '23-war-dynamic-url-only', expect: 'load',
    manifest: {...base('f23'), web_accessible_resources: [{resources: ['img.png'], use_dynamic_url: true}]},
    files: {'img.png': 'x'}},
  // predefined @@ message variable in name
  {id: '24-msg-predefined', expect: 'load',
    manifest: {...base('__MSG_@@ui_locale__'), default_locale: 'en'},
    files: {'_locales/en/messages.json': msgs({x: {message: 'y'}})}},
  // case difference between reference and catalog key
  {id: '25-msg-case-diff', expect: 'load',
    manifest: {...base('__MSG_APPNAME__'), default_locale: 'en'},
    files: {'_locales/en/messages.json': msgs({appName: {message: 'Cased'}})}},
  // non-string name
  {id: '26-name-nonstring', expect: 'refuse',
    manifest: {manifest_version: 3, name: 42, version: '1.0'}},
  // non-string run_at
  {id: '27-run-at-nonstring', expect: 'refuse',
    manifest: {...base('f27'), content_scripts: [{matches: ['<all_urls>'], js: ['c.js'], run_at: 3}]},
    files: {'c.js': '// noop'}},
  // re-verify the existing 0-byte icon assumption on this build
  {id: '28-icon-zero-byte', expect: 'refuse',
    manifest: {...base('f28'), icons: {128: 'icon.png'}},
    files: {'icon.png': ''}},
  // __MSG__ in description (not just name)
  {id: '29-msg-unresolved-description', expect: 'refuse',
    manifest: {...base('f29'), description: '__MSG_missing__', default_locale: 'en'},
    files: {'_locales/en/messages.json': msgs({x: {message: 'y'}})}},
  // control: fully valid localized extension
  {id: '30-ctl-localized-ok', expect: 'load',
    manifest: {...base('__MSG_appName__'), default_locale: 'en'},
    files: {'_locales/en/messages.json': msgs({appName: {message: 'Fine'}})}},
  // minimum_chrome_version BELOW current (control for the compare direction)
  {id: '31-ctl-min-version-low', expect: 'load',
    manifest: {...base('f31'), minimum_chrome_version: '100'}},
  // minimum_chrome_version non-numeric garbage
  {id: '32-min-version-garbage', expect: 'refuse',
    manifest: {...base('f32'), minimum_chrome_version: 'banana'}}
]

for (const f of fixtures) {
  const dir = path.join(root, f.id)
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(f.manifest, null, 2))
  for (const [rel, content] of Object.entries(f.files || {})) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }
}
fs.writeFileSync(
  path.join(root, 'index.json'),
  JSON.stringify(fixtures.map(({id, expect}) => ({id, expect})), null, 2)
)
console.log(`built ${fixtures.length} fixtures in ${root}`)
