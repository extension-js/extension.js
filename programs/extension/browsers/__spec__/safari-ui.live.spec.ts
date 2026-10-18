// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {describe, expect, it} from 'vitest'
import {
  checkAccessibility,
  createSafariUiTools,
  readSafariExtensionEnabled,
  readShortcut,
  readToolbarButton,
  readToolbarMenu
} from '../run-safari/safari-ui'

const live = process.env.RUN_SAFARI_UI === '1' && process.platform === 'darwin'
const bundleId = process.env.SAFARI_UI_BUNDLE_ID || 'dev.extensionjs.PII-Shield'
const team = process.env.SAFARI_UI_TEAM || undefined
const describeLive = live ? describe : describe.skip

describeLive('safari ui against the real Safari (RUN_SAFARI_UI=1)', () => {
  const tools = createSafariUiTools()
  const target = {bundleId, developmentTeam: team}

  it('has the Accessibility grant for this host', async () => {
    const access = await checkAccessibility(tools)
    expect(access, access.detail).toMatchObject({granted: true})
    expect(access.host).not.toBe('')
  })

  it('finds the extension in Settings and reads its switch', async () => {
    const state = await readSafariExtensionEnabled(target, tools)
    expect(state.listed).toBe(true)
    expect(state.enabled).toBe(true)
  })

  it('reads the toolbar button and its context menu', async () => {
    const button = await readToolbarButton(target, tools)
    expect(button.found).toBe(true)
    expect(button.title).toBeTruthy()

    const menu = await readToolbarMenu(target, tools)
    expect(menu.opened).toBe(true)
    expect(menu.items.length).toBeGreaterThan(0)
    expect(menu.items.map((item) => item.title)).toContain('Manage Extension…')
  })

  it('reads the shortcut Settings shows', async () => {
    const shortcut = await readShortcut(target, tools)
    expect(shortcut.listed).toBe(true)
    expect(shortcut.shortcut).toMatch(/^[A-Za-z]+(\+[A-Za-z0-9]+)+$/)
  })
})
