import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  extractRuntimeSurfaceReferences,
  TraceRuntimeLoadedFiles
} from '../steps/trace-runtime-loaded-files'

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
  browser: 'chrome' | 'firefox' = 'chrome'
) {
  const emitted = new Map(
    Object.entries(assets).map(([name, src]) => [
      name,
      {name, source: {source: () => src}}
    ])
  )
  const compilation: any = {
    warnings: [],
    errors: [],
    fileDependencies: new Set<string>(),
    modules: [],
    getAsset: (name: string) => emitted.get(name),
    getAssets: () => Array.from(emitted.values()),
    emitAsset: (name: string, source: any) => {
      emitted.set(name, {name, source})
    },
    updateAsset: (name: string, source: any) => {
      emitted.set(name, {name, source})
    },
    createChildCompiler: () => {
      throw new Error('unexpected child compilation in a unit fixture')
    },
    hooks: {
      processAssets: {tapPromise: (_opts: any, fn: any) => fn()}
    }
  }
  const compiler: any = {
    options: {entry, mode: 'production'},
    hooks: {
      thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
    }
  }

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
      'panel panel.html'
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
