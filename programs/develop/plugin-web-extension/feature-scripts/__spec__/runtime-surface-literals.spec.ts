import {describe, expect, it} from 'vitest'
import {extractRuntimeSurfaceLiterals} from '../steps/trace-runtime-loaded-files'

describe('extractRuntimeSurfaceLiterals', () => {
  it('finds the paths the toolbar, panel and offscreen setters name', () => {
    const source = [
      'chrome.action.setPopup({popup: "popups/enabled.html"})',
      'chrome.sidePanel.setOptions({path: "panel.html", enabled: true})',
      'chrome.offscreen.createDocument({url: "offscreen.html", reasons: []})',
      'chrome.action.setPopup({popup: ""})'
    ].join('\n')

    expect(extractRuntimeSurfaceLiterals(source)).toEqual([
      'popups/enabled.html',
      'panel.html',
      'offscreen.html'
    ])
  })

  it('finds icons set at runtime as a string or a size map', () => {
    const source = [
      "chrome.action.setIcon({path: 'img/logo/38x38.png'})",
      'chrome.browserAction.setIcon({path: {16: "img/16.png", "32": "img/32.png"}, tabId: 1})',
      'chrome.notifications.create("id", {iconUrl: "img/bell.png", type: "basic"})'
    ].join('\n')

    expect(extractRuntimeSurfaceLiterals(source)).toEqual([
      'img/bell.png',
      'img/logo/38x38.png',
      'img/16.png',
      'img/32.png'
    ])
  })

  it('finds the devtools panel icon and page and a tab opened by path', () => {
    const source = [
      'chrome.devtools.panels.create("Redux", "img/logo/scalable.png", "devpanel.html", (panel) => {})',
      "chrome.tabs.create({url: 'changelog.html'})",
      "chrome.windows.create({url: 'https://example.com/'})",
      'chrome.tabs.create({url: chrome.runtime.getURL("dynamic.html")})'
    ].join('\n')

    expect(extractRuntimeSurfaceLiterals(source)).toEqual([
      'changelog.html',
      'https://example.com/',
      'img/logo/scalable.png',
      'devpanel.html'
    ])
  })
})
