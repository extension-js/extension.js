import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import type {BuildSummary} from '../lib/build-summary'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

function project(background: string): string {
  const root = tempFolder('extjs-tabs-by-read-')
  writeExtensionProject(root, {
    name: 'tabsbyread',
    manifest: {background: {service_worker: 'background.ts'}}
  })

  fs.writeFileSync(path.join(root, 'background.ts'), background)

  return root
}

async function build(root: string): Promise<BuildSummary> {
  return buildProject(root, {
    mode: 'production'
  })
}

function tabsWarnings(summary: BuildSummary): string[] {
  return (summary.warnings || []).filter((text) =>
    text.includes('does not declare the "tabs" permission')
  )
}

describe('the "tabs" warning of a production build follows field reads', () => {
  it('stays silent for code that only creates tabs', async () => {
    const summary = await build(
      project(
        [
          'export function openUpgrade(url: string): void {',
          '  chrome.tabs.create({url})',
          '}',
          "chrome.runtime.onInstalled.addListener(() => openUpgrade('https://example.com/welcome'))",
          "chrome.action.onClicked.addListener(() => chrome.tabs.create({url: 'https://example.com/upgrade'}))",
          ''
        ].join('\n')
      )
    )

    expect(summary.errors_count).toBe(0)
    expect(tabsWarnings(summary)).toEqual([])
  }, 180_000)

  it('stays silent when url and title are read from objects that are not tabs', async () => {
    const summary = await build(
      project(
        [
          "const link = {url: 'https://example.com/docs', title: 'Docs'}",
          'console.log(link.title, link.url, document.title)',
          'chrome.action.onClicked.addListener(() => chrome.tabs.create({url: link.url}))',
          ''
        ].join('\n')
      )
    )

    expect(summary.errors_count).toBe(0)
    expect(tabsWarnings(summary)).toEqual([])
  }, 180_000)

  it('names the file and line that reads tab.url from a query result', async () => {
    const summary = await build(
      project(
        [
          'chrome.runtime.onMessage.addListener((message, sender, reply) => {',
          '  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {',
          '    const tab = tabs[0]',
          '    reply({url: tab.url, id: tab.id})',
          '  })',
          '  return true',
          '})',
          ''
        ].join('\n')
      )
    )

    const warnings = tabsWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      'background.ts:4 reads the url of a tab, which "tabs" gates'
    )

    expect(warnings[0]).toContain('Add "tabs" to permissions in manifest.json')
    expect(warnings[0]).toContain('Read your browsing history')
  }, 180_000)

  it('warns when {url, title} is destructured from a query', async () => {
    const summary = await build(
      project(
        [
          'async function describeActive(): Promise<string> {',
          '  const [{url, title}] = await chrome.tabs.query({active: true})',
          "  return title + ' <' + url + '>'",
          '}',
          'chrome.runtime.onInstalled.addListener(() => void describeActive().then(console.log))',
          ''
        ].join('\n')
      )
    )

    const warnings = tabsWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('background.ts:2 reads the url of a tab')
  }, 180_000)
})
