// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {describe, expect, it} from 'vitest'
import {
  accessibilityProbeScript,
  extensionCheckboxId,
  extensionEnabledScript,
  otherWebsitesScript,
  parseCommandShortcut,
  pressShortcutScript,
  readScriptHeader,
  readShortcutScript,
  shortcutFromGlyphs,
  toolbarButtonId,
  toolbarButtonScript,
  toolbarMenuScript,
  unsignedExtensionsScript
} from '../run-safari/safari-ui/scripts'
import {
  hostAppName,
  isAccessibilityRefusal,
  parseScriptAnswer
} from '../run-safari/safari-ui/tools'

const BUNDLE = 'dev.extensionjs.PII-Shield'

describe('safari ui identifiers', () => {
  it('names the Settings row checkbox the way Safari 27 exposes it', () => {
    expect(extensionCheckboxId(BUNDLE)).toBe(
      'dev.extensionjs.PII-Shield.Extension (UNSIGNED)-checkbox'
    )

    expect(extensionCheckboxId(BUNDLE, 'JU3XAJJQ2G')).toBe(
      'dev.extensionjs.PII-Shield.Extension (JU3XAJJQ2G)-checkbox'
    )

    expect(extensionCheckboxId(BUNDLE, '  ')).toBe(
      'dev.extensionjs.PII-Shield.Extension (UNSIGNED)-checkbox'
    )
  })

  it('names the toolbar button by the same identity', () => {
    expect(toolbarButtonId(BUNDLE)).toBe(
      'WebExtension-dev.extensionjs.PII-Shield.Extension (UNSIGNED)'
    )

    expect(toolbarButtonId(BUNDLE, 'TEAM')).toBe(
      'WebExtension-dev.extensionjs.PII-Shield.Extension (TEAM)'
    )
  })
})

describe('manifest shortcut parsing', () => {
  it('maps the manifest modifiers onto macOS keystroke modifiers', () => {
    expect(parseCommandShortcut('Alt+Shift+H')).toEqual({
      key: 'h',
      keyCode: undefined,
      modifiers: ['option down', 'shift down']
    })

    expect(parseCommandShortcut('Ctrl+Shift+Y').modifiers).toEqual([
      'command down',
      'shift down'
    ])

    expect(parseCommandShortcut('MacCtrl+K').modifiers).toEqual([
      'control down'
    ])
  })

  it('uses a key code for named keys', () => {
    expect(parseCommandShortcut('Ctrl+Comma')).toMatchObject({
      key: 'comma',
      keyCode: 43
    })

    expect(parseCommandShortcut('Alt+F5')).toMatchObject({keyCode: 96})
  })

  it('refuses what it cannot press', () => {
    expect(() => parseCommandShortcut('')).toThrow(/empty/)
    expect(() => parseCommandShortcut('Alt+Shift')).toThrow(/no key/)
    expect(() => parseCommandShortcut('Alt+H+J')).toThrow(/two keys/)
    expect(() => parseCommandShortcut('Alt+Hyper')).toThrow(/Hyper/)
  })

  it('turns the glyphs Settings shows back into manifest words', () => {
    expect(shortcutFromGlyphs('⌥⇧H')).toBe('Alt+Shift+H')
    expect(shortcutFromGlyphs('⌘⇧Y')).toBe('Ctrl+Shift+Y')
    expect(shortcutFromGlyphs('⌃K')).toBe('MacCtrl+K')
    expect(shortcutFromGlyphs('')).toBe('')
  })
})

describe('generated scripts', () => {
  const checkbox = extensionCheckboxId(BUNDLE)
  const button = toolbarButtonId(BUNDLE)
  const scripts: Record<string, string> = {
    probe: accessibilityProbeScript(),
    unsignedRead: unsignedExtensionsScript('read'),
    unsignedOn: unsignedExtensionsScript('on'),
    enabledRead: extensionEnabledScript(checkbox, 'read'),
    enabledOn: extensionEnabledScript(checkbox, 'on'),
    enabledOff: extensionEnabledScript(checkbox, 'off'),
    websitesRead: otherWebsitesScript(checkbox, 'read'),
    websitesAllow: otherWebsitesScript(checkbox, 'allow'),
    shortcut: readShortcutScript(checkbox),
    button: toolbarButtonScript(button),
    menu: toolbarMenuScript(button),
    press: pressShortcutScript(parseCommandShortcut('Alt+Shift+H')),
    pressCode: pressShortcutScript(parseCommandShortcut('Ctrl+Comma'))
  }

  it('every script parses as JavaScript', () => {
    for (const [name, source] of Object.entries(scripts)) {
      expect(() => new Function(source), name).not.toThrow()
    }
  })

  it('every script carries a header a fake can answer by', () => {
    expect(readScriptHeader(scripts.probe)).toEqual({kind: 'probe'})
    expect(readScriptHeader(scripts.enabledOn)).toEqual({
      kind: 'enabled',
      action: 'on',
      id: checkbox
    })

    expect(readScriptHeader(scripts.websitesAllow)).toEqual({
      kind: 'websites',
      action: 'allow',
      id: checkbox
    })

    expect(readScriptHeader(scripts.press)).toEqual({
      kind: 'press',
      key: 'h',
      modifiers: ['option down', 'shift down']
    })

    expect(readScriptHeader('nothing here')).toBeNull()
  })

  it('addresses the row by AXIdentifier and never by a group index', () => {
    expect(scripts.enabledOn).toContain(JSON.stringify(checkbox))
    expect(scripts.enabledOn).toContain("'AXIdentifier'")
    expect(scripts.enabledOn).not.toMatch(/groups\[\d\]/)
    expect(scripts.enabledOn).not.toMatch(/group \d/)
  })

  it('quotes an identifier with a quote in it', () => {
    const odd = extensionEnabledScript(`it's "odd"-checkbox`, 'read')
    expect(() => new Function(odd)).not.toThrow()
    expect(odd).toContain(JSON.stringify(`it's "odd"-checkbox`))
  })

  it('ticks the unsigned toggle in the Developer pane by its title', () => {
    expect(scripts.unsignedOn).toContain("showPane(proc, 'Developer')")
    expect(scripts.unsignedOn).toContain('"Allow unsigned extensions"')
    expect(scripts.unsignedOn).toContain('setChecked(cb, true)')
    expect(scripts.unsignedRead).not.toContain('setChecked(cb, true)')
  })

  it('sets other websites through the Websites pane pop-up', () => {
    expect(scripts.websitesAllow).toContain('"Edit Websites…"')
    expect(scripts.websitesAllow).toContain("'AXPopUpButton'")
    expect(scripts.websitesAllow).toContain('"Allow"')
    expect(scripts.websitesAllow).not.toContain('Always Allow on Every Website')
  })

  it('opens the toolbar menu with a synthesized right click and closes it', () => {
    expect(scripts.menu).toContain('kCGEventRightMouseDown')
    expect(scripts.menu).toContain('kCGEventRightMouseUp')
    expect(scripts.menu).toContain("'AXMenu'")
    expect(scripts.menu).toContain('se.keyCode(53)')
    expect(scripts.menu).toContain('rightClick(center(b))')
    expect(scripts.button).not.toContain('rightClick(center')
  })

  it('presses letters by keystroke and named keys by key code', () => {
    expect(scripts.press).toContain(
      'se.keystroke("h", {using: ["option down","shift down"]})'
    )

    expect(scripts.pressCode).toContain(
      'se.keyCode(43, {using: ["command down"]})'
    )
  })
})

describe('script answers', () => {
  it('reads the last JSON line and ignores osascript chatter', () => {
    expect(
      parseScriptAnswer(
        'osascript[1]: ApplePersistence=NO\n{"ok":true,"before":1}\n'
      )
    ).toEqual({ok: true, before: 1})

    expect(parseScriptAnswer('execution error: boom (-1719)')).toBeNull()
    expect(parseScriptAnswer('')).toBeNull()
  })

  it('recognizes the assistive access refusal', () => {
    expect(
      isAccessibilityRefusal(
        'execution error: osascript is not allowed assistive access. (-1719)'
      )
    ).toBe(true)

    expect(isAccessibilityRefusal('System Events got an error: -25211')).toBe(
      true
    )

    expect(isAccessibilityRefusal('AppleEvent handler failed. (-10000)')).toBe(
      false
    )
  })
})

describe('host app name', () => {
  it('walks the parent chain up to the .app bundle that runs the shell', () => {
    const tree: Record<number, {ppid: number; command: string}> = {
      10: {ppid: 9, command: '/bin/zsh'},
      9: {ppid: 8, command: '/Applications/Cursor.app/Contents/MacOS/Cursor'},
      8: {ppid: 1, command: '/sbin/launchd'}
    }
    expect(hostAppName(10, (pid) => tree[pid] || null, {})).toBe('Cursor')
  })

  it('falls back to the terminal program when no bundle is in the chain', () => {
    const lookup = () => null
    expect(hostAppName(5, lookup, {TERM_PROGRAM: 'Apple_Terminal'})).toBe(
      'Terminal'
    )

    expect(hostAppName(5, lookup, {TERM_PROGRAM: 'iTerm.app'})).toBe('iTerm')
    expect(hostAppName(5, lookup, {TERM_PROGRAM: 'WarpTerminal'})).toBe(
      'WarpTerminal'
    )

    expect(hostAppName(5, lookup, {})).toMatch(/terminal app/)
  })
})
