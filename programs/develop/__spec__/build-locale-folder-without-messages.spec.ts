import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, '')
}

function project(localesParent: '' | 'public') {
  const root = tempFolder('extjs-locale-folder-')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'localeme', version: '0.0.0'})
  )

  const locales = path.join(root, localesParent, '_locales')
  fs.mkdirSync(path.join(locales, 'en'), {recursive: true})
  fs.mkdirSync(path.join(locales, 'pt_BR'), {recursive: true})
  fs.writeFileSync(
    path.join(locales, 'en', 'messages.json'),
    JSON.stringify({title: {message: 'localeme'}})
  )

  fs.writeFileSync(path.join(locales, 'en', 'privacy.md'), 'kept with en\n')
  fs.writeFileSync(
    path.join(locales, 'pt_BR', 'README.md'),
    'notes-only-folder-7f3a\n'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: '__MSG_title__',
      version: '1.0.0',
      manifest_version: 3,
      default_locale: 'en',
      browser_specific_settings: {gecko: {id: 'localeme@example.com'}}
    })
  )

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const lines: string[] = []
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.warn = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))

  let summary: {errors_count: number; warnings_count: number}

  try {
    summary = await buildProject(root, {
      browser,
      silent: false,
      mode: 'production'
    })
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError
  }

  const distDir = path.join(root, 'dist', browser)

  return {summary, output: stripAnsi(lines.join('\n')), distDir}
}

function expectFolderLeftOut(output: string, distDir: string) {
  expect(
    fs.existsSync(path.join(distDir, '_locales', 'en', 'messages.json'))
  ).toBe(true)

  expect(
    fs.existsSync(path.join(distDir, '_locales', 'en', 'privacy.md'))
  ).toBe(true)

  expect(fs.existsSync(path.join(distDir, '_locales', 'pt_BR'))).toBe(false)
  expect(output).toContain('FOLDER _locales/pt_BR')
  expect(output.match(/FOLDER _locales\/pt_BR/g)).toHaveLength(1)
  expect(output).not.toContain('notes-only-folder-7f3a')
}

describe('a locale folder without messages.json (real build)', () => {
  it('is left out of the firefox build, named once, and never reaches the store check', async () => {
    const {summary, output, distDir} = await build(project(''), 'firefox')

    expect(summary.errors_count).toBe(0)
    expectFolderLeftOut(output, distDir)
    expect(output).not.toContain('NO_MESSAGES_FILE_IN_LOCALES')
  }, 180_000)

  it('is left out of the chrome build and named once', async () => {
    const {summary, output, distDir} = await build(project(''), 'chrome')

    expect(summary.errors_count).toBe(0)
    expectFolderLeftOut(output, distDir)
  }, 120_000)

  it('is left out when the locales live under public/', async () => {
    const {summary, output, distDir} = await build(project('public'), 'chrome')

    expect(summary.errors_count).toBe(0)
    expectFolderLeftOut(output, distDir)
  }, 120_000)
})
