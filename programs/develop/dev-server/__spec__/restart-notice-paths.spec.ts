import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {devServerRestarting} from '../messages'

const ANSI = /\u001b\[[0-9;]*m/g

describe('the dev restart notice', () => {
  it('shortens the changed, before and after paths the same way', () => {
    const cwd = process.cwd()
    const line = devServerRestarting({
      reason: 'scripts',
      pathChanged: path.join(cwd, 'manifest.json'),
      pathBefore: path.join(cwd, 'content-restart-notice-before.js'),
      pathAfter: path.join(cwd, 'content-restart-notice-after.js')
    }).replace(ANSI, '')

    expect(line).toContain('CHANGED manifest.json')
    expect(line).toContain('BEFORE content-restart-notice-before.js')
    expect(line).toContain('AFTER content-restart-notice-after.js')
    expect(line).not.toContain(cwd)
  })

  it('names both manifest fields when a script keeps its path and changes key', () => {
    const cwd = process.cwd()
    const line = devServerRestarting({
      reason: 'scripts',
      pathChanged: path.join(cwd, 'background.js'),
      manifestFieldBefore: 'background.scripts',
      manifestField: 'background.service_worker'
    }).replace(ANSI, '')

    expect(line.split('\n').slice(1)).toEqual([
      'CHANGED background.js',
      'BEFORE background.scripts',
      'AFTER background.service_worker'
    ])
  })

  it('keeps the field out of the notice when the path itself changed', () => {
    const cwd = process.cwd()
    const line = devServerRestarting({
      reason: 'html',
      manifestField: 'options_ui/page',
      pathAfter: path.join(cwd, 'options.html')
    }).replace(ANSI, '')

    expect(line.split('\n').slice(1)).toEqual(['AFTER options.html'])
  })

  it('says a styles restart is for a PostCSS setup change and names the file', () => {
    const cwd = process.cwd()
    const line = devServerRestarting({
      reason: 'styles',
      pathChanged: path.join(cwd, 'postcss.config.js')
    }).replace(ANSI, '')

    expect(line.split('\n')).toEqual([
      expect.stringMatching(
        /Restarting the dev server to pick up a PostCSS setup change…$/
      ),
      'CHANGED postcss.config.js'
    ])
  })
})
