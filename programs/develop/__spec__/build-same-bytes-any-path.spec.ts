import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, afterEach, describe, expect, it} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'

// A production build tells its author that a reviewer can rebuild the source
// and match the bytes. The reviewer's CLI and checkout sit at other paths.
const tempFolder = trackTempFolders()
const developRoot = path.resolve(__dirname, '..')
const RULES_OUT = 'SAME_BYTES_RULES_OUT'
const previousRoot = process.env.EXTENSION_DEVELOP_ROOT

afterEach(() => {
  if (previousRoot === undefined) delete process.env.EXTENSION_DEVELOP_ROOT
  else process.env.EXTENSION_DEVELOP_ROOT = previousRoot

  delete process.env[RULES_OUT]
})

function project(root: string, manifestVersion: 2 | 3) {
  fs.mkdirSync(root, {recursive: true})

  const write = (file: string, text: string) =>
    fs.writeFileSync(path.join(root, file), text)

  write(
    'package.json',
    JSON.stringify({private: true, name: 'same-bytes', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: manifestVersion,
      name: 'Same bytes',
      version: '1.0.0',
      background:
        manifestVersion === 3
          ? {service_worker: 'background.js'}
          : {scripts: ['background.js']},
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content.js']}
      ],
      options_ui: {page: 'options.html'},
      ...(manifestVersion === 2
        ? {browser_specific_settings: {gecko: {id: 'same@example.com'}}}
        : {})
    })
  )

  write('shared.js', "export const label = (name) => 'SAME_BYTES ' + name\n")
  write('greet.js', "export const greet = (name) => 'LAZY_GREETING ' + name\n")
  write('badge.module.css', '.badge {\n  color: rebeccapurple;\n}\n')
  write('options.css', 'body {\n  margin: 0;\n}\n')
  write(
    'background.js',
    "import {label} from './shared.js'\n\nconsole.log(label('background'))\n"
  )

  write(
    'content.js',
    "import styles from './badge.module.css'\nimport {label} from './shared.js'\n\nexport default async function main() {\n  const {greet} = await import('./greet.js')\n  document.body.className = styles.badge\n  console.log(label('content'), greet('content'))\n}\n"
  )

  write(
    'options.html',
    '<html><head><link rel="stylesheet" href="./options.css"></head><body><script src="./options.js"></script></body></html>\n'
  )

  write(
    'options.js',
    "import {label} from './shared.js'\n\ndocument.title = label('options')\n"
  )

  // Records the loader paths the build ran with, so a test can tell which
  // install compiled it.
  write(
    'extension.config.js',
    `const fs = require('node:fs')

module.exports = {
  config: (config) => {
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.thisCompilation.tap('same-bytes-rules', () => {
          const out = process.env.${RULES_OUT}
          const rules = JSON.stringify(compiler.options.module.rules)
          if (out) fs.writeFileSync(out, rules)
        })
      }
    })

    return config
  }
}
`
  )

  return root
}

// The same compiled CLI at another absolute path. It sits below this package
// so the loaders it runs still resolve the dependencies installed here.
const installs: string[] = []

afterAll(() => {
  for (const install of installs.splice(0)) {
    fs.rmSync(install, {recursive: true, force: true})
  }
})

function relocatedInstall(...nested: string[]) {
  const cache = path.join(developRoot, 'node_modules', '.cache')

  fs.mkdirSync(cache, {recursive: true})

  const base = fs.mkdtempSync(path.join(cache, 'same-bytes-cli-'))
  const root = path.join(base, ...nested)

  installs.push(base)
  fs.mkdirSync(root, {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'extension-develop', version: '0.0.0'})
  )

  fs.cpSync(path.join(developRoot, 'dist'), path.join(root, 'dist'), {
    recursive: true
  })

  return root
}

// A real path, so each link case below decides where its link sits.
function projectFolder(...nested: string[]) {
  return path.join(fs.realpathSync(tempFolder('extjs-same-bytes-')), ...nested)
}

function canLink(): boolean {
  const probe = tempFolder('extjs-same-bytes-link-probe-')

  try {
    fs.mkdirSync(path.join(probe, 'target'))
    fs.symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'), 'dir')

    return true
  } catch {
    return false
  }
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const {extensionBuild} = await import('../command-build')
  const rulesOut = path.join(tempFolder('extjs-same-bytes-rules-'), 'rules')
  process.env[RULES_OUT] = rulesOut

  let outputPath = ''

  const summary = await extensionBuild(root, {
    browser,
    silent: true,
    install: false,
    mode: 'production',
    zip: true,
    sourceMaps: true
  } as any)
  expect(summary.errors_count).toBe(0)
  outputPath = String(summary.output_path)

  const dist = path.join(root, 'dist')
  const files: Record<string, string> = {}
  const packed = [
    ...fs.readdirSync(path.join(dist, browser), {recursive: true}).map(String),
    ...fs.readdirSync(dist).filter((file) => file.endsWith('.zip'))
  ]

  for (const file of packed) {
    const absolute = fs.existsSync(path.join(dist, browser, file))
      ? path.join(dist, browser, file)
      : path.join(dist, file)

    if (!fs.statSync(absolute).isFile()) continue

    files[file.split(path.sep).join('/')] = crypto
      .createHash('sha256')
      .update(fs.readFileSync(absolute))
      .digest('hex')
  }

  const zipName = Object.keys(files).find((file) => file.endsWith('.zip'))
  const zip = fs.readFileSync(path.join(dist, String(zipName)))

  return {files, zip, outputPath, rules: fs.readFileSync(rulesOut, 'utf8')}
}

// The time and date of every entry, read from the central directory.
function zipEntryTimes(zip: Buffer): Array<{time: number; date: number}> {
  const times: Array<{time: number; date: number}> = []

  for (let at = zip.indexOf('PK\x01\x02'); at !== -1; ) {
    times.push({
      time: zip.readUInt16LE(at + 12),
      date: zip.readUInt16LE(at + 14)
    })

    at = zip.indexOf('PK\x01\x02', at + 46)
  }

  return times
}

describe('a production build gives the same bytes from any path', () => {
  for (const manifestVersion of [3, 2] as const) {
    const browser = manifestVersion === 3 ? 'chrome' : 'firefox'

    it(`${browser}: two installs of the CLI at different paths build the same files and zip`, async () => {
      const root = project(projectFolder(), manifestVersion)
      const near = relocatedInstall()
      const far = relocatedInstall('a', 'much', 'deeper', 'folder')

      process.env.EXTENSION_DEVELOP_ROOT = near
      const first = await build(root, browser)

      process.env.EXTENSION_DEVELOP_ROOT = far
      const second = await build(root, browser)

      // Each build has to have run the loaders of its own install.
      expect(first.rules).toContain(JSON.stringify(near).slice(1, -1))
      expect(first.rules).not.toContain(JSON.stringify(far).slice(1, -1))
      expect(second.rules).toContain(JSON.stringify(far).slice(1, -1))

      // The fixture has to exercise what a path leaks into: an id-named chunk.
      expect(
        Object.keys(first.files).some((file) => /^\d+\.js$/.test(file)),
        Object.keys(first.files).join(',')
      ).toBe(true)

      expect(second.files).toEqual(first.files)
    }, 180_000)

    it(`${browser}: the same project at two different paths builds the same files and zip`, async () => {
      const first = await build(
        project(projectFolder(), manifestVersion),
        browser
      )
      const second = await build(
        project(projectFolder('a', 'deeper', 'checkout'), manifestVersion),
        browser
      )

      expect(second.files).toEqual(first.files)
    }, 180_000)
  }

  // Each case names the same kind of project through a different link.
  const linkedSpellings: Array<{
    name: string
    link: (base: string) => {real: string; linked: string}
  }> = [
    {
      name: 'a link to the project folder',
      link: (base) => {
        fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), 'dir')

        return {real: path.join(base, 'real'), linked: path.join(base, 'link')}
      }
    },
    {
      name: 'a link to a parent folder',
      link: (base) => {
        fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), 'dir')

        return {
          real: path.join(base, 'real', 'apps', 'ext'),
          linked: path.join(base, 'link', 'apps', 'ext')
        }
      }
    },
    {
      name: 'a workspace package linked into node_modules',
      link: (base) => {
        const real = path.join(base, 'real', 'packages', 'ext')
        const linked = path.join(base, 'real', 'node_modules', 'ext')

        fs.mkdirSync(path.dirname(real), {recursive: true})
        fs.mkdirSync(path.dirname(linked), {recursive: true})
        fs.symlinkSync(path.join('..', 'packages', 'ext'), linked, 'dir')

        return {real, linked}
      }
    }
  ]

  for (const manifestVersion of [3, 2] as const) {
    const browser = manifestVersion === 3 ? 'chrome' : 'firefox'

    for (const spelling of linkedSpellings) {
      it.skipIf(!canLink())(
        `${browser}: ${spelling.name} builds the same files and zip as the real path`,
        async () => {
          const base = projectFolder()

          fs.mkdirSync(path.join(base, 'real'), {recursive: true})

          const {real, linked} = spelling.link(base)

          project(real, manifestVersion)

          const byRealPath = await build(real, browser)
          const byLink = await build(linked, browser)

          // The fixture has to exercise what the link leaked into.
          expect(Object.keys(byRealPath.files)).toEqual(
            expect.arrayContaining([
              'content_scripts/content-0.css',
              'content_scripts/content-0.js.map',
              'options/index.html'
            ])
          )

          expect(byLink.files).toEqual(byRealPath.files)

          // What comes back still names the folder the way it was asked for.
          expect(byRealPath.outputPath).toBe(path.join(real, 'dist', browser))
          expect(byLink.outputPath).toBe(path.join(linked, 'dist', browser))
        },
        180_000
      )
    }
  }

  it('a zip of built files records no build time', async () => {
    const built = await build(project(projectFolder(), 3), 'chrome')
    const times = zipEntryTimes(built.zip)

    expect(times.length).toBeGreaterThan(3)
    // 1980-01-01 00:00:00, the first instant the format can record.
    expect(new Set(times.map(({time, date}) => `${date}:${time}`))).toEqual(
      new Set(['33:0'])
    )
  }, 180_000)
})
