import {describe, expect, it} from 'vitest'
import {
  decideRepoint,
  isStartPage,
  MAX_REPOINT_ATTEMPTS
} from '../../../../extensions/extension-js-devtools/src/background/start-pages'

describe('isStartPage', () => {
  it('takes the plain new tab and welcome pages of the scheme', () => {
    expect(isStartPage('chrome://newtab/', 'chromium')).toBe(true)
    expect(isStartPage('chrome://welcome/', 'chrome')).toBe(true)
    expect(isStartPage('edge://newtab/', 'edge')).toBe(true)
    expect(isStartPage('about:home', 'firefox')).toBe(true)
    expect(isStartPage('about:blank', 'firefox')).toBe(true)
  })

  it('takes the start pages of browsers that never open a new tab', () => {
    expect(isStartPage('chrome://startpage/', 'chromium')).toBe(true)
    expect(isStartPage('chrome://startpageshared/', 'chromium')).toBe(true)
    expect(
      isStartPage('https://ntp.msn.com/edge/ntp?locale=en-BR', 'edge')
    ).toBe(true)

    expect(isStartPage('https://ya.ru/?clid=1955452&win=770', 'chromium')).toBe(
      true
    )

    expect(isStartPage('https://ya.ru/', 'chromium')).toBe(true)
    expect(isStartPage('https://yandex.com/', 'chromium')).toBe(true)
    expect(isStartPage('https://yandex.com.tr/', 'chromium')).toBe(true)
    expect(isStartPage('https://www.yandex.kz/', 'chromium')).toBe(true)
  })

  it('leaves every other page alone', () => {
    expect(isStartPage('https://example.com/', 'chromium')).toBe(false)
    expect(isStartPage('https://ya.ru.example.com/', 'chromium')).toBe(false)
    expect(isStartPage('https://notyandex.com/', 'chromium')).toBe(false)
    expect(isStartPage('https://msn.com.example.com/', 'edge')).toBe(false)
    expect(isStartPage('chrome://extensions/', 'chromium')).toBe(false)
    expect(isStartPage('https://example.com/', 'firefox')).toBe(false)
    expect(isStartPage('', 'chromium')).toBe(false)
  })
})

describe('decideRepoint', () => {
  const base = {
    tabId: 7,
    updatedTabId: 7,
    status: 'complete',
    url: 'https://ya.ru/',
    targetUrl: 'chrome://extensions/',
    attempts: 0
  }

  it('repoints a completed start tab that landed elsewhere', () => {
    expect(decideRepoint(base)).toBe('repoint')
    expect(decideRepoint({...base, attempts: MAX_REPOINT_ATTEMPTS - 1})).toBe(
      'repoint'
    )
  })

  it('stops after the retry bound', () => {
    expect(MAX_REPOINT_ATTEMPTS).toBe(3)
    expect(decideRepoint({...base, attempts: 3})).toBe('stop')
    expect(decideRepoint({...base, attempts: 4})).toBe('stop')
  })

  it('waits on another tab, a tab still loading, or the target itself', () => {
    expect(decideRepoint({...base, updatedTabId: 8})).toBe('wait')
    expect(decideRepoint({...base, status: 'loading'})).toBe('wait')
    expect(decideRepoint({...base, status: undefined})).toBe('wait')
    expect(decideRepoint({...base, url: 'chrome://extensions/'})).toBe('wait')
    expect(decideRepoint({...base, url: 'chrome://extensions/?id=x'})).toBe(
      'wait'
    )

    expect(
      decideRepoint({...base, url: 'chrome://extensions/', attempts: 3})
    ).toBe('wait')
  })
})
