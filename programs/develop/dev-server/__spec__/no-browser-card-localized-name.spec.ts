import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {browserRunnerDisabled} from '../messages'

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')

// The card names the extension the way the browser does: a __MSG_ name reads
// as the default_locale value, and a key no messages file answers stays raw.
describe('no-browser card with a localized manifest name', () => {
  let projectPath: string
  let manifestPath: string

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'no-browser-card-'))
    manifestPath = path.join(projectPath, 'manifest.json')
    fs.mkdirSync(path.join(projectPath, '_locales', 'en'), {recursive: true})
    fs.writeFileSync(
      path.join(projectPath, '_locales', 'en', 'messages.json'),
      JSON.stringify({extName: {message: 'Lance'}})
    )
  })

  afterEach(() => {
    fs.rmSync(projectPath, {recursive: true, force: true})
  })

  function render(name: string) {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        name,
        default_locale: 'en',
        version: '0.1.0'
      })
    )

    return stripAnsi(
      browserRunnerDisabled({
        browser: 'chromium',
        manifestPath,
        readyPath: path.join(projectPath, 'ready.json'),
        distPath: path.join(projectPath, 'dist', 'chromium')
      })
    )
  }

  it('prints the default_locale value in the Extension row', () => {
    const card = render('__MSG_extName__')
    expect(card).toContain('Lance 0.1.0')
    expect(card).not.toContain('__MSG_')
  })

  it('keeps the raw key when the messages file lacks it', () => {
    expect(render('__MSG_other__')).toContain('__MSG_other__ 0.1.0')
  })
})
