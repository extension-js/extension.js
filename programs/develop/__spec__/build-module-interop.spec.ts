import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-module-interop-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'module-interop', version: '0.0.0'})
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string, mode: 'production' | 'development') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

describe('imports migrated projects rely on', () => {
  it('gives a CSS module a default export next to its named exports', async () => {
    const root = project({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'css-default',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      }),
      'popup.html':
        '<html><body><div id="root"></div><script src="./popup.js"></script></body></html>',
      'popup.js':
        "import styles from './popup.module.css'\nimport {other} from './popup.module.css'\ndocument.getElementById('root').className = styles.root + ' ' + other\n",
      'popup.module.css': '.root { color: red }\n.other { color: blue }\n'
    })

    const summary = await build(root, 'production')
    expect(summary.errors_count).toBe(0)

    const js = fs.readFileSync(
      path.join(root, 'dist', 'chrome', 'action', 'index.js'),
      'utf8'
    )
    expect(js).toContain('className')
  })

  // The default export comes from namedExports false, and rspack then lists
  // it beside the class names: a namespace import carries a default key.
  it('lists the default object beside the class names on a CSS module namespace import', async () => {
    const root = project({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'css-namespace',
        version: '1.0.0',
        background: {service_worker: 'background.js'}
      }),
      'background.js': [
        "import * as styles from './x.module.css'",
        "import defaultStyles from './x.module.css'",
        "import {title} from './x.module.css'",
        'globalThis.__shape = {',
        '  keys: Object.keys(styles).sort(),',
        '  sameDefault: styles.default === defaultStyles,',
        '  viaNamed: title === styles.title && title === defaultStyles.title,',
        "  subTitle: styles['sub-title']",
        '}',
        ''
      ].join('\n'),
      'x.module.css': '.title { color: red }\n.sub-title { color: blue }\n'
    })

    const summary = await build(root, 'production')
    expect(summary.errors_count).toBe(0)

    const worker = fs.readFileSync(
      path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
      'utf8'
    )
    const sandbox: Record<string, unknown> = {console}
    sandbox.globalThis = sandbox
    sandbox.self = sandbox
    vm.runInNewContext(worker, sandbox)

    const shape = sandbox.__shape as Record<string, unknown>
    expect(shape.keys).toEqual(['default', 'sub-title', 'title'])
    expect(shape.sameDefault).toBe(true)
    expect(shape.viaNamed).toBe(true)
    expect(shape.subTitle).toMatch(/^\S+$/)
  })

  it('links a namespace import of a JSON object in production the way development does', async () => {
    const root = project({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'json-namespace',
        version: '1.0.0',
        background: {service_worker: 'background.js'}
      }),
      'config.json': JSON.stringify({categoryList: ['a', 'b']}),
      'background.js':
        "import * as C from './config.json'\nconsole.log(C.categoryList.filter(Boolean))\n"
    })

    for (const mode of ['development', 'production'] as const) {
      const summary = await build(root, mode)
      expect(summary.errors_count, mode).toBe(0)
    }
  })
})
