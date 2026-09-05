import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Real path: rspack resolves symlinks on module paths and the content-script
// issuer index keys on the manifest path as given, so a symlinked tmpdir
// would never match the stylesheet to its script.
const SUITE_ROOT = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-build-cs-css-urls-'))
)

const MATCHES = 'https://fonts.example/*'
const FONT_BYTES = Buffer.from('probe-woff2-bytes')
const IMAGE_BYTES = Buffer.from('bg-png-bytes')

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture(name: string, manifestVersion: 2 | 3): string {
  const root = path.join(SUITE_ROOT, name)
  fs.mkdirSync(root, {recursive: true})

  write(
    root,
    'package.json',
    JSON.stringify(
      {
        private: true,
        name: `extjs-build-cs-css-urls-${name}`,
        version: '0.0.0',
        type: 'module'
      },
      null,
      2
    )
  )

  const background =
    manifestVersion === 3
      ? {background: {service_worker: 'src/background.js'}}
      : {background: {scripts: ['src/background.js']}}

  write(
    root,
    'manifest.json',
    JSON.stringify(
      {
        manifest_version: manifestVersion,
        name: `Build Spec, content-script css url() ${name}`,
        version: '1.0.0',
        ...background,
        content_scripts: [{matches: [MATCHES], js: ['src/content.js']}]
      },
      null,
      2
    )
  )

  // Both ways a script reaches its sheet: the side-effect import the wrapper
  // hydrates, and the fetch(new URL()) the content-custom-font example uses.
  write(
    root,
    'src/content.js',
    [
      "import './styles.css'",
      "const sheet = new URL('./styles.css', import.meta.url)",
      "console.log('sheet', sheet.href)",
      ''
    ].join('\n')
  )
  write(root, 'src/background.js', "console.log('bg')\n")

  write(
    root,
    'src/styles.css',
    [
      '@font-face {',
      '  font-family: "Probe";',
      '  src: url(./fonts/probe.woff2) format("woff2");',
      '}',
      '.badge { background-image: url("/img/bg.png"); font-family: "Probe"; }',
      '.versioned { background-image: url("./fonts/probe.woff2?v=2#frag"); }',
      '.inline { background-image: url(data:image/gif;base64,R0lGOD); }',
      '.remote { background-image: url("https://cdn.example/x.png"); }',
      '.anchor { fill: url(#gradient); }',
      ''
    ].join('\n')
  )
  write(root, 'src/fonts/probe.woff2', FONT_BYTES)
  write(root, 'public/img/bg.png', IMAGE_BYTES)

  return root
}

async function buildFixture(
  root: string,
  browser: 'chrome' | 'firefox',
  mode: 'production' | 'development'
) {
  const {extensionBuild} = await import('../command-build')

  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE

  try {
    return await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } finally {
    if (previousAuthorMode === undefined) {
      delete process.env.EXTENSION_AUTHOR_MODE
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
    }
    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

type BuiltManifest = {
  manifest_version: number
  content_scripts?: Array<{js?: string[]}>
  web_accessible_resources?:
    | string[]
    | Array<{resources: string[]; matches: string[]}>
}

function readBuilt(root: string, browser: 'chrome' | 'firefox') {
  const distDir = path.join(root, 'dist', browser)
  const manifestPath = path.join(distDir, 'manifest.json')
  expect(fs.existsSync(manifestPath), `missing ${manifestPath}`).toBe(true)
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  ) as BuiltManifest

  const rel = manifest.content_scripts?.[0]?.js?.[0]
  expect(rel, 'content script declared').toBeTruthy()
  const contentJs = path.join(distDir, String(rel))
  expect(fs.existsSync(contentJs), `missing ${contentJs}`).toBe(true)

  return {distDir, manifest, source: fs.readFileSync(contentJs, 'utf8')}
}

function warResources(manifest: BuiltManifest): string[] {
  const war = manifest.web_accessible_resources
  if (!war) return []
  if (manifest.manifest_version === 2) {
    return Array.isArray(war) && typeof war[0] === 'string'
      ? (war as string[])
      : []
  }
  return (war as Array<{resources: string[]}>).flatMap(
    (group) => group.resources || []
  )
}

function warMatchesFor(manifest: BuiltManifest, resource: string): string[] {
  const war = (manifest.web_accessible_resources || []) as Array<{
    resources: string[]
    matches: string[]
  }>
  return war
    .filter((group) => group.resources?.includes(resource))
    .flatMap((group) => group.matches || [])
}

// The emitted names the bundle carries, the same shape the WAR collector reads.
function emittedNamesIn(source: string): string[] {
  return Array.from(
    new Set(
      source.match(/assets\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/g) || []
    )
  )
}

// A url() that still starts with ./, ../ or a single / would resolve against
// the visited page once the text lands in a <style>. The optional backslash
// covers a dev bundle, where the module sits inside an eval string.
const BARE_URL = /url\(\s*(?:\\?["'])?(?:\.{1,2}\/|\/(?!\/))/

function expectResolvedTargets(
  built: ReturnType<typeof readBuilt>,
  opts: {matches?: string[]}
) {
  const {distDir, manifest, source} = built
  const names = emittedNamesIn(source)
  const font = names.find((name) => name.endsWith('/fonts/probe.woff2'))
  const image = names.find((name) => name.endsWith('/img/bg.png'))
  expect(font, `font target named in ${names.join(', ')}`).toBeTruthy()
  expect(image, `image target named in ${names.join(', ')}`).toBeTruthy()

  expect(fs.readFileSync(path.join(distDir, String(font)))).toEqual(FONT_BYTES)
  expect(fs.readFileSync(path.join(distDir, String(image)))).toEqual(
    IMAGE_BYTES
  )

  const resources = warResources(manifest)
  expect(resources).toContain(font)
  expect(resources).toContain(image)
  if (opts.matches) {
    expect(warMatchesFor(manifest, String(font))).toEqual(opts.matches)
    expect(warMatchesFor(manifest, String(image))).toEqual(opts.matches)
  }

  expect(source).not.toMatch(BARE_URL)
  expect(source).toContain(`__EXTENSIONJS_EXTENSION_ROOT__/${font}`)
  expect(source).toContain(`__EXTENSIONJS_EXTENSION_ROOT__/${font}?v=2#frag`)
  expect(source).toContain(`__EXTENSIONJS_EXTENSION_ROOT__/${image}`)
  expect(source).toContain('runtime.getURL')

  expect(source).toContain('data:image/gif;base64,R0lGOD')
  expect(source).toContain('https://cdn.example/x.png')
  expect(source).toContain('url(#gradient)')
}

afterAll(() => {
  fs.rmSync(SUITE_ROOT, {recursive: true, force: true})
})

describe('build: url() in a content-script stylesheet resolves to the extension (real rspack)', () => {
  it('production chrome MV3: targets are emitted, WAR-listed for the script pages, and the sheet names no host-relative url()', async () => {
    const root = writeFixture('mv3-chrome-prod', 3)
    const summary = await buildFixture(root, 'chrome', 'production')
    expect(summary.errors_count).toBe(0)

    expectResolvedTargets(readBuilt(root, 'chrome'), {matches: [MATCHES]})
  }, 120_000)

  it('production firefox MV2: the same targets ship in the flat WAR list', async () => {
    const root = writeFixture('mv2-firefox-prod', 2)
    const summary = await buildFixture(root, 'firefox', 'production')
    expect(summary.errors_count).toBe(0)

    expectResolvedTargets(readBuilt(root, 'firefox'), {})
  }, 120_000)

  it('development chrome MV3: the dev bundle carries the same resolved sheet', async () => {
    const root = writeFixture('mv3-chrome-dev', 3)
    const summary = await buildFixture(root, 'chrome', 'development')
    expect(summary.errors_count).toBe(0)

    const built = readBuilt(root, 'chrome')
    expectResolvedTargets(built, {})
    expect(
      warMatchesFor(built.manifest, emittedNamesIn(built.source)[0])
    ).toContain(MATCHES)
  }, 120_000)
})
