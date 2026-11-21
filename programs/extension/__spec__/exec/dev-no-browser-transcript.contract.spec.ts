import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {startCli} from '../helpers/run-cli'

function createFixture(): string {
  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-golden-boot-'))
  mkdirSync(join(projectDir, 'content'), {recursive: true})
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({name: 'golden-boot', private: true, version: '1.0.0'})
  )

  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Golden Boot',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    })
  )

  writeFileSync(
    join(projectDir, 'content', 'scripts.js'),
    "console.log('golden boot fixture')\n"
  )

  return projectDir
}

async function captureDevBoot(projectDir: string) {
  const session = startCli([
    'dev',
    projectDir,
    '--no-browser',
    '--browser=chromium'
  ])

  try {
    await session.waitFor(
      () => session.read().stdout.includes('Watching for file changes.'),
      90_000,
      'the ready line'
    )
  } finally {
    await session.stop('SIGTERM')
  }

  return session.read().output
}

describe('dev --no-browser boot transcript', () => {
  it('prints compiled, then the card, then the ready line, in that order', async () => {
    const projectDir = createFixture()

    try {
      const output = await captureDevBoot(projectDir)
      const lines = output.split('\n')

      const compileIndex = lines.findIndex((line) =>
        /^⏵⏵⏵ \[\d{2}:\d{2}:\d{2}\] Golden Boot compiled in \d+ ms\.$/.test(
          line
        )
      )
      expect(compileIndex, `no compile line in:\n${output}`).toBeGreaterThan(-1)

      expect(lines[compileIndex + 1]).toBe(' ')

      const headIndex = compileIndex + 2
      expect(lines[headIndex]).toMatch(/^ 🧩 Extension\.js/)

      expect(lines[headIndex + 1]).toMatch(
        /^ {4}Browser {8}Chromium \(no-browser mode\)$/
      )

      expect(lines[headIndex + 2]).toMatch(
        /^ {4}Extension {6}Golden Boot 1\.0\.0$/
      )

      // Three rows and no more: MAX_CARD_ROWS caps every card, so this one
      // keeps Browser, Extension and Run ID. Output lost the slot on purpose,
      // because the previewing/serving line above the card already names the
      // directory, while the run id is this card's join key into ready.json
      // and is asserted by the preview specs too.
      expect(lines[headIndex + 3]).toMatch(/^ {4}Run ID {9}\S/)

      // Under the capped card, one line per kind of grant or change the dev
      // manifest has and the production build of this fixture lacks.
      expect(lines.slice(headIndex + 4, headIndex + 8)).toEqual([
        '    Dev only       permissions scripting, tabs, storage',
        '    Dev only       host access <all_urls>',
        '    Dev only       web_accessible_resources hot/*, extension-js-control.json',
        '    Dev only       manifest background.service_worker background/service_worker.js, content_scripts.js dev stubs'
      ])

      expect(lines[headIndex + 8]).toBe(' ')
      expect(lines[headIndex + 9]).toBe(
        '⏵⏵⏵ Extension ready for development. Watching for file changes.'
      )
    } finally {
      rmSync(projectDir, {recursive: true, force: true})
    }
  }, 120000)
})
