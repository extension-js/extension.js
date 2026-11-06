import {describe, expect, it} from 'vitest'
import {
  findTabFieldReads,
  sourceLineOf
} from '../apply-dev-defaults-lib/tab-field-reads'

const optionsApp = [
  "import {useEffect, useState} from 'react'",
  '',
  'interface Site { url: string; title: string }',
  '',
  'export function OptionsApp({sites}: {sites: Site[]}) {',
  '  const [open, setOpen] = useState(false)',
  "  useEffect(() => { document.title = 'Options ' + sites.length }, [sites])",
  '  const first = sites[0]',
  '  console.log(first.url, first.title, new URL(".", import.meta.url).href)',
  '  return (',
  '    <ul>',
  '      {sites.map((site) => (',
  '        <li key={site.url} title={site.title} onClick={() => chrome.tabs.create({url: site.url})}>',
  '          {site.title}',
  '        </li>',
  '      ))}',
  "      <button onClick={() => chrome.tabs.create({url: 'https://example.com/upgrade'})}>Upgrade</button>",
  "      <button onClick={() => chrome.tabs.update(1, {url: 'https://example.com', active: true})}>Go</button>",
  '      <button onClick={() => chrome.tabs.query({active: true}, (tabs) => chrome.tabs.sendMessage(tabs[0].id as number, {open}))}>Ping</button>',
  '    </ul>',
  '  )',
  '}',
  ''
].join('\n')

describe('findTabFieldReads', () => {
  it('stays silent for a TSX options page that only creates, updates and messages tabs', () => {
    expect(findTabFieldReads(optionsApp, '/p/options/OptionsApp.tsx')).toEqual(
      []
    )
  })

  it('names the source line of a field read from a query result, through the TSX transform', () => {
    const source = [
      "import {useEffect, useState} from 'react'",
      '',
      'export function TabsPanel() {',
      '  const [labels, setLabels] = useState<string[]>([])',
      '  useEffect(() => {',
      '    chrome.tabs.query({currentWindow: true}, (tabs) => {',
      '      setLabels(',
      '        tabs.map((tab) => <span>{tab.title}</span>).map(String)',
      '      )',
      '    })',
      '  }, [])',
      '  return <ul>{labels.map((label) => <li key={label}>{label}</li>)}</ul>',
      '}',
      ''
    ].join('\n')

    expect(findTabFieldReads(source, '/p/panel.tsx')).toEqual([
      {line: 8, field: 'title'}
    ])
  })

  it.each([
    [
      'tab.url from an awaited query',
      'const tabs = await chrome.tabs.query({active: true})\nconsole.log(tabs[0].url)\n',
      [{line: 2, field: 'url'}]
    ],
    [
      'a {url, title} destructuring of an awaited query',
      'const [{url, title}] = await chrome.tabs.query({active: true})\nconsole.log(url, title)\n',
      [
        {line: 1, field: 'url'},
        {line: 1, field: 'title'}
      ]
    ],
    [
      'a destructured callback parameter',
      'chrome.tabs.get(1, ({favIconUrl}) => favIconUrl)\n',
      [{line: 1, field: 'favIconUrl'}]
    ],
    [
      'a destructuring from the callback tab',
      'chrome.tabs.get(1, (tab) => {\n  const {pendingUrl} = tab\n  return pendingUrl\n})\n',
      [{line: 2, field: 'pendingUrl'}]
    ],
    [
      'a for-of over the query result',
      'const tabs = await browser.tabs.query({})\nfor (const tab of tabs) {\n  console.log(tab.title)\n}\n',
      [{line: 3, field: 'title'}]
    ],
    [
      'a then callback on the Firefox promise',
      'browser.tabs.query({}).then((tabs) => tabs.find((t) => t.active)?.url)\n',
      [{line: 1, field: 'url'}]
    ],
    [
      'the tab handed to onUpdated',
      'chrome.tabs.onUpdated.addListener((id, info, tab) => {\n  if (info.status === "complete") console.log(tab.url)\n})\n',
      [{line: 2, field: 'url'}]
    ],
    [
      'the changeInfo handed to onUpdated',
      'chrome.tabs.onUpdated.addListener((id, info) => console.log(info.title))\n',
      [{line: 1, field: 'title'}]
    ],
    [
      'a url filter on the query',
      "chrome.tabs.query({url: 'https://*.example.com/*'})\n",
      [{line: 1, field: 'url'}]
    ],
    [
      'the tab a create callback gets',
      'chrome.tabs.create({url: "a.html"}, (tab) => console.log(tab.title))\n',
      [{line: 1, field: 'title'}]
    ],
    [
      'tabs reached through a populated window',
      'const win = await chrome.windows.getCurrent({populate: true})\nconsole.log(win.tabs[0].favIconUrl)\n',
      [{line: 2, field: 'favIconUrl'}]
    ],
    [
      'a value assigned later',
      'let current\nchrome.tabs.get(1, (tab) => { current = tab })\nconsole.log(current?.url)\n',
      [{line: 3, field: 'url'}]
    ]
  ])('warns on %s', (_label, source, reads) => {
    expect(findTabFieldReads(source, '/p/background.js')).toEqual(reads)
  })

  it.each([
    ['a create shorthand', 'chrome.tabs.create({url})\n'],
    [
      'a create with a url value',
      "chrome.tabs.create({url: 'https://e.com/'})\n"
    ],
    ['an update', 'chrome.tabs.update(tabId, {url, active: true})\n'],
    [
      'a create callback reading the id',
      'chrome.tabs.create({url}, (tab) => tab.id)\n'
    ],
    [
      'a query whose result only feeds sendMessage',
      'chrome.tabs.query({active: true}, (tabs) => chrome.tabs.sendMessage(tabs[0].id, {}))\n'
    ],
    [
      'a remove and a reload',
      'const tabs = await chrome.tabs.query({})\nawait chrome.tabs.remove(tabs.map((t) => t.id))\nchrome.tabs.reload(tabs[0].id)\n'
    ],
    [
      'url and title on objects that are not tabs',
      'document.title = "x"\nconst link = {url: location.href, title: document.title}\nconsole.log(link.url, link.title, import.meta.url)\nchrome.tabs.create({url: link.url})\n'
    ],
    [
      'a tab id read in a for-of',
      'for (const tab of await chrome.tabs.query({})) console.log(tab.id, tab.windowId)\n'
    ],
    [
      'a query filter that is not url or title',
      'chrome.tabs.query({active: true, currentWindow: true, status: "complete"})\n'
    ]
  ])('stays silent on %s', (_label, source) => {
    expect(findTabFieldReads(source, '/p/background.js')).toEqual([])
  })

  it('follows a React state setter fed from a query', () => {
    const source = [
      'function Panel() {',
      '  const [tabs, setTabs] = useState([])',
      '  useEffect(() => { chrome.tabs.query({}, (found) => setTabs(found)) }, [])',
      '  return tabs.map((tab) => tab.url)',
      '}',
      ''
    ].join('\n')

    expect(findTabFieldReads(source, '/p/panel.jsx')).toEqual([
      {line: 4, field: 'url'}
    ])
  })

  it('answers undefined for a source it cannot lower, so the caller keeps its text scan', () => {
    expect(findTabFieldReads('<template></template>', '/p/App.vue')).toBe(
      undefined
    )

    expect(findTabFieldReads('const = ;', '/p/broken.ts')).toBe(undefined)
  })

  it('maps a generated position back to its source line', () => {
    expect(sourceLineOf('AAAA;AACA,SAASA;AACT', 2, 10)).toBe(2)
    expect(sourceLineOf('AAAA;AACA,SAASA;AACT', 3, 0)).toBe(3)
    expect(sourceLineOf('AAAA;AACA,SAASA;AACT', 9, 0)).toBe(undefined)
  })
})
