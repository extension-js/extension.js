import * as path from 'path'
import * as fs from 'fs'
import {jest} from '@jest/globals'

// Mock the loader context
const mockLoaderContext = {
  resourcePath: '/test/project/content/scripts.tsx',
  getOptions: () => ({
    manifestPath: '/test/project/manifest.json',
    mode: 'development',
    includeList: {},
    excludeList: {}
  })
}

// Mock fs and path
jest.mock('fs')
jest.mock('path')

describe('add-content-script-wrapper loader', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Mock fs.existsSync and fs.readFileSync
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({
        content_scripts: [
          {
            js: ['content/scripts.tsx']
          }
        ]
      })
    )
  })

  it('should wrap React content scripts with the wrapper code', () => {
    const loader = require('../steps/add-content-script-wrapper').default

    const source = `
import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'
import './styles.css'

export default function contentScript() {
  return (container) => {
    const mountingPoint = ReactDOM.createRoot(container)
    mountingPoint.render(<ContentApp />)
    return () => mountingPoint.unmount()
  }
}
`

    const result = loader.call(mockLoaderContext, source)

    // Should contain the wrapper code
    expect(result).toContain('Auto-generated Content Script Wrapper')
    expect(result).toContain('class ContentScriptWrapper')
    expect(result).toContain('setupShadowDOM')
    expect(result).toContain('injectStyles')

    // Should not contain the original source directly
    expect(result).not.toContain('ReactDOM.createRoot')
  })

  it('should not wrap non-React content scripts', () => {
    const loader = require('../steps/add-content-script-wrapper').default

    const source = `
console.log('Hello from content script')
document.body.style.backgroundColor = 'red'
`

    const result = loader.call(mockLoaderContext, source)

    // Should return the original source unchanged
    expect(result).toBe(source)
  })

  it('should handle missing package.json gracefully', () => {
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)

    const loader = require('../steps/add-content-script-wrapper').default

    const source = `
import ReactDOM from 'react-dom/client'
export default function contentScript() {
  return (container) => {
    const mountingPoint = ReactDOM.createRoot(container)
    mountingPoint.render(<div>Hello</div>)
    return () => mountingPoint.unmount()
  }
}
`

    const result = loader.call(mockLoaderContext, source)

    // Should return the original source unchanged when no JS framework is detected
    expect(result).toBe(source)
  })
})
