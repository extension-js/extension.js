import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A scripts/ file is injected into a page by the scripting API, so a chunk it
// loads through import() is fetched by that page from the extension origin.
// The injection target is unknown at build time, so the built manifest must
// list the chunk as web accessible to every origin, as dev already does.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(manifestVersion: 2 | 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-scripts-dyn-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'scripts-dyn', version: '0.0.0'})
  )
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.writeFileSync(
    path.join(root, 'scripts', 'greet.js'),
    'export const greet = () => "INJECTED_DYN_GREETING"\n'
  )
  fs.writeFileSync(
    path.join(root, 'scripts', 'inject.js'),
    'import("./greet.js").then(({greet}) => console.log(greet()))\n'
  )
  // scripts/ enrolls only the files the extension names somewhere, so the
  // background injects it the way a real extension does.
  fs.writeFileSync(
    path.join(root, 'background.js'),
    [
      'chrome.action?.onClicked?.addListener((tab) => {',
      '  chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["scripts/inject.js"]})',
      '})'
    ].join('\n') + '\n'
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: manifestVersion,
      name: 'scripts-dyn',
      version: '1.0.0',
      permissions: manifestVersion === 3 ? ['scripting'] : [],
      background:
        manifestVersion === 3
          ? {service_worker: 'background.js'}
          : {scripts: ['background.js']},
      ...(manifestVersion === 2
        ? {browser_specific_settings: {gecko: {id: 'scripts-dyn@example.com'}}}
        : {})
    })
  )
  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    const summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  const distDir = path.join(root, 'dist', browser)
  const files = fs.readdirSync(distDir, {recursive: true}).map(String)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  const chunk = files.find(
    (file) =>
      file.endsWith('.js') &&
      file !== path.join('scripts', 'inject.js') &&
      fs
        .readFileSync(path.join(distDir, file), 'utf8')
        .includes('INJECTED_DYN_GREETING')
  )
  return {manifest, files, chunk: chunk?.split(path.sep).join('/')}
}

function warCovers(
  manifest: {manifest_version: number; web_accessible_resources?: unknown},
  file: string
) {
  const war = manifest.web_accessible_resources
  const covers = (pattern: string) =>
    pattern === file ||
    (pattern.includes('*') &&
      new RegExp(
        `^${pattern
          .replace(/[.+^${}()|\\]/g, '\\$&')
          .split('*')
          .join('.*')}$`
      ).test(file))
  if (manifest.manifest_version === 3) {
    return (
      war as Array<{resources: string[]; matches: string[]}> | undefined
    )?.some(
      (group) =>
        group.resources.some(covers) && group.matches.includes('<all_urls>')
    )
  }
  return (war as string[] | undefined)?.some(covers)
}

describe('a scripts/ file chunk loaded through import()', () => {
  for (const manifestVersion of [3, 2] as const) {
    const browser = manifestVersion === 3 ? 'chrome' : 'firefox'
    it(`MV${manifestVersion} production: the chunk ships and is web accessible to every origin`, async () => {
      const built = await build(project(manifestVersion), browser)
      expect(built.chunk, built.files.join(',')).toBeDefined()
      expect(built.files).toContain(path.join('scripts', 'inject.js'))
      expect(
        warCovers(built.manifest, String(built.chunk)),
        JSON.stringify(built.manifest.web_accessible_resources)
      ).toBe(true)
    }, 180_000)
  }
})
