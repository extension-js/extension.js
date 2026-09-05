import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// The raw tmpdir on purpose: on macOS it is a symlink, and the content-script
// issuer index must match the sheet to its script through it.
const SUITE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-cs-css-urls-')
)

const MATCHES = 'https://fonts.example/*'
const FONT_BYTES = Buffer.from('probe-woff2-bytes')
const IMAGE_BYTES = Buffer.from('bg-png-bytes')

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

const SHEET_RULES = [
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

function writeFixture(
  name: string,
  manifestVersion: 2 | 3,
  sheet: 'plain' | 'module' = 'plain'
): string {
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

  if (sheet === 'module') {
    // A CSS module: the class map reaches JavaScript, the scoped text
    // reaches the page through the sibling stylesheet chunk.
    write(
      root,
      'src/content.js',
      [
        // Every class is used: an unused one is dropped in production and
        // the parity check would then warn for a reason this spec is not about.
        "import {anchor, badge, inline, remote, versioned} from './styles.module.css'",
        'document.documentElement.classList.add(badge)',
        "console.log('module', versioned, inline, remote, anchor)",
        ''
      ].join('\n')
    )
    write(root, 'src/styles.module.css', SHEET_RULES)
  } else {
    // Both ways a script reaches its sheet: the side-effect import the
    // wrapper hydrates, and the fetch(new URL()) the content-custom-font
    // example uses.
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
    write(root, 'src/styles.css', SHEET_RULES)
  }
  write(root, 'src/background.js', "console.log('bg')\n")
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

// Every file in dist with this basename, relative to dist. The public copier
// and the url() rewrite must agree on one name, so a target ships once.
function distFilesNamed(distDir: string, basename: string): string[] {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.name === basename) hits.push(path.relative(distDir, abs))
    }
  }
  walk(distDir)
  return hits.map((hit) => hit.split(path.sep).join('/')).sort()
}

// The sibling stylesheet chunk a content script's CSS modules land in.
function readContentScriptCssChunk(distDir: string): {
  name: string
  css: string
} {
  const dir = path.join(distDir, 'content_scripts')
  const chunk = fs
    .readdirSync(dir)
    .find((entry) => /^content-\d+.*\.css$/.test(entry))
  expect(chunk, `css chunk in ${dir}`).toBeTruthy()
  return {
    name: `content_scripts/${chunk}`,
    css: fs.readFileSync(path.join(dir, String(chunk)), 'utf8')
  }
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
  expect(font, `font target named in ${names.join(', ')}`).toBeTruthy()
  expect(fs.readFileSync(path.join(distDir, String(font)))).toEqual(FONT_BYTES)

  // A public-owned root ref keeps the copier's name at the dist root, and
  // that is the only copy of the file the build ships.
  const image = 'img/bg.png'
  expect(fs.readFileSync(path.join(distDir, image))).toEqual(IMAGE_BYTES)
  expect(distFilesNamed(distDir, 'bg.png')).toEqual([image])
  expect(distFilesNamed(distDir, 'probe.woff2')).toEqual([font])

  const resources = warResources(manifest)
  expect(resources).toContain(font)
  expect(resources).toContain(image)
  if (opts.matches) {
    expect(warMatchesFor(manifest, String(font))).toEqual(opts.matches)
    expect(warMatchesFor(manifest, image)).toEqual(opts.matches)
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
  if (process.env.KEEP_FIXTURE) {
    console.log('KEPT fixture at', SUITE_ROOT)
    return
  }
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

  it('production chrome MV3, CSS module: the scoped chunk names the extension root, the class map still reaches JavaScript', async () => {
    const root = writeFixture('mv3-chrome-prod-module', 3, 'module')
    const summary = await buildFixture(root, 'chrome', 'production')
    expect(summary.errors_count).toBe(0)
    // The public-owned file is registered to the module under the copier's
    // name, and that must stay silent: same name, same bytes.
    expect(summary.warnings_count).toBe(0)

    const {distDir, manifest, source} = readBuilt(root, 'chrome')
    const chunk = readContentScriptCssChunk(distDir)

    // The injected text: nothing left that resolves against the host page.
    expect(chunk.css).not.toMatch(BARE_URL)
    expect(chunk.css).not.toMatch(/url\(\s*["']?\/assets\//)
    const font = 'assets/src/fonts/probe.woff2'
    const image = 'img/bg.png'
    expect(chunk.css).toContain(`__EXTENSIONJS_EXTENSION_ROOT__/${font}`)
    expect(chunk.css).toContain(
      `__EXTENSIONJS_EXTENSION_ROOT__/${font}?v=2#frag`
    )
    expect(chunk.css).toContain(`__EXTENSIONJS_EXTENSION_ROOT__/${image}`)
    expect(chunk.css).toContain('data:image/gif;base64,R0lGOD')
    expect(chunk.css).toContain('https://cdn.example/x.png')
    expect(chunk.css).toContain('url(#gradient)')

    // Targets ship once, at the names the chunk uses, and are reachable.
    expect(fs.readFileSync(path.join(distDir, font))).toEqual(FONT_BYTES)
    expect(fs.readFileSync(path.join(distDir, image))).toEqual(IMAGE_BYTES)
    expect(distFilesNamed(distDir, 'probe.woff2')).toEqual([font])
    expect(distFilesNamed(distDir, 'bg.png')).toEqual([image])
    const resources = warResources(manifest)
    expect(resources).toContain(font)
    expect(resources).toContain(image)
    expect(resources).toContain(chunk.name)
    expect(warMatchesFor(manifest, font)).toEqual([MATCHES])
    expect(warMatchesFor(manifest, image)).toEqual([MATCHES])

    // The module still scopes its classes and hands the map to JavaScript:
    // every selector in the chunk is a value in the bundle's export map.
    const scoped = Array.from(
      chunk.css.matchAll(/\.([A-Za-z0-9_-]+)\s*\{/g),
      (match) => match[1]
    )
    expect(scoped).toHaveLength(5)
    for (const authored of [
      'badge',
      'versioned',
      'inline',
      'remote',
      'anchor'
    ]) {
      expect(scoped).not.toContain(authored)
    }
    for (const name of scoped) {
      expect(source).toContain(JSON.stringify(name))
    }

    // The bundle swaps the placeholder for the extension root when it
    // injects the chunk text.
    expect(source).toContain('__EXTENSIONJS_EXTENSION_ROOT__/')
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
