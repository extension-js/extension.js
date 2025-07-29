import {test, expect} from '@playwright/test'
import {readFileSync, existsSync} from 'fs'
import {join} from 'path'

const exampleDir = 'examples/content-custom-font'

test.describe('Content Custom Font Template', () => {
  test('should have all required files', async () => {
    const requiredFiles = [
      'package.json',
      'manifest.json',
      'background.js',
      'content/scripts.js',
      'content/styles.css',
      'postcss.config.js',
      'public/fonts/README.md',
      'images/extension_48.png',
      'public/logo.svg',
      '.gitignore',
      'README.md'
    ]

    for (const file of requiredFiles) {
      const filePath = join(exampleDir, file)
      expect(existsSync(filePath), `${file} should exist`).toBe(true)
    }
  })

  test('should have correct package.json', async () => {
    const packageJson = JSON.parse(
      readFileSync(join(exampleDir, 'package.json'), 'utf8')
    )

    expect(packageJson.name).toBe('content-custom-font-example')
    expect(packageJson.description).toContain('custom fonts')
    expect(packageJson.description).toContain('Tailwind CSS')
    expect(packageJson.devDependencies).toHaveProperty('tailwindcss')
  })

  test('should have correct manifest.json', async () => {
    const manifest = JSON.parse(
      readFileSync(join(exampleDir, 'manifest.json'), 'utf8')
    )

    expect(manifest.name).toContain('Custom Font')
    expect(manifest.description).toContain('custom fonts')
    expect(manifest.web_accessible_resources).toBeDefined()

    const fontResources = manifest.web_accessible_resources[0].resources
    expect(fontResources).toContain('fonts/*.woff2')
    expect(fontResources).toContain('fonts/*.woff')
    expect(fontResources).toContain('fonts/*.ttf')
    expect(fontResources).toContain('fonts/*.otf')
  })

  test('should have correct font-face declarations in CSS', async () => {
    const css = readFileSync(join(exampleDir, 'content/styles.css'), 'utf8')

    expect(css).toContain('@font-face')
    expect(css).toContain('font-family: "Roboto"')
    expect(css).toContain('font-family: "Source Code Pro"')
    expect(css).toContain('url("/fonts/')
    expect(css).toContain('font-display: swap')
  })

  test('should have font-face declarations in CSS', async () => {
    const css = readFileSync(join(exampleDir, 'content/styles.css'), 'utf8')

    expect(css).toContain('@font-face')
    expect(css).toContain('font-family: "Roboto"')
    expect(css).toContain('font-family: "Source Code Pro"')
    expect(css).toContain('url("/fonts/')
    expect(css).toContain('font-display: swap')
  })

  test('should have content script with font demo', async () => {
    const script = readFileSync(join(exampleDir, 'content/scripts.js'), 'utf8')

    expect(script).toContain('Custom Font Demo')
    expect(script).toContain('font_roboto')
    expect(script).toContain('font_source_code_pro')
    expect(script).toContain('Roboto')
    expect(script).toContain('Source Code Pro')
    expect(script).toContain('Setup Instructions')
  })

  test('should have comprehensive README', async () => {
    const readme = readFileSync(join(exampleDir, 'README.md'), 'utf8')

    expect(readme).toContain('Content Custom Font Example')
    expect(readme).toContain('GitHub Issue #271')
    expect(readme).toContain('Setup Instructions')
    expect(readme).toContain('Troubleshooting')
    expect(readme).toContain('Best Practices')
    expect(readme).toContain('public/fonts/')
  })

  test('should have fonts directory with instructions', async () => {
    const fontsReadme = readFileSync(
      join(exampleDir, 'public/fonts/README.md'),
      'utf8'
    )

    expect(fontsReadme).toContain('Font Files Directory')
    expect(fontsReadme).toContain('Supported Font Formats')
    expect(fontsReadme).toContain('How to Add Your Own Fonts')
    expect(fontsReadme).toContain('Troubleshooting')
  })
})
