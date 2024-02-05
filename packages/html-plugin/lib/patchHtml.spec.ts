import fs from 'fs'
import patchHtml from './patchHtml'

jest.mock('fs')

// Example HTML content
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <script src="app.js"></script>
</body>
</html>
`

const mockCompilation: any = {
  options: {
    context: '/path/to/project'
  },
  assets: {
    'main.js': {},
    'main.css': {}
  },
  compiler: {
    context: '/path/to/project'
  }
}

describe('patchHtml', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.readFileSync as jest.Mock).mockReturnValue(htmlContent)
  })

  it('correctly patches HTML with Webpack assets', () => {
    const exclude: string[] = []
    const htmlEntry = '/path/to/project/index.html'

    // Execute patchHtml
    const patchedHtml = patchHtml(mockCompilation, htmlEntry, exclude)

    // Check if new script tag added
    expect(patchedHtml).toContain('<script src="./index.js"></script>')

    // Check if new link tag added
    expect(patchedHtml).toContain('<link rel="stylesheet" href="./index.css">')

    // Original script removed
    expect(patchedHtml).not.toContain('<script src="app.js"></script>')

    // Original link removed
    expect(patchedHtml).not.toContain(
      '<link rel="stylesheet" href="styles.css">'
    )
  })
})
