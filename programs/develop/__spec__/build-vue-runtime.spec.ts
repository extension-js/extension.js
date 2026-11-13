import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {workspacePackage} from './helpers/workspace-package'

// A Vue project must ship the runtime-only build: the full build carries the
// template compiler, which extension CSP cannot run and the Firefox store
// rejects. The fixture copies the real vue package and stamps each bundler
// entry with a marker, so the emitted bundle names the entry it was built from.
const VUE_PACKAGE = workspacePackage('vue')
const VUE_SCOPE = workspacePackage('@vue/runtime-dom')
const hasVue = VUE_PACKAGE !== undefined && VUE_SCOPE !== undefined

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

function stamp(file: string, entry: string) {
  fs.appendFileSync(
    file,
    `\nglobalThis.__extjsVueEntry = ${JSON.stringify(entry)}\n`
  )
}

function installVue(root: string) {
  const target = path.join(root, 'node_modules', 'vue')
  fs.cpSync(VUE_PACKAGE as string, target, {
    recursive: true,
    dereference: true
  })

  stamp(path.join(target, 'dist', 'vue.runtime.esm-bundler.js'), 'runtime')
  stamp(path.join(target, 'dist', 'vue.esm-bundler.js'), 'full')
  stamp(path.join(target, 'dist', 'vue.cjs.js'), 'cjs')
  stamp(path.join(target, 'dist', 'vue.cjs.prod.js'), 'cjs')

  // The @vue/* packages the copy imports resolve through this workspace.
  fs.symlinkSync(
    path.dirname(VUE_SCOPE as string),
    path.join(root, 'node_modules', '@vue'),
    'dir'
  )

  return JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
    .version as string
}

function project() {
  // vue-loader's include is the project path as spelled, so the fixture
  // lives at the real path like the sources the bundler hands the loader.
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'extjs-vue-runtime-')
  )
  roots.push(root)
  const version = installVue(root)

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: 'vue-runtime',
      version: '0.0.0',
      dependencies: {vue: version}
    })
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Vue runtime',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  write(
    root,
    'popup.html',
    '<!doctype html><title>POPUP</title><div id="root"></div><script type="module" src="./popup.js"></script>'
  )

  write(
    root,
    'popup.js',
    "import {createApp} from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#root')\n"
  )

  // Options API on purpose: data() and methods are the code path the
  // __VUE_OPTIONS_API__ flag tree-shakes away when it is off.
  write(
    root,
    'App.vue',
    '<template><p @click="bump">{{ label }} {{ count }}</p></template>\n' +
      '<script>\nexport default {\n  data() {\n    return {count: 0, label: "clicks"}\n  },\n' +
      '  methods: {\n    bump() {\n      this.count += 1\n    }\n  }\n}\n</script>\n'
  )

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  let summary: {errors_count: number}

  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } catch (error) {
    throw new Error(`build failed: ${String(error)}\n${lines.join('\n')}`)
  } finally {
    console.log = originalLog
    console.error = originalError
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  if (summary.errors_count > 0) {
    throw new Error(`build failed:\n${lines.join('\n')}`)
  }

  const distDir = path.join(root, 'dist', 'chrome')
  const readAll = (ext: string) =>
    fs
      .readdirSync(distDir, {recursive: true} as any)
      .map((entry) => String(entry))
      .filter((entry) => entry.endsWith(ext))
      .map((entry) => fs.readFileSync(path.join(distDir, entry), 'utf8'))
      .join('\n')

  return {
    emitted: readAll('.js'),
    css: readAll('.css'),
    output: lines.join('\n')
  }
}

// vue-loader re-issues every <style> block as an inline match resource
// request from a `.vue.css` issuer; the dead-url guard once took that for a
// url() to a missing file and cancelled it, so no block reached the sheet.
function styledProject() {
  const root = project()
  write(
    root,
    'theme.css',
    '.probe_theme { outline: 3px dashed rgb(44, 55, 66); }\n'
  )

  write(
    root,
    'App.vue',
    '<template><p class="probe_plain probe_scoped">{{ label }}</p></template>\n' +
      '<script>\nexport default {\n  data() {\n    return {label: "clicks"}\n  }\n}\n</script>\n' +
      "<style>\n.probe_plain { font-family: 'ExtjsProbeFont', monospace; }\n</style>\n" +
      '<style scoped>\n.probe_scoped { letter-spacing: 0.0517em; }\n</style>\n' +
      '<style src="./theme.css"></style>\n'
  )

  return root
}

// A content script's stylesheet is a JavaScript module. A component's style
// block reached that rule as one @import line and failed the JavaScript parse.
function contentScriptProject() {
  const root = project()
  const packageJson = path.join(root, 'package.json')

  // The block is imported for its effect alone, which this flag would drop.
  fs.writeFileSync(
    packageJson,
    JSON.stringify({
      ...JSON.parse(fs.readFileSync(packageJson, 'utf8')),
      sideEffects: false
    })
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Vue content styles',
      version: '1.0.0',
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content/isolated.js']},
        {
          matches: ['https://example.com/*'],
          js: ['content/main.js'],
          world: 'MAIN'
        }
      ]
    })
  )

  const lanes = [
    ['content/isolated.js', 'Isolated', 'rgb(11, 12, 13)'],
    ['content/main.js', 'Main', 'rgb(21, 22, 23)'],
    ['scripts/injected.js', 'Injected', 'rgb(31, 32, 33)']
  ]

  for (const [entry, name, color] of lanes) {
    write(
      root,
      entry,
      `import {createApp} from 'vue'\nimport Widget from '../src/${name}.vue'\n` +
        "createApp(Widget).mount(document.body.appendChild(document.createElement('div')))\n"
    )

    write(
      root,
      `src/${name}.vue`,
      `<template><p class="probe_${name}">styled</p></template>\n` +
        `<style scoped>\n.probe_${name} { color: ${color}; }\n</style>\n` +
        `<style>\n.plain_${name} { outline-color: ${color}; }\n</style>\n`
    )
  }

  return root
}

// A MAIN world entry's deeper imports ride a layer of their own, and a
// block's rule has to follow the component down into it.
function deepImportProject() {
  const root = project()

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Vue deep content styles',
      version: '1.0.0',
      content_scripts: [
        {
          matches: ['https://example.com/*'],
          js: ['content/main.js'],
          world: 'MAIN'
        }
      ]
    })
  )

  write(root, 'content/main.js', "import {mid} from '../src/mid.js'\nmid()\n")
  write(
    root,
    'src/mid.js',
    "import {deep} from './deep.js'\nexport function mid() {\n  deep()\n}\n"
  )

  write(
    root,
    'src/deep.js',
    "import {createApp} from 'vue'\nimport Widget from './Deep.vue'\n" +
      'export function deep() {\n' +
      "  createApp(Widget).mount(document.body.appendChild(document.createElement('div')))\n" +
      '}\n'
  )

  write(
    root,
    'src/Deep.vue',
    '<template><p class="probe_Deep">styled</p></template>\n' +
      '<style scoped>\n.probe_Deep { color: rgb(41, 42, 43); }\n</style>\n'
  )

  return root
}

// A *.ce.vue component carries each block as text in its `styles` option,
// which is how its author puts the sheet inside a shadow root.
function customElementProject() {
  const root = project()

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Vue inline styles',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content/isolated.js']}
      ]
    })
  )

  const mount =
    "import {createApp} from 'vue'\nimport Widget from '$FILE'\n" +
    "const root = document.body.appendChild(document.createElement('div')).attachShadow({mode: 'open'})\n" +
    'for (const css of Widget.styles) {\n' +
    "  root.appendChild(document.createElement('style')).textContent = css\n" +
    '}\n' +
    "createApp(Widget).mount(root.appendChild(document.createElement('div')))\n"

  write(root, 'popup.js', mount.replace('$FILE', './src/Page.ce.vue'))
  write(
    root,
    'content/isolated.js',
    mount.replace('$FILE', '../src/Content.ce.vue')
  )

  for (const [name, color] of [
    ['Page', 'rgb(51, 52, 53)'],
    ['Content', 'rgb(61, 62, 63)']
  ]) {
    write(
      root,
      `src/${name}.ce.vue`,
      `<template><p class="probe_${name}">styled</p></template>\n` +
        `<style scoped>\n.probe_${name} { color: ${color}; }\n</style>\n`
    )
  }

  return root
}

// <style module>: vue-loader refuses the block wherever native CSS is on.
function styleModuleProject() {
  const root = project()

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Vue style modules',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content/isolated.js']}
      ]
    })
  )

  write(
    root,
    'content/isolated.js',
    "import {createApp} from 'vue'\nimport Widget from '../src/Content.vue'\n" +
      "createApp(Widget).mount(document.body.appendChild(document.createElement('div')))\n"
  )

  write(
    root,
    'App.vue',
    '<script setup>\nimport {useCssModule} from "vue"\nconst named = useCssModule("named")\n</script>\n' +
      '<template><p :class="[$style.probe_page, named.probe_named]">styled</p></template>\n' +
      '<style module>\n.probe_page { letter-spacing: 0.0731em; }\n</style>\n' +
      '<style module="named">\n.probe_named { word-spacing: 0.0732em; }\n</style>\n'
  )

  write(
    root,
    'src/Content.vue',
    '<template><p :class="$style.probe_content">styled</p></template>\n' +
      '<style module>\n.probe_content { letter-spacing: 0.0733em; }\n</style>\n'
  )

  return root
}

function emittedScript(root: string, file: string) {
  return fs.readFileSync(path.join(root, 'dist', 'chrome', file), 'utf8')
}

describe.skipIf(!hasVue)('Vue production build', () => {
  it('bundles the runtime-only entry, keeps the Options API and no global shim', async () => {
    const built = await build(project())

    // The marker only the runtime entry carries is in, the markers of the
    // full ESM entry and the CommonJS main are out.
    expect(built.emitted).toMatch(/__extjsVueEntry\s*=\s*["']runtime["']/)
    expect(built.emitted).not.toMatch(/__extjsVueEntry\s*=\s*["']full["']/)
    expect(built.emitted).not.toMatch(/__extjsVueEntry\s*=\s*["']cjs["']/)

    // The component's data() and methods reach the bundle, and so does the
    // runtime code that applies them: a false flag strips beforeCreate and mixins.
    expect(built.emitted).toContain('clicks')
    expect(built.emitted).toMatch(/\.beforeCreate\b/)
    expect(built.emitted).toMatch(/\bmixins\b/)

    // global resolves to globalThis at build time, never through a Function shim.
    expect(built.emitted).not.toMatch(/Function\(\s*["']return this["']\s*\)/)
  }, 180_000)

  it('ships every <style> block of a component in the page sheet', async () => {
    const built = await build(styledProject())

    expect(built.css).toContain('ExtjsProbeFont')
    expect(built.css).toMatch(
      /\.probe_scoped\[data-v-[0-9a-f]+\]\{letter-spacing:\.0517em\}/
    )

    expect(built.css).toContain('.probe_theme{outline:3px dashed')
    expect(built.output).not.toContain('exists nowhere')
  }, 180_000)

  it("adds a content script component's style blocks to the document", async () => {
    const root = contentScriptProject()
    const built = await build(root)

    expect(built.output).not.toContain('Module parse failed')

    const lanes = [
      ['content_scripts/content-0.js', 'Isolated', 'rgb(11, 12, 13)'],
      ['content_scripts/content-1.js', 'Main', 'rgb(21, 22, 23)'],
      ['scripts/injected.js', 'Injected', 'rgb(31, 32, 33)']
    ]

    for (const [file, name, color] of lanes) {
      const script = emittedScript(root, file)

      // The scoped rule carries the component's id and the plain one does not.
      expect(script).toContain(`.probe_${name}[data-v-`)
      expect(script).toContain(`] { color: ${color}`)
      expect(script).toContain(`.plain_${name} { outline-color: ${color}`)

      // One <style> element per block, which is what applies it on the page.
      expect(script.match(/data-extjs-sfc-style/g)?.length).toBeGreaterThan(1)
      expect(script).toContain('createElement("style")')
    }

    // A content script ships no sheet of its own for a block.
    expect(built.css).not.toContain('probe_')
  }, 180_000)

  it('adds a block imported three levels below a MAIN world entry', async () => {
    const root = deepImportProject()
    await build(root)

    const script = emittedScript(root, 'content_scripts/content-0.js')

    expect(script).toContain('.probe_Deep[data-v-')
    expect(script).toContain('] { color: rgb(41, 42, 43)')
    expect(script).toContain('createElement("style")')
  }, 180_000)

  it('hands a custom element component its blocks as text, on a page and in a content script', async () => {
    const root = customElementProject()
    const built = await build(root)

    const lanes = [
      ['action/index.js', 'Page', 'rgb(51, 52, 53)'],
      ['content_scripts/content-0.js', 'Content', 'rgb(61, 62, 63)']
    ]

    for (const [file, name, color] of lanes) {
      const script = emittedScript(root, file)
      const styles = /styles",\["((?:[^"\\]|\\.)*)"\]/.exec(script)?.[1] ?? ''

      // The text is the scoped rule itself, never the request that builds it.
      expect(styles).toContain(`.probe_${name}[data-v-`)
      expect(styles).toContain(`color: ${color}`)
      expect(styles).not.toContain('import')
    }

    // The component places an inline block itself, so nothing else may.
    expect(built.emitted).not.toContain('stylePostLoader')
    expect(built.emitted).not.toContain('data-extjs-sfc-style')
    expect(built.css).not.toContain('probe_')
  }, 180_000)

  it('builds <style module> blocks as CSS modules, on a page and in a content script', async () => {
    const root = styleModuleProject()
    const built = await build(root)

    expect(built.output).not.toContain('is currently not supported')

    // Each rule ships under a generated class the component reads by name.
    expect(built.css).toMatch(/\.[\w-]+\{letter-spacing:\.0731em\}/)
    expect(built.css).toMatch(/\.[\w-]+\{word-spacing:\.0732em\}/)
    expect(built.css).toMatch(/\.[\w-]+\{letter-spacing:\.0733em\}/)
    expect(built.css).not.toContain('.probe_')

    for (const name of ['probe_page', 'probe_named', 'probe_content']) {
      expect(built.emitted).toMatch(new RegExp(`${name}:"[\\w-]+"`))
    }

    // The content script's sheet is the one its manifest entry declares.
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, 'dist', 'chrome', 'manifest.json'),
        'utf8'
      )
    )

    expect(manifest.content_scripts[0].css).toEqual([
      'content_scripts/content-0.css'
    ])

    expect(emittedScript(root, 'content_scripts/content-0.css')).toMatch(
      /letter-spacing:\.0733em/
    )
  }, 180_000)
})
