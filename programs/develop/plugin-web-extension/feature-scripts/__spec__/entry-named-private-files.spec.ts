import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {listOutput} from '../../../__spec__/helpers/compile-harness'
import {
  build,
  canLink,
  expectNothingPrivate,
  MARKER,
  manifest,
  notFoundPaths,
  PAGE,
  project
} from '../../../__spec__/helpers/private-files-project'
import type {BrowserType} from '../../../types'

// Whole production builds, one per target: a manifest field that the build
// compiles names that target, and the row says whose text the output holds.
// A compiled file ships inside a bundle, so every output file is searched.

// A row in one line: the fixture files whose text is in the output and the
// output file that holds each, what the build said, and its error count.
type Table = Record<string, string>

type Kind = 'js' | 'css'

interface Field {
  name: string
  kind: Kind
  browser?: BrowserType
  manifest: (target: string) => Record<string, unknown>
  // Left out for a field read against every target.
  targets?: (kind: Kind) => string[]
}

const MATCHES = ['https://example.com/*']
const VERSION_2 = {
  manifest_version: 2,
  action: undefined,
  browser_action: {default_popup: 'popup.html'}
}

const FIELDS: Record<string, Field> = {
  contentScriptsJs: {
    name: 'content_scripts[].js',
    kind: 'js',
    manifest: (target) => ({
      content_scripts: [{matches: MATCHES, js: [target]}]
    })
  },
  contentScriptsJsGroup: {
    name: 'content_scripts[].js beside another file',
    kind: 'js',
    targets: few,
    manifest: (target) => ({
      content_scripts: [{matches: MATCHES, js: ['first.js', target]}]
    })
  },
  contentScriptsCss: {
    name: 'content_scripts[].css',
    kind: 'css',
    manifest: (target) => ({
      content_scripts: [{matches: MATCHES, js: ['first.js'], css: [target]}]
    })
  },
  serviceWorker: {
    name: 'background.service_worker',
    kind: 'js',
    manifest: (target) => ({background: {service_worker: target}})
  },
  backgroundScripts: {
    name: 'background.scripts',
    kind: 'js',
    manifest: (target) => ({background: {scripts: [target]}})
  },
  backgroundScriptsFirefox: {
    name: 'background.scripts in a Firefox build',
    kind: 'js',
    browser: 'firefox',
    targets: few,
    manifest: (target) => ({...VERSION_2, background: {scripts: [target]}})
  },
  userScripts: {
    name: 'user_scripts.api_script',
    kind: 'js',
    browser: 'firefox',
    manifest: (target) => ({...VERSION_2, user_scripts: {api_script: target}})
  },
  themeExperiment: {
    name: 'theme_experiment.stylesheet',
    kind: 'css',
    browser: 'firefox',
    manifest: (target) => ({
      ...VERSION_2,
      theme_experiment: {stylesheet: target}
    })
  },
  webAccessibleScript: {
    name: 'a script in web_accessible_resources',
    kind: 'js',
    targets: few,
    manifest: (target) => ({
      web_accessible_resources: [{resources: [target], matches: MATCHES}]
    })
  },
  webAccessibleSheet: {
    name: 'a stylesheet in web_accessible_resources',
    kind: 'css',
    targets: few,
    manifest: (target) => ({
      web_accessible_resources: [{resources: [target], matches: MATCHES}]
    })
  }
}

function targetsFor(kind: Kind): string[] {
  return [
    '.envrc',
    '.npmrc',
    '.env',
    '.env.local',
    `.env.${kind}`,
    `.env.local.${kind}`,
    'a/../.envrc',
    `a/../.env.${kind}`,
    `/.env.${kind}`,
    `../outside.${kind}`,
    `a/../../outside.${kind}`,
    `linked-out.${kind}`,
    'node_modules/pkg/.env',
    `node_modules/pkg/.env.${kind}`,
    `.git/tool.${kind}`,
    kind === 'js' ? 'node_modules/pkg/lib.js' : 'node_modules/pkg/theme.css',
    `linked-in.${kind}`,
    '.env.example',
    `.env.example.${kind}`,
    `ok.${kind}`,
    `/hosted.${kind}`,
    `public/hosted.${kind}`,
    `absent.${kind}`
  ]
}

// One of each kind, for a field another field shares its reading with.
function few(kind: Kind): string[] {
  return [
    '.envrc',
    `.env.${kind}`,
    `../outside.${kind}`,
    `linked-out.${kind}`,
    `node_modules/pkg/.env.${kind}`,
    kind === 'js' ? 'node_modules/pkg/lib.js' : 'node_modules/pkg/theme.css',
    `ok.${kind}`,
    `absent.${kind}`
  ]
}

// Every file holds valid code that carries its own name, so a bundle that
// took a file in says which one. A fake private file carries the marker.
const PRIVATE_FILES = [
  '.envrc',
  '.npmrc',
  '.env',
  '.env.local',
  '.env.js',
  '.env.css',
  '.env.local.js',
  '.env.local.css',
  '.git/tool.js',
  '.git/tool.css',
  'node_modules/pkg/.env',
  'node_modules/pkg/.env.js',
  'node_modules/pkg/.env.css',
  '../outside.js',
  '../outside.css'
]

const PLAIN_FILES = [
  '.env.example',
  '.env.example.js',
  '.env.example.css',
  'node_modules/pkg/lib.js',
  'node_modules/pkg/theme.css',
  'inside.js',
  'inside.css',
  'ok.js',
  'ok.css',
  'first.js',
  'public/hosted.js',
  'public/hosted.css'
]

const textOf = (file: string) =>
  `${PRIVATE_FILES.includes(file) ? MARKER : 'PLAIN-TEXT'}-of(${file})`

function codeOf(file: string, kind: Kind) {
  const ext = /\.(js|css)$/.exec(file)?.[1] ?? kind

  return ext === 'js'
    ? `globalThis.fromFile = ${JSON.stringify(textOf(file))}\n`
    : `a{content:${JSON.stringify(textOf(file))}}\n`
}

function fixture(field: Field, target: string) {
  const files: Record<string, string> = {}

  for (const file of [...PRIVATE_FILES, ...PLAIN_FILES]) {
    if (!file.startsWith('../')) files[file] = codeOf(file, field.kind)
  }

  const root = project({
    ...files,
    'manifest.json': manifest(field.manifest(target))
  })
  const holder = path.dirname(root)

  for (const kind of ['js', 'css'] as const) {
    const outside = path.join(holder, `outside.${kind}`)

    fs.writeFileSync(outside, codeOf(`../outside.${kind}`, kind))

    if (canLink) {
      fs.symlinkSync(outside, path.join(root, `linked-out.${kind}`))
      fs.symlinkSync(
        path.join(root, `inside.${kind}`),
        path.join(root, `linked-in.${kind}`)
      )
    }
  }

  return root
}

// What a build says of a file a field names and the output does not hold.
const SAID: Array<[string, RegExp]> = [
  [
    'missing',
    /([^\s"]+ does not exist\. Check the \S+ field) in your manifest\.json file\./g
  ],
  ['withheld', /names '([^']+)', but the build doesn't copy it\./g],
  [
    'private',
    /([^\s"]+ is not bundled\. Check the \S+ field) in your manifest\.json file\.(?:\n|\\n)[^A-Za-z]*The build never bundles env files, tooling files or repository files\. Move the code into a file with another name\./g
  ],
  [
    'outside',
    /([^\s"]+ is not bundled\. Check the \S+ field) in your manifest\.json file\.(?:\n|\\n)[^A-Za-z]*The file is not one the project or its workspace shares\. Move it into the project\./g
  ]
]

const withoutHash = (name: string) =>
  name.replace(/\.[0-9a-f]{8}(?=\.|$)/, '.<hash>')

async function rowFor(field: Field, target: string): Promise<string> {
  const root = fixture(field, target)
  const browser = field.browser ?? 'chrome'
  const result = await build(root, browser)
  const out = listOutput(path.join(root, 'dist', browser))
  const held: string[] = []

  for (const file of [...PRIVATE_FILES, ...PLAIN_FILES]) {
    // The field's own companion file is in every build of the fixture.
    if (file === 'first.js' || file.startsWith('public/')) {
      if (path.posix.basename(target) !== path.posix.basename(file)) continue
    }

    for (const name of Object.keys(out).sort()) {
      if (out[name].includes(textOf(file))) {
        held.push(`${file} in ${withoutHash(name)}`)
      }
    }
  }

  const said = new Set<string>()

  // No message and no output file carries what a private file holds.
  expectNothingPrivate(result)

  for (const [kind, pattern] of SAID) {
    for (const match of result.printed.matchAll(pattern)) {
      // A field that holds an absolute path names it below the temp folder.
      said.add(`${kind} ${match[1].replace(/^\S*\/project\//, '<root>/')}`)
    }
  }

  return [
    held.join(' + ') || 'nothing',
    ...(said.size ? [`said ${[...said].sort().join(', ')}`] : []),
    ...(result.errors ? [`errors ${result.errors}`] : [])
  ].join(' | ')
}

async function tableFor(field: Field): Promise<Table> {
  const table: Table = {}

  for (const target of (field.targets ?? targetsFor)(field.kind)) {
    table[target] = await rowFor(field, target)
  }

  return table
}

const TIMEOUT = 600_000

const EXPECTED: Record<string, Table> = {
  contentScriptsJs: {
    '.envrc':
      'nothing | said private .envrc is not bundled. Check the content_scripts[0].js field | errors 1',
    '.npmrc':
      'nothing | said private .npmrc is not bundled. Check the content_scripts[0].js field | errors 1',
    '.env':
      'nothing | said private .env is not bundled. Check the content_scripts[0].js field | errors 1',
    '.env.local':
      'nothing | said private .env.local is not bundled. Check the content_scripts[0].js field | errors 1',
    '.env.js':
      'nothing | said private .env.js is not bundled. Check the content_scripts[0].js field | errors 1',
    '.env.local.js':
      'nothing | said private .env.local.js is not bundled. Check the content_scripts[0].js field | errors 1',
    'a/../.envrc':
      'nothing | said private .envrc is not bundled. Check the content_scripts[0].js field | errors 1',
    'a/../.env.js':
      'nothing | said private .env.js is not bundled. Check the content_scripts[0].js field | errors 1',
    '/.env.js':
      'nothing | said private .env.js is not bundled. Check the content_scripts[0].js field | errors 1',
    '../outside.js':
      'nothing | said outside ../outside.js is not bundled. Check the content_scripts[0].js field | errors 1',
    'a/../../outside.js':
      'nothing | said outside ../outside.js is not bundled. Check the content_scripts[0].js field | errors 1',
    'linked-out.js':
      'nothing | said outside linked-out.js is not bundled. Check the content_scripts[0].js field | errors 1',
    'node_modules/pkg/.env':
      'nothing | said private node_modules/pkg/.env is not bundled. Check the content_scripts[0].js field | errors 1',
    'node_modules/pkg/.env.js':
      'nothing | said private node_modules/pkg/.env.js is not bundled. Check the content_scripts[0].js field | errors 1',
    '.git/tool.js':
      'nothing | said private .git/tool.js is not bundled. Check the content_scripts[0].js field | errors 1',
    'node_modules/pkg/lib.js':
      'node_modules/pkg/lib.js in content_scripts/content-0.js',
    'linked-in.js': 'inside.js in content_scripts/content-0.js',
    '.env.example': 'nothing | errors 1',
    '.env.example.js':
      'nothing | said private .env.example.js is not bundled. Check the content_scripts[0].js field | errors 1',
    'ok.js': 'ok.js in content_scripts/content-0.js',
    '/hosted.js':
      'public/hosted.js in content_scripts/content-0.js + public/hosted.js in hosted.js',
    'public/hosted.js':
      'public/hosted.js in content_scripts/content-0.js + public/hosted.js in hosted.js',
    'absent.js':
      'nothing | said missing absent.js does not exist. Check the content_scripts[0].js field | errors 1'
  },
  contentScriptsJsGroup: {
    '.envrc':
      'nothing | said private .envrc is not bundled. Check the content_scripts[0].js field | errors 1',
    '.env.js':
      'nothing | said private .env.js is not bundled. Check the content_scripts[0].js field | errors 1',
    '../outside.js':
      'nothing | said outside ../outside.js is not bundled. Check the content_scripts[0].js field | errors 1',
    'linked-out.js':
      'nothing | said outside linked-out.js is not bundled. Check the content_scripts[0].js field | errors 1',
    'node_modules/pkg/.env.js':
      'nothing | said private node_modules/pkg/.env.js is not bundled. Check the content_scripts[0].js field | errors 1',
    'node_modules/pkg/lib.js':
      'node_modules/pkg/lib.js in content_scripts/content-0.js',
    'ok.js': 'ok.js in content_scripts/content-0.js',
    'absent.js':
      'nothing | said missing absent.js does not exist. Check the content_scripts[0].js field | errors 1'
  },
  contentScriptsCss: {
    '.envrc':
      'nothing | said private .envrc is not bundled. Check the content_scripts[0].css field | errors 1',
    '.npmrc':
      'nothing | said private .npmrc is not bundled. Check the content_scripts[0].css field | errors 1',
    '.env':
      'nothing | said private .env is not bundled. Check the content_scripts[0].css field | errors 1',
    '.env.local':
      'nothing | said private .env.local is not bundled. Check the content_scripts[0].css field | errors 1',
    '.env.css':
      'nothing | said private .env.css is not bundled. Check the content_scripts[0].css field | errors 1',
    '.env.local.css':
      'nothing | said private .env.local.css is not bundled. Check the content_scripts[0].css field | errors 1',
    'a/../.envrc':
      'nothing | said private .envrc is not bundled. Check the content_scripts[0].css field | errors 1',
    'a/../.env.css':
      'nothing | said private .env.css is not bundled. Check the content_scripts[0].css field | errors 1',
    '/.env.css':
      'nothing | said private .env.css is not bundled. Check the content_scripts[0].css field | errors 1',
    '../outside.css':
      'nothing | said outside ../outside.css is not bundled. Check the content_scripts[0].css field | errors 1',
    'a/../../outside.css':
      'nothing | said outside ../outside.css is not bundled. Check the content_scripts[0].css field | errors 1',
    'linked-out.css':
      'nothing | said outside linked-out.css is not bundled. Check the content_scripts[0].css field | errors 1',
    'node_modules/pkg/.env':
      'nothing | said private node_modules/pkg/.env is not bundled. Check the content_scripts[0].css field | errors 1',
    'node_modules/pkg/.env.css':
      'nothing | said private node_modules/pkg/.env.css is not bundled. Check the content_scripts[0].css field | errors 1',
    '.git/tool.css':
      'nothing | said private .git/tool.css is not bundled. Check the content_scripts[0].css field | errors 1',
    'node_modules/pkg/theme.css':
      'node_modules/pkg/theme.css in content_scripts/content-0.css',
    'linked-in.css': 'inside.css in content_scripts/content-0.css',
    '.env.example': 'nothing | errors 1',
    '.env.example.css':
      'nothing | said private .env.example.css is not bundled. Check the content_scripts[0].css field | errors 1',
    'ok.css': 'ok.css in content_scripts/content-0.css',
    '/hosted.css':
      'public/hosted.css in content_scripts/content-0.css + public/hosted.css in hosted.css',
    'public/hosted.css':
      'public/hosted.css in content_scripts/content-0.css + public/hosted.css in hosted.css',
    'absent.css':
      'nothing | said missing absent.css does not exist. Check the content_scripts[0].css field | errors 1'
  },
  serviceWorker: {
    '.envrc':
      'nothing | said private .envrc is not bundled. Check the background.service_worker field | errors 1',
    '.npmrc':
      'nothing | said private .npmrc is not bundled. Check the background.service_worker field | errors 1',
    '.env':
      'nothing | said private .env is not bundled. Check the background.service_worker field | errors 1',
    '.env.local':
      'nothing | said private .env.local is not bundled. Check the background.service_worker field | errors 1',
    '.env.js':
      'nothing | said private .env.js is not bundled. Check the background.service_worker field | errors 1',
    '.env.local.js':
      'nothing | said private .env.local.js is not bundled. Check the background.service_worker field | errors 1',
    'a/../.envrc':
      'nothing | said private .envrc is not bundled. Check the background.service_worker field | errors 1',
    'a/../.env.js':
      'nothing | said private .env.js is not bundled. Check the background.service_worker field | errors 1',
    '/.env.js':
      'nothing | said private .env.js is not bundled. Check the background.service_worker field | errors 1',
    '../outside.js':
      'nothing | said outside ../outside.js is not bundled. Check the background.service_worker field | errors 1',
    'a/../../outside.js':
      'nothing | said outside ../outside.js is not bundled. Check the background.service_worker field | errors 1',
    'linked-out.js':
      'nothing | said outside linked-out.js is not bundled. Check the background.service_worker field | errors 1',
    'node_modules/pkg/.env':
      'nothing | said private node_modules/pkg/.env is not bundled. Check the background.service_worker field | errors 1',
    'node_modules/pkg/.env.js':
      'nothing | said private node_modules/pkg/.env.js is not bundled. Check the background.service_worker field | errors 1',
    '.git/tool.js':
      'nothing | said private .git/tool.js is not bundled. Check the background.service_worker field | errors 1',
    'node_modules/pkg/lib.js':
      'node_modules/pkg/lib.js in background/service_worker.js',
    'linked-in.js': 'inside.js in background/service_worker.js',
    '.env.example': 'nothing | errors 1',
    '.env.example.js':
      'nothing | said private .env.example.js is not bundled. Check the background.service_worker field | errors 1',
    'ok.js': 'ok.js in background/service_worker.js',
    '/hosted.js':
      'public/hosted.js in background/service_worker.js + public/hosted.js in hosted.js',
    'public/hosted.js':
      'public/hosted.js in background/service_worker.js + public/hosted.js in hosted.js',
    'absent.js':
      'nothing | said missing absent.js does not exist. Check the background.service_worker field | errors 1'
  },
  backgroundScripts: {
    '.envrc':
      'nothing | said private .envrc is not bundled. Check the background.scripts field | errors 1',
    '.npmrc':
      'nothing | said private .npmrc is not bundled. Check the background.scripts field | errors 1',
    '.env':
      'nothing | said private .env is not bundled. Check the background.scripts field | errors 1',
    '.env.local':
      'nothing | said private .env.local is not bundled. Check the background.scripts field | errors 1',
    '.env.js':
      'nothing | said private .env.js is not bundled. Check the background.scripts field | errors 1',
    '.env.local.js':
      'nothing | said private .env.local.js is not bundled. Check the background.scripts field | errors 1',
    'a/../.envrc':
      'nothing | said private .envrc is not bundled. Check the background.scripts field | errors 1',
    'a/../.env.js':
      'nothing | said private .env.js is not bundled. Check the background.scripts field | errors 1',
    '/.env.js':
      'nothing | said private .env.js is not bundled. Check the background.scripts field | errors 1',
    '../outside.js':
      'nothing | said outside ../outside.js is not bundled. Check the background.scripts field | errors 1',
    'a/../../outside.js':
      'nothing | said outside ../outside.js is not bundled. Check the background.scripts field | errors 1',
    'linked-out.js':
      'nothing | said outside linked-out.js is not bundled. Check the background.scripts field | errors 1',
    'node_modules/pkg/.env':
      'nothing | said private node_modules/pkg/.env is not bundled. Check the background.scripts field | errors 1',
    'node_modules/pkg/.env.js':
      'nothing | said private node_modules/pkg/.env.js is not bundled. Check the background.scripts field | errors 1',
    '.git/tool.js':
      'nothing | said private .git/tool.js is not bundled. Check the background.scripts field | errors 1',
    'node_modules/pkg/lib.js':
      'node_modules/pkg/lib.js in background/scripts.js',
    'linked-in.js': 'inside.js in background/scripts.js',
    '.env.example': 'nothing | errors 1',
    '.env.example.js':
      'nothing | said private .env.example.js is not bundled. Check the background.scripts field | errors 1',
    'ok.js': 'ok.js in background/scripts.js',
    '/hosted.js':
      'public/hosted.js in background/scripts.js + public/hosted.js in hosted.js',
    'public/hosted.js':
      'public/hosted.js in background/scripts.js + public/hosted.js in hosted.js',
    'absent.js':
      'nothing | said missing absent.js does not exist. Check the background.scripts field | errors 1'
  },
  backgroundScriptsFirefox: {
    '.envrc':
      'nothing | said private .envrc is not bundled. Check the background.scripts field | errors 1',
    '.env.js':
      'nothing | said private .env.js is not bundled. Check the background.scripts field | errors 1',
    '../outside.js':
      'nothing | said outside ../outside.js is not bundled. Check the background.scripts field | errors 1',
    'linked-out.js':
      'nothing | said outside linked-out.js is not bundled. Check the background.scripts field | errors 1',
    'node_modules/pkg/.env.js':
      'nothing | said private node_modules/pkg/.env.js is not bundled. Check the background.scripts field | errors 1',
    'node_modules/pkg/lib.js':
      'node_modules/pkg/lib.js in background/scripts.js',
    'ok.js': 'ok.js in background/scripts.js',
    'absent.js':
      'nothing | said missing absent.js does not exist. Check the background.scripts field | errors 1'
  },
  userScripts: {
    '.envrc':
      'nothing | said private .envrc is not bundled. Check the user_scripts.api_script field | errors 1',
    '.npmrc':
      'nothing | said private .npmrc is not bundled. Check the user_scripts.api_script field | errors 1',
    '.env':
      'nothing | said private .env is not bundled. Check the user_scripts.api_script field | errors 1',
    '.env.local':
      'nothing | said private .env.local is not bundled. Check the user_scripts.api_script field | errors 1',
    '.env.js':
      'nothing | said private .env.js is not bundled. Check the user_scripts.api_script field | errors 1',
    '.env.local.js':
      'nothing | said private .env.local.js is not bundled. Check the user_scripts.api_script field | errors 1',
    'a/../.envrc':
      'nothing | said private .envrc is not bundled. Check the user_scripts.api_script field | errors 1',
    'a/../.env.js':
      'nothing | said private .env.js is not bundled. Check the user_scripts.api_script field | errors 1',
    '/.env.js':
      'nothing | said private .env.js is not bundled. Check the user_scripts.api_script field | errors 1',
    '../outside.js':
      'nothing | said outside ../outside.js is not bundled. Check the user_scripts.api_script field | errors 1',
    'a/../../outside.js':
      'nothing | said outside ../outside.js is not bundled. Check the user_scripts.api_script field | errors 1',
    'linked-out.js':
      'nothing | said outside linked-out.js is not bundled. Check the user_scripts.api_script field | errors 1',
    'node_modules/pkg/.env':
      'nothing | said private node_modules/pkg/.env is not bundled. Check the user_scripts.api_script field | errors 1',
    'node_modules/pkg/.env.js':
      'nothing | said private node_modules/pkg/.env.js is not bundled. Check the user_scripts.api_script field | errors 1',
    '.git/tool.js':
      'nothing | said private .git/tool.js is not bundled. Check the user_scripts.api_script field | errors 1',
    'node_modules/pkg/lib.js':
      'node_modules/pkg/lib.js in user_scripts/api_script.js',
    'linked-in.js': 'inside.js in user_scripts/api_script.js',
    '.env.example': 'nothing',
    '.env.example.js':
      'nothing | said private .env.example.js is not bundled. Check the user_scripts.api_script field | errors 1',
    'ok.js': 'ok.js in user_scripts/api_script.js',
    '/hosted.js':
      'public/hosted.js in hosted.js + public/hosted.js in user_scripts/api_script.js',
    'public/hosted.js':
      'public/hosted.js in hosted.js + public/hosted.js in user_scripts/api_script.js',
    'absent.js':
      'nothing | said missing absent.js does not exist. Check the user_scripts.api_script field | errors 1'
  },
  themeExperiment: {
    '.envrc':
      'nothing | said private .envrc is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    '.npmrc':
      'nothing | said private .npmrc is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    '.env':
      'nothing | said private .env is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    '.env.local':
      'nothing | said private .env.local is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    '.env.css':
      'nothing | said private .env.css is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    '.env.local.css':
      'nothing | said private .env.local.css is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    'a/../.envrc':
      'nothing | said private .envrc is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    'a/../.env.css':
      'nothing | said private .env.css is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    '/.env.css':
      'nothing | said private .env.css is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    '../outside.css':
      'nothing | said outside ../outside.css is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    'a/../../outside.css':
      'nothing | said outside ../outside.css is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    'linked-out.css':
      'nothing | said outside linked-out.css is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    'node_modules/pkg/.env':
      'nothing | said private node_modules/pkg/.env is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    'node_modules/pkg/.env.css':
      'nothing | said private node_modules/pkg/.env.css is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    '.git/tool.css':
      'nothing | said private .git/tool.css is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    'node_modules/pkg/theme.css':
      'node_modules/pkg/theme.css in theme_experiment/theme.css',
    'linked-in.css': 'inside.css in theme_experiment/linked-in.css',
    '.env.example': 'nothing | errors 1',
    '.env.example.css':
      'nothing | said private .env.example.css is not bundled. Check the theme_experiment.stylesheet field | errors 1',
    'ok.css': 'ok.css in theme_experiment/ok.css',
    '/hosted.css': 'public/hosted.css in hosted.css',
    'public/hosted.css': 'public/hosted.css in hosted.css',
    'absent.css':
      'nothing | said missing absent.css does not exist. Check the theme_experiment.stylesheet field | errors 1'
  },
  webAccessibleScript: {
    '.envrc': 'nothing',
    '.env.js': 'nothing',
    '../outside.js': 'nothing',
    'linked-out.js': 'nothing',
    'node_modules/pkg/.env.js': 'nothing',
    'node_modules/pkg/lib.js':
      'node_modules/pkg/lib.js in node_modules/pkg/lib.js',
    'ok.js': 'ok.js in ok.js',
    'absent.js': 'nothing'
  },
  webAccessibleSheet: {
    '.envrc': 'nothing',
    '.env.css': 'nothing',
    '../outside.css': 'nothing',
    'linked-out.css': 'nothing',
    'node_modules/pkg/.env.css': 'nothing',
    'node_modules/pkg/theme.css':
      'node_modules/pkg/theme.css in node_modules/pkg/theme.css',
    'ok.css': 'ok.css in ok.css',
    'absent.css': 'nothing'
  }
}

describe.skipIf(!canLink).each(Object.keys(FIELDS))('%s', (key) => {
  it(
    'names each target',
    async () => {
      const actual = await tableFor(FIELDS[key])

      expect(actual).toEqual(EXPECTED[key])
    },
    TIMEOUT
  )
})

describe('the paths a Windows build names as not found', () => {
  it('are one path for a line and its JSON copy', () => {
    const file = 'C:\\Users\\RUNNER~1\\Temp\\project\\.env.js'
    const message = `.env.js does not exist.\nNOT FOUND ${file}`
    const printed = `${message}\n${JSON.stringify({diagnostics: [{message}]})}`

    expect(notFoundPaths(printed)).toEqual([file])
  })
})

describe('a manifest kept in src/', () => {
  // The fields are read from the manifest's folder, and the project root one
  // level up is still the project.
  async function rowsFor(fields: Record<string, unknown>) {
    const root = project({
      'src/popup.html': PAGE,
      'src/content.js':
        'globalThis.fromFile = "PLAIN-TEXT-of(src/content.js)"\n',
      'lib/shared.js': 'globalThis.fromFile = "PLAIN-TEXT-of(lib/shared.js)"\n',
      'lib/shared.css': 'a{content:"PLAIN-TEXT-of(lib/shared.css)"}\n',
      '.env.js': `globalThis.fromFile = "${MARKER}-of(.env.js)"\n`,
      'src/manifest.json': manifest(fields)
    })

    fs.rmSync(path.join(root, 'manifest.json'))
    fs.writeFileSync(
      path.join(path.dirname(root), 'outside.js'),
      `globalThis.fromFile = "${MARKER}-of(../outside.js)"\n`
    )

    const result = await build(root)
    const out = listOutput(path.join(root, 'dist', 'chrome'))
    const held: string[] = []

    for (const name of Object.keys(out).sort()) {
      for (const match of out[name].matchAll(/-of\(([^)]+)\)/g)) {
        held.push(`${match[1]} in ${withoutHash(name)}`)
      }
    }

    return {held, result, root}
  }

  it(
    'compiles a file beside it and a file of the project above it',
    async () => {
      const {held, result} = await rowsFor({
        content_scripts: [
          {
            matches: MATCHES,
            js: ['content.js', '../lib/shared.js'],
            css: ['../lib/shared.css']
          }
        ],
        background: {service_worker: '../lib/shared.js'}
      })

      expect(held).toEqual([
        'lib/shared.js in background/service_worker.js',
        'lib/shared.css in content_scripts/content-0.css',
        'src/content.js in content_scripts/content-0.js',
        'lib/shared.js in content_scripts/content-0.js'
      ])

      expect(result.errors).toBe(0)
    },
    TIMEOUT
  )

  it(
    'names a private file of the project and a file outside the project',
    async () => {
      const {held, result, root} = await rowsFor({
        content_scripts: [{matches: MATCHES, js: ['../.env.js']}],
        background: {service_worker: '../../outside.js'}
      })

      expect(held).toEqual([])
      // The terminal line names a file by its full path, and the JSON copy
      // names a project file from the project root.
      expect(notFoundPaths(result.printed)).toEqual(
        [
          path.join(path.dirname(root), 'outside.js'),
          path.join(root, '.env.js'),
          '.env.js'
        ].sort()
      )

      expect(result.errors).toBe(2)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})

describe('a file a compiled field names and the build withholds', () => {
  const times = (text: string, part: string) => text.split(part).length - 1

  // The JSON copy of a message doubles each Windows separator.
  const asWrittenAndAsJson = (text: string, part: string) => {
    const json = JSON.stringify(part).slice(1, -1)

    return times(text, part) + (json === part ? 0 : times(text, json))
  }

  it(
    'fails the build in words of its own, once for a file',
    async () => {
      const root = fixture(
        {
          name: 'two fields for two files',
          kind: 'js',
          manifest: () => ({
            content_scripts: [
              {matches: MATCHES, js: ['ok.js', '.env.js'], css: ['.env.css']}
            ],
            background: {service_worker: '.envrc'}
          })
        },
        ''
      )
      const result = await build(root)

      // The whole message a withheld file gets, once on the human channel
      // and once in the result the build returns.
      const message = (file: string, field: string) =>
        [
          `${file} is not bundled. Check the ${field} field in your manifest.json file.`,
          'The build never bundles env files, tooling files or repository files. Move the code into a file with another name.',
          '',
          `NOT FOUND ${file}`
        ].join('\n')
      const diagnostics = JSON.parse(
        result.printed.slice(result.printed.lastIndexOf('\n{"code"'))
      ).diagnostics as Array<{message: string; name: string}>

      expect(
        diagnostics.map((diagnostic) => diagnostic.message).sort()
      ).toEqual(
        [
          message('.env.css', 'content_scripts[0].css'),
          message('.env.js', 'content_scripts[0].js'),
          message('.envrc', 'background.service_worker')
        ].sort()
      )

      for (const diagnostic of diagnostics) {
        expect(diagnostic.name).toBe('ScriptsMissingFile')
      }

      // Once by its full path on the terminal, once from the project root
      // in the JSON copy.
      for (const file of ['.env.js', '.env.css', '.envrc']) {
        expect(
          asWrittenAndAsJson(
            result.printed,
            `NOT FOUND ${path.join(root, file)}`
          ),
          file
        ).toBe(1)

        expect(times(result.printed, `NOT FOUND ${file}`), file).toBe(1)
      }

      expect(result.errors).toBe(3)
      expect(result.shipped).toEqual([])
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})
