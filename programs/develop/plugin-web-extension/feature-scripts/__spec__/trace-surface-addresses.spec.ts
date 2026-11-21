import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {asCompiler, type TapCallback} from '../../__spec__/helpers/rspack-fakes'
import {
  extractRuntimeSurfaceReferences,
  TraceRuntimeLoadedFiles
} from '../steps/trace-runtime-loaded-files'

// A diagnostic as the step under test reports it.
type Reported = Error & {file?: string}

// An asset as the fake compilation keeps it.
type EmittedAsset = {name: string; source: {source(): string | Buffer}}

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, {recursive: true, force: true})
  }
})

function createTempProject(
  files: Record<string, string>,
  manifest: Record<string, unknown> = {}
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-surface-'))
  tempDirs.push(dir)
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'fixture', ...manifest}),
    'utf8'
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content, 'utf8')
  }

  return dir
}

async function runTrace(
  projectDir: string,
  assets: Record<string, string>,
  entry: Record<string, unknown> = {},
  browser: 'chrome' | 'firefox' = 'chrome',
  // Entry scripts by the on-demand chunk files each one reaches.
  lazy: Array<{entry: string[]; chunks: string[]}> = []
) {
  const emitted = new Map<string, EmittedAsset>(
    Object.entries(assets).map(([name, src]) => [
      name,
      {name, source: {source: () => src}}
    ])
  )
  const compilation = {
    warnings: [] as Reported[],
    errors: [] as Reported[],
    fileDependencies: new Set<string>(),
    modules: [],
    entrypoints: new Map(
      lazy.map(({entry: files, chunks}, index) => [
        `entry-${index}`,
        {
          getFiles: () => files,
          childrenIterable: [
            {chunks: [{files: new Set(chunks)}], childrenIterable: []}
          ]
        }
      ])
    ),
    getAsset: (name: string) => emitted.get(name),
    getAssets: () => Array.from(emitted.values()),
    emitAsset: (name: string, source: EmittedAsset['source']) => {
      emitted.set(name, {name, source})
    },
    updateAsset: (name: string, source: EmittedAsset['source']) => {
      emitted.set(name, {name, source})
    },
    createChildCompiler: () => {
      throw new Error('unexpected child compilation in a unit fixture')
    },
    hooks: {
      processAssets: {tapPromise: (_opts: unknown, fn: TapCallback) => fn()}
    }
  }
  const compiler = asCompiler({
    options: {entry, mode: 'production'},
    hooks: {
      thisCompilation: {tap: (_n: string, fn: TapCallback) => fn(compilation)}
    }
  })

  new TraceRuntimeLoadedFiles({
    manifestPath: path.join(projectDir, 'manifest.json'),
    browser
  }).apply(compiler)

  await Promise.resolve()

  const textOf = (name: string) =>
    String(emitted.get(name)?.source.source() ?? '')

  return {emitted, compilation, textOf}
}

const WORKER = 'background/service_worker.js'
const SCRIPTS = 'background/scripts.js'
const POPUP = {
  'action/index.html':
    '<html><head><script src="/action/index.js"></script></head></html>'
}

const copies = (emitted: Map<string, unknown>, ext: string) =>
  [...emitted.keys()].filter((name) => name.endsWith(ext)).sort()

describe('what a runtime surface call reads', () => {
  it('tells a page from an image from a DevTools panel', () => {
    const source = [
      'chrome.action.setPopup({popup: "pop.html"})',
      'browser.sidebarAction.setPanel({panel: "side.html"})',
      'chrome.tabs.create({url: "tab.html"})',
      'chrome.action.setIcon({path: {16: "on.png"}})',
      'chrome.notifications.create({type: "basic", iconUrl: "bell.png"})',
      'chrome.devtools.panels.create("Name", "panel.png", "panel.html")'
    ].join('\n')

    expect(
      extractRuntimeSurfaceReferences(source).map(
        (ref) => `${ref.reads} ${ref.literal}`
      )
    ).toEqual([
      'page pop.html',
      'page side.html',
      'page tab.html',
      'image bell.png',
      'image on.png',
      'panel panel.png',
      'panelPage panel.html'
    ])
  })
})

describe('an icon a moved script sets, on chrome', () => {
  const worker = (dir: string, source = 'background.js') => ({
    'background/service_worker': {import: [path.join(dir, source)]}
  })
  const manifest = {background: {service_worker: 'background.js'}}

  it('ships a root-level name beside the worker that asks for it', async () => {
    const dir = createTempProject(
      {'background.js': '', 'on.png': 'png', 'bell.png': 'png'},
      manifest
    )
    const {emitted, compilation} = await runTrace(
      dir,
      {
        [WORKER]:
          'chrome.action.setIcon({path:"on.png"});chrome.notifications.create({type:"basic",iconUrl:"./bell.png",title:"t",message:"m"})'
      },
      worker(dir)
    )

    expect(copies(emitted, '.png')).toEqual([
      'background/bell.png',
      'background/on.png'
    ])

    expect(compilation.warnings).toHaveLength(0)
  })

  it('ships one copy per form: beside the worker, or at the root', async () => {
    const dir = createTempProject(
      {
        'background.js': '',
        'icons/bare.png': 'png',
        'icons/dotted.png': 'png',
        'icons/up.png': 'png',
        'icons/rooted.png': 'png'
      },
      manifest
    )
    const {emitted, textOf} = await runTrace(
      dir,
      {
        [WORKER]:
          'chrome.action.setIcon({path:"icons/bare.png"});chrome.action.setIcon({path:{16:"./icons/dotted.png"}});chrome.action.setIcon({path:"../icons/up.png"});chrome.action.setIcon({path:"/icons/rooted.png"})'
      },
      worker(dir)
    )

    expect(copies(emitted, '.png')).toEqual([
      'background/icons/bare.png',
      'background/icons/dotted.png',
      'icons/rooted.png',
      'icons/up.png'
    ])

    // The paths stay as written: the files moved, not the code.
    expect(textOf(WORKER)).toContain('"./icons/dotted.png"')
  })

  it('finds the file beside the source, at the root, or in public', async () => {
    const dir = createTempProject(
      {
        'src/worker.js': '',
        'src/near.png': 'png',
        'far.png': 'png',
        'public/shared.png': 'png'
      },
      {background: {service_worker: 'src/worker.js'}}
    )
    const {emitted, compilation} = await runTrace(
      dir,
      {
        [WORKER]:
          'chrome.action.setIcon({path:"near.png"});chrome.action.setIcon({path:"far.png"});chrome.action.setIcon({path:"shared.png"})'
      },
      worker(dir, 'src/worker.js')
    )

    expect(copies(emitted, '.png')).toEqual([
      'background/far.png',
      'background/near.png',
      'background/shared.png'
    ])

    expect(compilation.warnings).toHaveLength(0)
  })

  it('ships it beside a moved popup, which asks from its own folder', async () => {
    const dir = createTempProject(
      {'popup.html': '<script src="popup.js"></script>', 'on.png': 'png'},
      {action: {default_popup: 'popup.html'}}
    )
    const {emitted} = await runTrace(dir, {
      ...POPUP,
      'action/index.js': 'chrome.action.setIcon({path:"on.png"})'
    })

    expect(copies(emitted, '.png')).toEqual(['action/on.png'])
  })

  it('keeps the root copy for a script no page names', async () => {
    const dir = createTempProject({'icons/on.png': 'png'})
    const {emitted} = await runTrace(dir, {
      'chunks/lazy.js': 'chrome.action.setIcon({path:"icons/on.png"})'
    })

    // Who loads the chunk is not known, so the file stays where it was.
    expect(copies(emitted, '.png')).toEqual(['icons/on.png'])
  })

  it('ships it beside the worker and the page that load a lazy chunk', async () => {
    const dir = createTempProject(
      {
        'background.js': '',
        'popup.html': '<script src="popup.js"></script>',
        'on.png': 'png',
        'shared.png': 'png'
      },
      {...manifest, action: {default_popup: 'popup.html'}}
    )
    const {emitted, compilation} = await runTrace(
      dir,
      {
        ...POPUP,
        [WORKER]: '',
        'action/index.js': '',
        '186.js': 'chrome.action.setIcon({path:"on.png"})',
        '319.js': 'chrome.action.setIcon({path:"shared.png"})'
      },
      worker(dir),
      'chrome',
      [
        {entry: [WORKER], chunks: ['186.js', '319.js']},
        {entry: ['action/index.js', 'action/index.css'], chunks: ['319.js']}
      ]
    )

    // Chrome asks beside the worker or the page that runs the chunk, never
    // beside the chunk, which the build keeps at the root.
    expect(copies(emitted, '.png')).toEqual([
      'action/shared.png',
      'background/on.png',
      'background/shared.png'
    ])

    expect(compilation.warnings).toHaveLength(0)
  })

  it('keeps the root copy when one loader of a lazy chunk is unknown', async () => {
    const dir = createTempProject(
      {'background.js': '', 'on.png': 'png'},
      manifest
    )
    const {emitted} = await runTrace(
      dir,
      {
        [WORKER]: '',
        'content_scripts/content-0.js': '',
        '186.js': 'chrome.action.setIcon({path:"on.png"})'
      },
      worker(dir),
      'chrome',
      [
        {entry: [WORKER], chunks: ['186.js']},
        {entry: ['content_scripts/content-0.js'], chunks: ['186.js']}
      ]
    )

    expect(copies(emitted, '.png')).toEqual(['on.png'])
  })

  it('warns with the place the author would keep an absent file', async () => {
    const dir = createTempProject({'background.js': ''}, manifest)
    const {compilation} = await runTrace(
      dir,
      {[WORKER]: 'chrome.action.setIcon({path:"gone.png"})'},
      worker(dir)
    )

    expect(compilation.warnings).toHaveLength(1)
    expect(compilation.warnings[0].name).toBe('RuntimeSetSurfaceFileMissing')
    expect(compilation.warnings[0].message).toContain('NOT FOUND')
    expect(compilation.warnings[0].message).toContain('gone.png')
    expect(compilation.warnings[0].message).not.toContain('background/gone')
  })
})

describe('a page a moved script opens', () => {
  const FILES = {
    'ui/popup.html': '<script src="popup.js"></script>',
    'welcome.html': '<p>root</p>'
  }
  const manifest = {action: {default_popup: 'ui/popup.html'}}
  const opener = (url: string) => ({
    ...POPUP,
    'action/index.js': `chrome.tabs.create({url:"${url}"})`
  })

  it('reads every form from the root on chrome, as written', async () => {
    const dir = createTempProject(FILES, manifest)

    for (const url of ['welcome.html', './welcome.html', '../welcome.html']) {
      const {emitted, textOf, compilation} = await runTrace(dir, opener(url))

      expect(copies(emitted, 'welcome.html')).toEqual(['welcome.html'])
      expect(textOf('action/index.js')).toContain(`"${url}"`)
      expect(compilation.warnings).toHaveLength(0)
    }
  })

  it('still finds a file kept beside the page when the root has none', async () => {
    const dir = createTempProject(
      {'ui/popup.html': '', 'ui/near.html': '<p>near</p>'},
      manifest
    )
    const {emitted, textOf} = await runTrace(dir, opener('./near.html'))

    expect(copies(emitted, 'near.html')).toEqual(['ui/near.html'])
    expect(textOf('action/index.js')).toContain('"/ui/near.html"')
  })

  it('reads beside the page on firefox, so the path is rooted', async () => {
    const dir = createTempProject(
      {...FILES, 'ui/near.html': '<p>near</p>'},
      manifest
    )

    for (const url of ['near.html', './near.html']) {
      const {emitted, textOf} = await runTrace(dir, opener(url), {}, 'firefox')

      expect(copies(emitted, 'near.html')).toEqual(['ui/near.html'])
      expect(textOf('action/index.js')).toContain('"/ui/near.html"')
    }

    // What the page was opened with stays on the rooted path.
    const hashed = await runTrace(dir, opener('near.html?a=1#b'), {}, 'firefox')

    expect(hashed.textOf('action/index.js')).toContain('"/ui/near.html?a=1#b"')

    const up = await runTrace(dir, opener('../welcome.html'), {}, 'firefox')

    expect(copies(up.emitted, 'welcome.html')).toEqual(['welcome.html'])
    expect(up.textOf('action/index.js')).toContain('"/welcome.html"')
  })

  it('leaves background scripts alone on firefox, they run at the root', async () => {
    const dir = createTempProject(
      {'src/background.js': '', 'welcome.html': '<p>root</p>'},
      {background: {scripts: ['src/background.js']}}
    )
    const source =
      'browser.tabs.create({url:"./welcome.html"});browser.browserAction.setIcon({path:"on.png"})'
    fs.writeFileSync(path.join(dir, 'on.png'), 'png')

    const {emitted, textOf, compilation} = await runTrace(
      dir,
      {[SCRIPTS]: source},
      {'background/scripts': {import: [path.join(dir, 'src/background.js')]}},
      'firefox'
    )

    expect(copies(emitted, 'welcome.html')).toEqual(['welcome.html'])
    expect(copies(emitted, '.png')).toEqual(['on.png'])
    expect(textOf(SCRIPTS)).toBe(source)
    expect(compilation.warnings).toHaveLength(0)
  })

  it('ships an icon at the root and beside the page on firefox', async () => {
    const dir = createTempProject(
      {'popup.html': '', 'on.png': 'png'},
      {action: {default_popup: 'popup.html'}}
    )
    const {emitted, compilation} = await runTrace(
      dir,
      {
        ...POPUP,
        'action/index.js':
          'browser.action.setIcon({path:"on.png"});browser.action.setIcon({path:"gone.png"})'
      },
      {},
      'firefox'
    )

    expect(copies(emitted, '.png')).toEqual(['action/on.png', 'on.png'])
    // One warning for the absent file, not one per place it could sit.
    expect(compilation.warnings).toHaveLength(1)
  })

  it('finds an icon kept beside a page in a folder, with no warning', async () => {
    const dir = createTempProject(
      {'ui/popup.html': '', 'ui/icons/on.png': 'png'},
      {action: {default_popup: 'ui/popup.html'}}
    )
    const {emitted, textOf, compilation} = await runTrace(
      dir,
      {
        ...POPUP,
        'action/index.js': 'browser.action.setIcon({path:"./icons/on.png"})'
      },
      {},
      'firefox'
    )

    expect(copies(emitted, '.png')).toEqual(['action/icons/on.png'])
    expect(textOf('action/index.js')).toContain('"./icons/on.png"')
    expect(compilation.warnings).toHaveLength(0)
  })
})

describe('a page a DevTools page shows as a panel', () => {
  const DEVTOOLS = {
    'devtools/index.html':
      '<html><head><script src="/devtools/index.js"></script></head></html>'
  }
  const manifest = {devtools_page: 'dev/devtools.html'}
  const entry = (dir: string) => ({
    'devtools/index': {import: [path.join(dir, 'dev/devtools.js')]}
  })
  const CALL =
    'chrome.devtools.panels.create("One","icon.png","./panel.html");chrome.devtools.panels.create("Two","icon.png","./only.html")'

  it('stays as written on chrome when the root has the file, and is rooted when only the folder does', async () => {
    const dir = createTempProject(
      {
        'dev/devtools.html': '<script src="devtools.js"></script>',
        'dev/devtools.js': '',
        'panel.html': '<p>root</p>',
        'dev/panel.html': '<p>beside</p>',
        'dev/only.html': '<p>beside</p>',
        'icon.png': 'png'
      },
      manifest
    )
    const {emitted, textOf} = await runTrace(
      dir,
      {...DEVTOOLS, 'devtools/index.js': CALL},
      entry(dir)
    )

    // Chrome shows a panel page from the root for every spelling, so the
    // root file is the one the author's path already names.
    expect(copies(emitted, '.html')).toEqual([
      'dev/only.html',
      'devtools/index.html',
      'panel.html'
    ])

    expect(String(emitted.get('panel.html')?.source.source())).toBe(
      '<p>root</p>'
    )

    expect(textOf('devtools/index.js')).toContain('"./panel.html"')
    expect(textOf('devtools/index.js')).toContain('"/dev/only.html"')
  })

  it('keeps the earlier handling on firefox, which no run measured', async () => {
    const dir = createTempProject(
      {
        'dev/devtools.html': '<script src="devtools.js"></script>',
        'dev/devtools.js': '',
        'panel.html': '<p>root</p>',
        'dev/panel.html': '<p>beside</p>',
        'dev/only.html': '<p>beside</p>',
        'icon.png': 'png'
      },
      manifest
    )
    const {textOf} = await runTrace(
      dir,
      {...DEVTOOLS, 'devtools/index.js': CALL},
      entry(dir),
      'firefox'
    )

    expect(textOf('devtools/index.js')).toContain('"/dev/panel.html"')
    expect(textOf('devtools/index.js')).toContain('"/dev/only.html"')
  })
})
