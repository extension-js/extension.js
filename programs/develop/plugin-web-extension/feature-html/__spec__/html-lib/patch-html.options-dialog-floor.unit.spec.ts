import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  needsOptionsDialogFloor,
  OPTIONS_DIALOG_FLOOR_CSS
} from '../../html-lib/options-dialog-floor'
import {patchHtml} from '../../html-lib/patch-html'

function makeTmp(name: string) {
  const tmp = path.join(__dirname, `.tmp-${name}`)
  fs.rmSync(tmp, {recursive: true, force: true})
  fs.mkdirSync(tmp, {recursive: true})

  return tmp
}

function makeCompilation(): Compilation {
  return {
    options: {mode: 'production'},
    getAsset: () => undefined,
    emitAsset() {},
    updateAsset() {},
    warnings: []
  } as unknown as Compilation
}

const FLOOR_TAG = `<style data-extension-js="options-dialog-floor">${OPTIONS_DIALOG_FLOOR_CSS}</style>`

describe('needsOptionsDialogFloor', () => {
  const embedded = {options_ui: {page: 'options.html'}}

  it('asks for the floor on a Chromium options_ui page that opens in the dialog', () => {
    expect(
      needsOptionsDialogFloor(embedded as any, 'chrome', 'options/index')
    ).toBe(true)

    expect(
      needsOptionsDialogFloor(
        {options_ui: {page: 'options.html', open_in_tab: false}} as any,
        'edge',
        'options/index'
      )
    ).toBe(true)

    expect(
      needsOptionsDialogFloor(
        embedded as any,
        'chromium-based',
        'options/index'
      )
    ).toBe(true)
  })

  it('leaves a page that opens in a tab alone', () => {
    expect(
      needsOptionsDialogFloor(
        {options_ui: {page: 'options.html', open_in_tab: true}} as any,
        'chrome',
        'options/index'
      )
    ).toBe(false)

    expect(
      needsOptionsDialogFloor(
        {options_page: 'options.html'} as any,
        'chrome',
        'options/index'
      )
    ).toBe(false)
  })

  it('leaves Gecko and Safari pages and every other surface alone', () => {
    expect(
      needsOptionsDialogFloor(embedded as any, 'firefox', 'options/index')
    ).toBe(false)

    expect(
      needsOptionsDialogFloor(embedded as any, 'safari', 'options/index')
    ).toBe(false)

    expect(
      needsOptionsDialogFloor(embedded as any, 'chrome', 'action/index')
    ).toBe(false)

    expect(needsOptionsDialogFloor(undefined, 'chrome', 'options/index')).toBe(
      false
    )
  })
})

describe('patchHtml options dialog floor', () => {
  it('puts the floor style first in head so author styles win', () => {
    const tmp = makeTmp('options-floor')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><div id="root"></div><script src="a.js"></script></body></html>`
    )

    const updated = patchHtml(
      makeCompilation(),
      'options/index',
      htmlPath,
      {'options/index': htmlPath},
      tmp,
      [],
      undefined,
      {optionsDialogFloor: true}
    )

    expect(updated).toContain(`<head>${FLOOR_TAG}<meta charset="utf-8">`)
    expect(updated.indexOf(FLOOR_TAG)).toBeLessThan(
      updated.indexOf('body{margin:0}')
    )

    expect(updated).toContain('src="/options/index.js"')
  })

  it('leaves the page untouched when the floor is not asked for', () => {
    const tmp = makeTmp('options-no-floor')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head></head><body><script src="a.js"></script></body></html>`
    )

    const plain = patchHtml(makeCompilation(), 'options/index', htmlPath, {
      'options/index': htmlPath
    })
    const declined = patchHtml(
      makeCompilation(),
      'options/index',
      htmlPath,
      {'options/index': htmlPath},
      tmp,
      [],
      undefined,
      {optionsDialogFloor: false}
    )

    expect(plain).not.toContain('options-dialog-floor')
    expect(declined).toBe(plain)
  })
})
