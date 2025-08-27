import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeEach, afterEach, expect} from 'vitest'

// Minimal mock loader context
const makeLoaderContext = (resourcePath: string, manifestPath: string) => ({
  resourcePath,
  getOptions: () => ({
    manifestPath,
    mode: 'development',
    includeList: {},
    excludeList: {}
  })
})

describe('add-content-script-wrapper loader', () => {
  const tmpRoot = path.join(__dirname, '.tmp-add-wrapper')
  beforeEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
    fs.mkdirSync(tmpRoot, {recursive: true})
  })
  afterEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
  })

  it('wraps React content scripts with a framework-specific wrapper', async () => {
    const projectDir = path.join(tmpRoot, 'p1')
    const contentDir = path.join(projectDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})
    const manifestPath = path.join(projectDir, 'manifest.json')
    // Add a package.json with react to trigger React wrapper
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'p1',
        version: '1.0.0',
        dependencies: {react: '18.0.0'}
      })
    )
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            js: ['content/scripts.tsx']
          }
        ]
      })
    )
    const resourcePath = path.join(projectDir, 'content', 'scripts.tsx')

    const {default: loader} = await import(
      '../steps/add-content-script-wrapper'
    )

    const ctx = makeLoaderContext(resourcePath, manifestPath)

    const source = `
'use shadow-dom'
import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'
import './styles.css'

export default function contentScript() {
  return (container: HTMLElement) => {
    const mountingPoint = ReactDOM.createRoot(container)
    mountingPoint.render(<ContentApp />)
    return () => mountingPoint.unmount()
  }
}
`

    // @ts-expect-error - calling loader with mocked context
    const result = loader.call(ctx, source) as string

    expect(result).toContain('React Content Script Wrapper - Auto-generated')
    expect(result).toContain('class ReactContentScriptWrapper')
    expect(result).toContain('injectStyles')
    // Ensure generated code uses escaped newlines in concatenations
    expect(result).toContain("+ '\\n'")
  })

  it('does not wrap files not referenced by content_scripts', async () => {
    const projectDir = path.join(tmpRoot, 'p2')
    fs.mkdirSync(projectDir, {recursive: true})
    const manifestPath = path.join(projectDir, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        content_scripts: []
      })
    )
    const resourcePath = path.join(projectDir, 'content', 'scripts.js')
    const {default: loader} = await import(
      '../steps/add-content-script-wrapper'
    )
    const ctx = makeLoaderContext(resourcePath, manifestPath)

    const source = `console.log('plain script')`
    // @ts-expect-error - calling loader with mocked context
    const result = loader.call(ctx, source) as string
    expect(result).toBe(source)
  })
})
