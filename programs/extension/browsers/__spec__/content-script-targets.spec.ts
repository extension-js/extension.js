import {describe, expect, it} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getContentScriptRulesFromManifest,
  resolveEmittedContentScriptFile,
  selectContentScriptRules,
  urlMatchesAnyContentScriptRule
} from '../browsers-lib/content-script-targets'

describe('content-script targets helper', () => {
  it('matches urls against manifest content script rules', () => {
    const rules = getContentScriptRulesFromManifest({
      content_scripts: [
        {
          matches: ['https://*.example.com/*'],
          exclude_matches: ['https://admin.example.com/*']
        }
      ]
    })

    expect(
      urlMatchesAnyContentScriptRule('https://docs.example.com/page', rules)
    ).toBe(true)
    expect(
      urlMatchesAnyContentScriptRule('https://admin.example.com/page', rules)
    ).toBe(false)
    expect(urlMatchesAnyContentScriptRule('https://other.test/', rules)).toBe(
      false
    )
  })

  it('applies include and exclude globs after the base match pattern', () => {
    const rules = getContentScriptRulesFromManifest({
      content_scripts: [
        {
          matches: ['https://example.com/*'],
          include_globs: ['*allowed*'],
          exclude_globs: ['*blocked*']
        }
      ]
    })

    expect(
      urlMatchesAnyContentScriptRule('https://example.com/allowed', rules)
    ).toBe(true)
    expect(
      urlMatchesAnyContentScriptRule(
        'https://example.com/blocked-allowed',
        rules
      )
    ).toBe(false)
  })

  it('resolveEmittedContentScriptFile prefers canonical path then dev hashed name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-out-'))
    const cs = path.join(root, 'content_scripts')
    fs.mkdirSync(cs)

    const canonicalJs = path.join(cs, 'content-0.js')
    fs.writeFileSync(canonicalJs, '//')
    expect(resolveEmittedContentScriptFile(root, 0, 'js')).toBe(canonicalJs)
    fs.unlinkSync(canonicalJs)

    const hashedJs = path.join(cs, 'content-0.deadbeef.js')
    fs.writeFileSync(hashedJs, '//')
    expect(resolveEmittedContentScriptFile(root, 0, 'js')).toBe(hashedJs)

    fs.rmSync(root, {recursive: true, force: true})
  })

  it('resolveEmittedContentScriptFile picks the most recently written hashed bundle when multiple coexist', () => {
    // Dev mode runs with output.clean: false, so each rebuild writes a new
    // content-0.<hash>.js without removing the previous one. Returning the
    // first readdirSync match (filesystem order — typically alphabetical)
    // would point Firefox/Chromium at a stale bundle and the user's edit
    // wouldn't appear in the page. Always pick the newest by mtime.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-out-mtime-'))
    const cs = path.join(root, 'content_scripts')
    fs.mkdirSync(cs)

    // Older bundle, alphabetically FIRST so a naive readdir match returns it.
    const olderJs = path.join(cs, 'content-0.0a0a0a0a.js')
    fs.writeFileSync(olderJs, '/* older */')
    const olderTime = new Date('2024-01-01T00:00:00Z')
    fs.utimesSync(olderJs, olderTime, olderTime)

    // Newer bundle, alphabetically LATER. The resolver must pick this one.
    const newerJs = path.join(cs, 'content-0.ffffffff.js')
    fs.writeFileSync(newerJs, '/* newer */')
    const newerTime = new Date('2026-01-01T00:00:00Z')
    fs.utimesSync(newerJs, newerTime, newerTime)

    expect(resolveEmittedContentScriptFile(root, 0, 'js')).toBe(newerJs)

    fs.rmSync(root, {recursive: true, force: true})
  })

  it('selects only the rules that correspond to changed content entries', () => {
    const rules = getContentScriptRulesFromManifest({
      content_scripts: [
        {matches: ['https://one.example/*']},
        {matches: ['https://two.example/*']}
      ]
    })

    expect(
      selectContentScriptRules(rules, [
        'content_scripts/content-1',
        'content_scripts/content-9'
      ])
    ).toEqual([rules[1]])
  })

  it('preserves manifest world metadata for reinjection decisions', () => {
    const rules = getContentScriptRulesFromManifest({
      content_scripts: [
        {matches: ['https://one.example/*']},
        {matches: ['https://two.example/*'], world: 'MAIN'}
      ]
    })

    expect(rules[0]?.world).toBe('extension')
    expect(rules[1]?.world).toBe('main')
  })
})
