import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  extractPathLiterals,
  findUnshippedFolders,
  toRuntimePathReference
} from '../steps/warn-unshipped-runtime-assets'

describe('path literals in emitted code', () => {
  it('reads quoted strings and template heads', () => {
    expect(
      extractPathLiterals(
        `a="icons/providers/";b='assets/x.svg';c=\`assets/images/\${t}.svg\``
      )
    ).toEqual(['icons/providers/', 'assets/x.svg', 'assets/images/'])
  })

  it('reads attribute values in markup', () => {
    expect(
      extractPathLiterals(
        '<option data-icon-path="assets/images/site-search/tile-gpt.png">'
      )
    ).toEqual(['assets/images/site-search/tile-gpt.png'])
  })
})

describe('runtime path references', () => {
  it('splits a file path into its folder', () => {
    expect(toRuntimePathReference('/icons/providers/chatgpt.png')).toEqual({
      literal: '/icons/providers/chatgpt.png',
      folder: 'icons/providers',
      namePrefix: 'chatgpt.png',
      file: 'icons/providers/chatgpt.png'
    })
  })

  it('keeps the name prefix of a template head', () => {
    expect(toRuntimePathReference('assets/images/newtab-')).toEqual({
      literal: 'assets/images/newtab-',
      folder: 'assets/images',
      namePrefix: 'newtab-'
    })
  })

  it('anchors a page-relative path at the root', () => {
    expect(toRuntimePathReference('../../assets/images/dark.svg')?.file).toBe(
      'assets/images/dark.svg'
    )
  })

  it('leaves urls, prose and package folders alone', () => {
    expect(toRuntimePathReference('https://example.com/a.png')).toBeUndefined()
    expect(toRuntimePathReference('and/or more')).toBeUndefined()
    expect(toRuntimePathReference('node_modules/x/y.png')).toBeUndefined()
    expect(toRuntimePathReference('public/icon.png')).toBeUndefined()
    expect(toRuntimePathReference('react')).toBeUndefined()
    expect(toRuntimePathReference('text/plain')?.file).toBeUndefined()
  })
})

describe('folders reported for one build', () => {
  it('reports a subfolder inside the folder above it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-fold-'))

    try {
      fs.mkdirSync(path.join(root, 'icons', 'providers', 'dark'), {
        recursive: true
      })

      fs.writeFileSync(path.join(root, 'icons', 'providers', 'a.png'), '')
      fs.writeFileSync(
        path.join(root, 'icons', 'providers', 'dark', 'a.png'),
        ''
      )

      const folders = findUnshippedFolders({
        extensionRoot: root,
        sources: [
          {
            assetName: 'popup.js',
            text: "x='/icons/providers/a.png';y='/icons/providers/dark/a.png'"
          }
        ],
        isShipped: () => false,
        isBundled: () => false
      })

      expect(folders).toHaveLength(1)
      expect(folders[0].folder).toBe('icons/providers')
      expect(folders[0].missing).toEqual([
        'icons/providers/a.png',
        'icons/providers/dark/a.png'
      ])
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('skips files the build ships or bundles', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-fold-'))

    try {
      fs.mkdirSync(path.join(root, 'img'), {recursive: true})
      fs.writeFileSync(path.join(root, 'img', 'shipped.png'), '')
      fs.writeFileSync(path.join(root, 'img', 'bundled.png'), '')

      const folders = findUnshippedFolders({
        extensionRoot: root,
        sources: [{assetName: 'popup.js', text: "x='img/'"}],
        isShipped: (rel) => rel === 'img/shipped.png',
        isBundled: (abs) => abs.endsWith(`${path.sep}bundled.png`)
      })

      expect(folders).toEqual([])
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })
})
