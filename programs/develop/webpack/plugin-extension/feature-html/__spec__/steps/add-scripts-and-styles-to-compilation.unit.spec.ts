import {describe, it, expect} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import {AddScriptsAndStylesToCompilation} from '../../steps/add-scripts-and-styles-to-compilation'

function makeTmp(name: string) {
  const tmp = path.join(__dirname, `.tmp-${name}`)
  fs.rmSync(tmp, {recursive: true, force: true})
  fs.mkdirSync(tmp, {recursive: true})
  return tmp
}

describe('AddScriptsAndStylesToCompilation', () => {
  it('creates entry per feature and includes assets when no public root exists', () => {
    const tmp = makeTmp('steps')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head><link rel="stylesheet" href="/styles.css"></head><body><script src="main.js"></script></body></html>`
    )
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    const compiler: any = {options: {mode: 'production', entry: {}}}
    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'feature/index': htmlPath}
    }).apply(compiler as any)
    expect(
      compiler.options.entry['feature/index'].import.some((p: string) =>
        p.endsWith('minimum-script-file')
      )
    ).toBe(false)
    expect(
      compiler.options.entry['feature/index'].import.some((p: string) =>
        p.endsWith('main.js')
      )
    ).toBe(true)
    // with no public/ dir, absolute url is included
    expect(
      compiler.options.entry['feature/index'].import.some((p: string) =>
        p.endsWith('/styles.css')
      )
    ).toBe(true)
  })

  it('injects HMR minimum script in development mode', () => {
    const tmp = makeTmp('steps-dev')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(htmlPath, `<html><head></head><body></body></html>`)
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    const compiler: any = {options: {mode: 'development', entry: {}}}
    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'feature/index': htmlPath}
    }).apply(compiler as any)
    expect(
      compiler.options.entry['feature/index'].import.some((p: string) =>
        p.includes('minimum-script-file')
      )
    ).toBe(true)
  })
})
