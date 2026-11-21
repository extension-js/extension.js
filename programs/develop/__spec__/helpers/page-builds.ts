import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {diagnosticCode} from '../../lib/diagnostic-code'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'
import {sessionOf} from './dev-session'

// One whole build of a project through the real config, minus the browser
// plugins, read back as what a page ships and what its entry imports.

const DEVELOP_ROOT = path.resolve(__dirname, '..', '..')

export type PageBuildShape =
  | 'production build'
  | 'development build'
  | 'development session'

export interface PageBuild {
  // Every emitted file, by its path under the output folder.
  files: string[]
  // Each emitted page, as written.
  html: Record<string, string>
  // Each page entry and what it imports, in order.
  entries: Record<string, {imports: string[]; layer?: string}>
  // The page loaders among this package's own, one row per rule.
  pageLoaders: string[]
  // What resolve.alias points at this package's own files.
  ownAliases: Record<string, string>
  // A hash of every emitted file with this machine's folders written out.
  hashes: Record<string, string>
  errors: string[]
  // Each warning, with the code its name maps to.
  warnings: Array<{name: string; code?: string; file?: string; message: string}>
}

export const PAGE_FILES: Record<string, string> = {
  'package.json': JSON.stringify({name: 'page-builds', private: true}),
  'manifest.json': JSON.stringify({
    manifest_version: 3,
    name: 'page-builds',
    version: '1.0.0',
    action: {default_popup: 'popup.html'},
    options_page: 'options.html',
    background: {service_worker: 'background.js'},
    content_scripts: [{matches: ['https://example.com/*'], js: ['content.js']}],
    sandbox: {pages: ['sandbox.html']}
  }),
  'popup.html':
    '<!doctype html><html><head><link rel="stylesheet" href="./popup.css"></head>' +
    '<body><div id="root"></div><script src="./popup.js"></script></body></html>',
  'popup.js':
    'import {label} from "./label.js"\ndocument.getElementById("root").textContent = label\n',
  'label.js': 'export const label = "PAGE_WITH_A_SCRIPT"\n',
  'popup.css': 'body{color:red}\n',
  'options.html':
    '<!doctype html><html><head><title>options</title></head><body>PAGE_WITH_NO_SCRIPT</body></html>',
  'sandbox.html':
    '<!doctype html><html><head></head><body><script src="./sandbox.js"></script></body></html>',
  'sandbox.js': 'console.log("SANDBOX_PAGE")\n',
  'background.js': 'console.log("BACKGROUND")\n',
  'content.js': 'console.log("CONTENT_SCRIPT")\n',
  'pages/deep/nested.html':
    '<!doctype html><html><head><link rel="stylesheet" href="./nested.css"></head>' +
    '<body><script type="module" src="./nested.js"></script></body></html>',
  'pages/deep/nested.js': 'console.log("NESTED_PAGE")\n',
  'pages/deep/nested.css': 'body{color:blue}\n'
}

export function writePageProject(
  root: string,
  files: Record<string, string | Buffer> = PAGE_FILES
) {
  const past = new Date(Date.now() - 60000)

  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'))

    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, contents)
    fs.utimesSync(file, past, past)
  }
}

function listFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir, {withFileTypes: true})
    .flatMap((entry) =>
      entry.isDirectory()
        ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`]
    )
    .sort()
}

// A content hash follows the module paths of the machine that built it.
function withoutContentHash(file: string): string {
  return file.replace(/\.[0-9a-f]{8}\./, '.HASH.')
}

// A file of this package or of a dependency, named the same on any machine.
export function portablePath(file: string, root: string): string {
  const [bare, query] = file.split('?')
  const posix = bare.split(path.sep).join('/')
  const developDist = `${DEVELOP_ROOT.split(path.sep).join('/')}/dist/`
  const projectRoot = `${root.split(path.sep).join('/')}/`
  const suffix = query === undefined ? '' : '?<query>'

  if (posix.startsWith(developDist)) {
    return `<develop>/${posix.slice(developDist.length).replace(/\.(?:c|m)?js$/, '')}${suffix}`
  }

  if (posix.startsWith(projectRoot)) {
    return `<project>/${posix.slice(projectRoot.length)}${suffix}`
  }

  const dependency = posix.lastIndexOf('/node_modules/')

  return dependency === -1
    ? `${posix}${suffix}`
    : `<dependency>/${posix.slice(dependency + '/node_modules/'.length)}${suffix}`
}

const PAGE_LOADER = /^<develop>\/ensure-hmr-for-scripts$/

function pageLoadersOf(compiler: Compiler, root: string): string[] {
  const found: string[] = []

  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return

    if (Array.isArray(value)) {
      for (const item of value) visit(item)

      return
    }

    const rule = value as Record<string, unknown>

    if (typeof rule.loader === 'string') {
      const name = portablePath(rule.loader, root)
      if (PAGE_LOADER.test(name)) found.push(name)
    }

    visit(rule.use)
    visit(rule.oneOf)
    visit(rule.rules)
  }

  visit(compiler.options.module.rules)

  return found.sort()
}

const SHAPES: Record<
  PageBuildShape,
  {mode: 'development' | 'production'; metadataCommand: 'dev' | 'build'}
> = {
  'production build': {mode: 'production', metadataCommand: 'build'},
  'development build': {mode: 'development', metadataCommand: 'build'},
  'development session': {mode: 'development', metadataCommand: 'dev'}
}

export const SESSION_PORT = 45678

export async function buildPages(
  root: string,
  shape: PageBuildShape,
  browser = 'chrome'
): Promise<PageBuild> {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(
    root,
    'dist',
    `${browser}-${shape.replace(/ /g, '-')}`
  )
  const session = shape === 'development session'
  const config = webpackConfig(projectStructure, {
    browser,
    ...SHAPES[shape],
    silent: true,
    output: {clean: false, path: distPath},
    ...(session
      ? {
          session: sessionOf({
            port: SESSION_PORT,
            instanceId: 'page-builds-instance',
            controlPort: SESSION_PORT + 1
          })
        }
      : {})
  } as Parameters<typeof webpackConfig>[1])

  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-ready-contract'
  )

  config.stats = false

  // The dev server names itself in the config it compiles. A session read
  // without one gets no client, so the shape under test names it too.
  if (session) {
    ;(config as {devServer?: unknown}).devServer = {
      host: '127.0.0.1',
      port: SESSION_PORT
    }
  }

  const compiler = rspack(config)
  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close(() => {
        if (error) return reject(error)
        if (!result) return reject(new Error('page builds: no stats'))

        resolve(result)
      })
    })
  })

  const onDisk = listFiles(distPath)
  const files = onDisk.map(withoutContentHash)
  const pages = files.filter((file) => file.endsWith('.html'))
  const entries: PageBuild['entries'] = {}
  const pageNames = new Set(pages.map((file) => file.replace(/\.html$/, '')))

  for (const [name, entry] of Object.entries(
    compiler.options.entry as Record<
      string,
      {import?: string[]; layer?: string | null}
    >
  )) {
    if (!pageNames.has(name)) continue

    entries[name] = {
      imports: (entry.import || []).map((file) => portablePath(file, root)),
      ...(entry.layer ? {layer: entry.layer} : {})
    }
  }

  const ownAliases: Record<string, string> = {}

  for (const [from, to] of Object.entries(
    (compiler.options.resolve.alias || {}) as Record<string, unknown>
  )) {
    if (typeof to !== 'string') continue

    const target = portablePath(to, root)

    if (target.startsWith('<develop>/')) {
      ownAliases[portablePath(from, root)] = target
    }
  }

  const here = [
    [root, '<project>'],
    [path.resolve(DEVELOP_ROOT, '..', '..'), '<repo>']
  ]
  const hashes: Record<string, string> = {}

  for (const file of onDisk) {
    let text = fs.readFileSync(path.join(distPath, file), 'latin1')

    for (const [folder, name] of here) text = text.split(folder).join(name)

    hashes[withoutContentHash(file)] = crypto
      .createHash('sha256')
      .update(text)
      .digest('hex')
  }

  return {
    files,
    html: Object.fromEntries(
      pages.map((file) => [
        file,
        fs.readFileSync(path.join(distPath, file), 'utf8')
      ])
    ),
    entries,
    pageLoaders: pageLoadersOf(compiler, root),
    ownAliases,
    hashes,
    errors: stats.compilation.errors.map((error) => String(error.message)),
    warnings: stats.compilation.warnings.map(
      (warning: Error & {file?: string}) => ({
        name: warning.name,
        code: diagnosticCode(warning),
        ...(warning.file ? {file: warning.file} : {}),
        message: String(warning.message)
      })
    )
  }
}
