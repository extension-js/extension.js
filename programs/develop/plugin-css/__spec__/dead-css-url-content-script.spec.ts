import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {buildCssRules} from '../css-lib/build-css-rules'
import deadCssUrlLoader from '../dead-css-url-loader'

const tempDirs: string[] = []

afterEach(() => {
  delete process.env.EXTENSION_STRICT_REFS
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dead-url-cs-'))
  tempDirs.push(dir)
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}', 'utf8')
  return dir
}

function runLoader(projectPath: string, resourcePath: string, source: string) {
  const warnings: Error[] = []
  const errors: Error[] = []
  const context = {
    resourcePath,
    getOptions: () => ({
      manifestPath: path.join(projectPath, 'manifest.json'),
      projectPath
    }),
    emitWarning: (warning: Error) => warnings.push(warning),
    emitError: (error: Error) => errors.push(error),
    _compilation: {warnings, errors}
  }

  const output = deadCssUrlLoader.call(context as never, source)
  return {output, warnings, errors}
}

// Regression: a content-script stylesheet is inlined as asset/inline, so rspack
// never parses it and the module-graph check can never see its url() children.
// A dead reference was silent there while the same string in a linked
// stylesheet warned, and that is how content-custom-font shipped four dead
// font references without a single build saying a word.
describe('dead url() in a content-script stylesheet', () => {
  it('warns, naming the file and the reference, and never rewrites the css', () => {
    const dir = createProject()
    const stylesheet = path.join(dir, 'content', 'styles.css')
    const source = '.probe { background-image: url("/missing-probe.png"); }'

    const {output, warnings} = runLoader(dir, stylesheet, source)

    // The sheet leaves as a runtime module; a dead ref rides through verbatim.
    expect(output).toContain(JSON.stringify(source))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('/missing-probe.png')
    expect(warnings[0].message).toContain('content/styles.css')
    expect(warnings[0].message).toContain('EXTENSION_STRICT_REFS=true')
    // A stylesheet path is a web path. path.relative hands back
    // `content\\styles.css` on Windows, which printed the same defect two ways.
    expect(warnings[0].message).not.toContain('\\')
  })

  it('escalates to a compilation error under EXTENSION_STRICT_REFS', () => {
    process.env.EXTENSION_STRICT_REFS = 'true'
    const dir = createProject()
    const stylesheet = path.join(dir, 'content', 'styles.css')

    const {warnings, errors} = runLoader(
      dir,
      stylesheet,
      '.probe { background-image: url("/missing-probe.png"); }'
    )

    expect(warnings).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })

  it('stays quiet for a reference that resolves, and for remote or data urls', () => {
    const dir = createProject()
    fs.mkdirSync(path.join(dir, 'content'), {recursive: true})
    fs.writeFileSync(path.join(dir, 'content', 'logo.png'), '', 'utf8')
    fs.mkdirSync(path.join(dir, 'public', 'fonts'), {recursive: true})
    fs.writeFileSync(path.join(dir, 'public', 'fonts', 'a.woff2'), '', 'utf8')

    const {warnings} = runLoader(
      dir,
      path.join(dir, 'content', 'styles.css'),
      [
        '.a { background-image: url("./logo.png"); }',
        '.b { background-image: url("/fonts/a.woff2"); }',
        '.c { background-image: url("https://example.com/x.png"); }',
        '.d { background-image: url("data:image/gif;base64,R0lGOD"); }',
        '.e { background-image: url(//cdn.example.com/x.png); }'
      ].join('\n')
    )

    expect(warnings).toHaveLength(0)
  })

  it('reports each distinct dead reference once, however often it repeats', () => {
    const dir = createProject()

    const {warnings} = runLoader(
      dir,
      path.join(dir, 'content', 'styles.css'),
      [
        '.a { background-image: url("/gone-one.png"); }',
        '.b { background-image: url("/gone-one.png"); }',
        '.c { background-image: url("/gone-two.png"); }'
      ].join('\n')
    )

    expect(warnings).toHaveLength(2)
  })

  it('is wired onto the inlined rules only, never onto emitted stylesheets', async () => {
    const dir = createProject()
    const manifestPath = path.join(dir, 'manifest.json')

    const inlined = await buildCssRules(
      dir,
      'production',
      {useSass: false, useLess: false},
      {nonModuleType: 'asset/inline', issuer: () => true, manifestPath}
    )
    const emitted = await buildCssRules(
      dir,
      'production',
      {useSass: false, useLess: false},
      {nonModuleType: 'css', issuer: () => true, manifestPath}
    )

    const carriesScan = (rules: typeof inlined) =>
      rules.filter((rule) =>
        JSON.stringify(rule.use || []).includes('dead-css-url-loader')
      )

    // Every inlined-sheet rule carries it; the css/module siblings resolve
    // their url() through the module graph and would double-report.
    expect(carriesScan(inlined).length).toBe(
      inlined.filter((rule) => rule.type === 'javascript/auto').length
    )
    expect(carriesScan(inlined).length).toBeGreaterThan(0)
    expect(carriesScan(emitted)).toHaveLength(0)
  })
})
