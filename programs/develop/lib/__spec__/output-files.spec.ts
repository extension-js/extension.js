import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {getBuildSummary} from '../build-summary'
import {foldOutputFiles, listOutputFiles} from '../output-files'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function outputFolder(files: Record<string, string>) {
  const parent = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'extjs-out-files-'))
  )
  roots.push(parent)
  const root = path.join(parent, 'chrome')

  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, content)
  }

  return {parent, root}
}

describe('listOutputFiles', () => {
  it('lists every file under the folder with its size on disk', () => {
    const {root} = outputFolder({
      'manifest.json': '{}',
      'action/index.js': 'x'.repeat(40),
      'action/index.js.map': 'm'.repeat(300),
      '_locales/en/messages.json': 'l'.repeat(7)
    })

    expect(listOutputFiles(root)).toEqual([
      {name: '_locales/en/messages.json', size: 7},
      {name: 'action/index.js', size: 40},
      {name: 'action/index.js.map', size: 300},
      {name: 'manifest.json', size: 2}
    ])
  })

  it('stays inside the folder it was given', () => {
    const {parent, root} = outputFolder({'manifest.json': '{}'})
    fs.mkdirSync(path.join(parent, 'extension-js'))
    fs.writeFileSync(path.join(parent, 'extension-js', 'ready.json'), '{}')
    fs.mkdirSync(path.join(parent, 'firefox'))
    fs.writeFileSync(path.join(parent, 'firefox', 'manifest.json'), '{}')
    fs.writeFileSync(path.join(parent, 'archive.zip'), 'zip')

    expect(listOutputFiles(root)).toEqual([{name: 'manifest.json', size: 2}])
  })

  it('returns nothing for a folder that does not exist', () => {
    const {parent} = outputFolder({})

    expect(listOutputFiles(path.join(parent, 'missing'))).toEqual([])
  })
})

describe('foldOutputFiles', () => {
  const files = [
    {name: 'manifest.json', size: 100},
    {name: 'action/index.js', size: 40},
    {name: 'action/index.js.map', size: 300},
    {name: 'action/index.css.map', size: 60}
  ]

  it('counts the files the tree did not list and their bytes', () => {
    expect(
      foldOutputFiles(files, ['manifest.json', 'action/index.js'])
    ).toEqual({count: 2, bytes: 360, sourceMapsOnly: true})
  })

  it('says when something other than a source map was left out', () => {
    expect(foldOutputFiles(files, ['action/index.js'])).toEqual({
      count: 3,
      bytes: 460,
      sourceMapsOnly: false
    })
  })

  it('folds nothing when the tree listed every file', () => {
    expect(
      foldOutputFiles(
        files,
        files.map((file) => file.name)
      )
    ).toMatchObject({count: 0, bytes: 0})
  })
})

describe('getBuildSummary totals', () => {
  const info = {
    assets: [{size: 40}, {size: 100}],
    warnings: [],
    errors: []
  }

  it('counts the files in the output folder over the stats list', () => {
    const summary = getBuildSummary('chrome', info, '/out/chrome', [
      {size: 100},
      {size: 40},
      {size: 300},
      {size: 60}
    ])

    expect(summary).toMatchObject({
      total_assets: 4,
      total_bytes: 500,
      largest_asset_bytes: 300
    })
  })

  it('keeps the stats totals when the folder gave no files', () => {
    expect(getBuildSummary('chrome', info, '/out/chrome', [])).toMatchObject({
      total_assets: 2,
      total_bytes: 140,
      largest_asset_bytes: 100
    })

    expect(getBuildSummary('chrome', info, '/out/chrome')).toMatchObject({
      total_assets: 2,
      total_bytes: 140,
      largest_asset_bytes: 100
    })
  })
})
