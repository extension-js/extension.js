import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// The build card names the extension the folder ships, so a name filled from
// .env reads as its value and never as the placeholder the source holds.
const tempFolder = trackTempFolders()

afterEach(() => {
  vi.restoreAllMocks()
})

function project(): string {
  const root = fs.realpathSync.native(tempFolder('extjs-card-env-name-'))

  writeExtensionProject(root, {
    manifest: {
      name: 'Card $EXTENSION_PUBLIC_CARD_NAME',
      version: '1.2.3',
      action: {default_popup: 'popup.html'}
    },
    packageJson: {name: 'card-probe-pkg'}
  })

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<html><body><script src="./popup.js"></script></body></html>\n'
  )

  fs.writeFileSync(path.join(root, 'popup.js'), 'console.log("popup")\n')
  fs.writeFileSync(
    path.join(root, '.env'),
    'EXTENSION_PUBLIC_CARD_NAME=filled value\n'
  )

  return root
}

describe('the build card and a name set through .env', () => {
  it('prints the name the written manifest carries', async () => {
    const root = project()
    const printed: string[] = []

    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      printed.push(parts.map(String).join(' '))
    })

    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const summary = await buildProject(root, {
      silent: undefined,
      mode: 'production',
      exitOnError: false
    })

    expect(summary.errors_count).toBe(0)

    const shipped = JSON.parse(
      fs.readFileSync(
        path.join(root, 'dist', 'chrome', 'manifest.json'),
        'utf8'
      )
    )

    expect(shipped.name).toBe('Card filled value')

    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colors
    const text = printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    const row = text.split('\n').find((line) => /\bExtension\s{2,}/.test(line))

    expect(row).toContain('Card filled value 1.2.3')
    expect(text).not.toContain('$EXTENSION_PUBLIC_CARD_NAME')
  }, 180_000)
})
