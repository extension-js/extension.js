import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {findDeclaredContentScriptFiles} from '../index'
import unplacedStyleImportLoader from '../unplaced-style-import-loader'

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-unplaced-style-'))
  )
  roots.push(root)

  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, contents)
  }

  return root
}

function run(root: string, file: string, declared: string[] = []) {
  const warnings: Error[] = []
  const resourcePath = path.join(root, file)
  const source = fs.readFileSync(resourcePath, 'utf8')
  const result = unplacedStyleImportLoader.call(
    {
      resourcePath,
      rootContext: root,
      getOptions: () => ({
        projectPath: root,
        declaredEntries: declared.map((name) => path.join(root, name))
      }),
      emitWarning: (warning: Error) => warnings.push(warning)
    },
    source
  )

  return {
    result,
    source,
    warnings: warnings.map((warning) => warning.message.replace(ANSI, ''))
  }
}

describe('unplaced-style-import-loader', () => {
  it('warns once for a declared content script, naming file, import and every way that works', () => {
    const root = project({
      'content/scripts.js':
        "import './styles.css'\nimport './theme.scss'\ndocument.body.append('hi')\n",
      'content/styles.css': '.a { color: red }\n',
      'content/theme.scss': '.b { color: blue }\n'
    })
    const {result, source, warnings} = run(root, 'content/scripts.js', [
      'content/scripts.js'
    ])

    expect(result).toBe(source)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      'A stylesheet imported only for its side effect styles nothing in a content script.'
    )

    expect(warnings[0]).toContain('PATH content/scripts.js:1')
    expect(warnings[0]).toContain("IMPORT import './styles.css'")
    expect(warnings[0]).toContain("IMPORT import './theme.scss'")
    expect(warnings[0]).toContain("import href from './styles.css'")
    expect(warnings[0]).toContain('<link rel="stylesheet">')
    expect(warnings[0]).toContain('content_scripts[].css')
    expect(warnings[0]).toContain('.module.css')
    expect(warnings[0]).toContain('data-extension-root')
  })

  it('reports on the compilation when the loader has one, named for the file', () => {
    const root = project({
      'content/scripts.js': "import './styles.css'\n",
      'content/styles.css': '.a { color: red }\n'
    })
    const sink: Array<Error & {file?: string}> = []
    const emitted: Error[] = []

    unplacedStyleImportLoader.call(
      {
        resourcePath: path.join(root, 'content', 'scripts.js'),
        rootContext: root,
        getOptions: () => ({projectPath: root, declaredEntries: []}),
        emitWarning: (warning: Error) => emitted.push(warning),
        _compilation: {warnings: sink}
      },
      "import './styles.css'\n"
    )

    expect(emitted).toEqual([])
    expect(sink).toHaveLength(1)
    expect(sink[0].name).toBe('CssUnplacedImport')
    expect(sink[0].file).toBe('content/scripts.js')
  })

  it('names only the remedy that works for a file registered at runtime', () => {
    const root = project({
      'scripts/hook.ts':
        "import './hook.css'\nconst host = document.createElement('div')\nhost.setAttribute('data-extension-root', 'true')\n",
      'scripts/hook.css': '.a { color: red }\n'
    })
    const {warnings} = run(root, 'scripts/hook.ts')

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('PATH scripts/hook.ts:1')
    expect(warnings[0]).toContain("import href from './hook.css'")
    expect(warnings[0]).not.toContain('content_scripts[].css')
    expect(warnings[0]).not.toContain('.module.css')
    expect(warnings[0]).not.toContain('data-extension-root')
  })

  it('warns for a module a content script imports, as an undeclared file', () => {
    const root = project({
      'content/scripts.js': "import './widget.js'\n",
      'content/widget.js': "import './widget.css'\n",
      'content/widget.css': '.a { color: red }\n'
    })
    const {warnings} = run(root, 'content/widget.js', ['content/scripts.js'])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('PATH content/widget.js:1')
    expect(warnings[0]).not.toContain('content_scripts[].css')
  })

  it('stays quiet for a declared script that marks a shadow host itself', () => {
    const root = project({
      'content/scripts.js':
        "import './styles.css'\nconst host = document.createElement('div')\nhost.setAttribute('data-extension-root', 'true')\nhost.attachShadow({mode: 'open'})\n",
      'content/styles.css': '.a { color: red }\n'
    })
    const {warnings} = run(root, 'content/scripts.js', ['content/scripts.js'])

    expect(warnings).toEqual([])
  })

  it('stays quiet for a declared script whose imported module marks the host', () => {
    const root = project({
      'content/scripts.js':
        "import './styles.css'\nimport {createHost} from './lib/host'\ncreateHost()\n",
      'content/lib/host.js':
        "export function createHost() {\n  const host = document.createElement('div')\n  host.id = 'extension-root'\n  host.attachShadow({mode: 'open'})\n}\n",
      'content/styles.css': '.a { color: red }\n'
    })
    const {warnings} = run(root, 'content/scripts.js', ['content/scripts.js'])

    expect(warnings).toEqual([])
  })

  it('stays quiet when the value is read, for a CSS module and for ?url', () => {
    const root = project({
      'content/value.js':
        "import href from './styles.css'\nconsole.log(href)\n",
      'content/fetched.js':
        "import './styles.css'\nfetch(new URL('./styles.css', import.meta.url))\n",
      'content/module.js':
        "import styles from './styles.module.css'\nimport './other.module.css'\nconsole.log(styles)\n",
      'content/query.js':
        "import href from './styles.css?url'\nimport './styles.css?url'\nconsole.log(href)\n",
      'content/plain.js': "console.log('no import at all')\n"
    })

    for (const file of [
      'content/value.js',
      'content/fetched.js',
      'content/module.js',
      'content/query.js',
      'content/plain.js'
    ]) {
      expect(run(root, file, [file]).warnings, file).toEqual([])
    }
  })
})

describe('findDeclaredContentScriptFiles', () => {
  it('resolves every declared file for the target browser', () => {
    const root = project({
      'src/manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'declared',
        version: '1.0.0',
        content_scripts: [
          {matches: ['<all_urls>'], js: ['content/a.js', 'content/b.ts']},
          {matches: ['<all_urls>'], css: ['content/only.css']},
          {matches: ['<all_urls>'], js: ['content/main.js'], world: 'MAIN'}
        ]
      }),
      'src/content/a.js': '',
      'src/content/b.ts': '',
      'src/content/main.js': ''
    })

    expect(
      findDeclaredContentScriptFiles(
        path.join(root, 'src', 'manifest.json'),
        'chrome',
        root
      )
    ).toEqual([
      path.join(root, 'src', 'content', 'a.js'),
      path.join(root, 'src', 'content', 'b.ts'),
      path.join(root, 'src', 'content', 'main.js')
    ])
  })

  it('answers with nothing for a manifest it cannot read', () => {
    expect(
      findDeclaredContentScriptFiles('/nowhere/manifest.json', 'chrome', '/')
    ).toEqual([])
  })
})
