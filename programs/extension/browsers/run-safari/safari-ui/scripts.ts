// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

export const UNSIGNED_TEAM = 'UNSIGNED'
export const UNSIGNED_EXTENSIONS_TITLE = 'Allow unsigned extensions'
export const EDIT_WEBSITES_TITLE = 'Edit Websites…'
const ALWAYS_ALLOW_TITLE = 'Always Allow on Every Website'
export const OTHER_WEBSITES_ALLOW = 'Allow'

export type OtherWebsitesChoice = 'Ask' | 'Deny' | 'Allow'

export function safariExtensionIdentity(
  bundleId: string,
  developmentTeam?: string
): string {
  const team = String(developmentTeam || '').trim() || UNSIGNED_TEAM

  return `${bundleId}.Extension (${team})`
}

export function extensionCheckboxId(
  bundleId: string,
  developmentTeam?: string
): string {
  return `${safariExtensionIdentity(bundleId, developmentTeam)}-checkbox`
}

export function toolbarButtonId(
  bundleId: string,
  developmentTeam?: string
): string {
  return `WebExtension-${safariExtensionIdentity(bundleId, developmentTeam)}`
}

export interface ParsedShortcut {
  key: string
  keyCode?: number
  modifiers: string[]
}

const MODIFIERS: Record<string, string> = {
  ctrl: 'command down',
  command: 'command down',
  macctrl: 'control down',
  alt: 'option down',
  shift: 'shift down'
}

const KEY_CODES: Record<string, number> = {
  comma: 43,
  period: 47,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  space: 49,
  insert: 114,
  delete: 117,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  tab: 48,
  enter: 36,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111
}

export function parseCommandShortcut(input: string): ParsedShortcut {
  const tokens = String(input || '')
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) {
    throw new Error(`Can't press an empty shortcut.`)
  }

  const modifiers: string[] = []
  let key = ''
  let keyCode: number | undefined

  for (const token of tokens) {
    const lower = token.toLowerCase()

    if (MODIFIERS[lower]) {
      modifiers.push(MODIFIERS[lower])
      continue
    }

    if (key) {
      throw new Error(`Can't press ${input}: it names two keys.`)
    }

    if (/^[a-z0-9]$/.test(lower)) {
      key = lower
      continue
    }

    if (KEY_CODES[lower] !== undefined) {
      key = lower
      keyCode = KEY_CODES[lower]
      continue
    }

    throw new Error(`Can't press ${input}: ${token} is not a key it knows.`)
  }

  if (!key) {
    throw new Error(`Can't press ${input}: it names no key.`)
  }

  return {key, keyCode, modifiers}
}

const GLYPH_NAMES: Record<string, string> = {
  '⌃': 'MacCtrl',
  '⌥': 'Alt',
  '⇧': 'Shift',
  '⌘': 'Ctrl'
}

export function shortcutFromGlyphs(value: string): string {
  const parts: string[] = []
  let key = ''

  for (const char of String(value || '')) {
    if (GLYPH_NAMES[char]) parts.push(GLYPH_NAMES[char])
    else key += char
  }

  if (key) parts.push(key.toUpperCase())

  return parts.join('+')
}

const PRELUDE = `
ObjC.import('CoreGraphics')
const se = Application('System Events')
const safariApp = Application('Safari')
function role(el) { try { return String(el.role()) } catch (e) { return '' } }
function attr(el, name) {
  try {
    const v = el.attributes.byName(name).value()
    return v === undefined || v === null ? null : v
  } catch (e) { return null }
}
function kids(el) { try { return el.uiElements() } catch (e) { return [] } }
function walk(root, pred, depth, out) {
  if (depth > 16) return out
  for (const k of kids(root)) {
    let hit = false
    try { hit = pred(k) } catch (e) { hit = false }
    if (hit) out.push(k)
    walk(k, pred, depth + 1, out)
  }
  return out
}
// Stops at the first match and can be held to a depth: a full walk of every
// Safari window took 48 s on a Settings window with a long extension list.
function first(root, pred, maxDepth) {
  const limit = maxDepth === undefined ? 16 : maxDepth
  const visit = (el, depth) => {
    if (depth > limit) return null
    for (const k of kids(el)) {
      let hit = false
      try { hit = pred(k) } catch (e) { hit = false }
      if (hit) return k
      const deeper = visit(k, depth + 1)
      if (deeper) return deeper
    }
    return null
  }
  return visit(root, 0)
}
function safari() {
  const list = se.processes.whose({name: 'Safari'})()
  return list.length ? list[0] : null
}
function windows(proc) { return kids(proc).filter((e) => role(e) === 'AXWindow') }
function windowTitled(proc, title) {
  for (const w of windows(proc)) { if (String(attr(w, 'AXTitle') || '') === title) return w }
  return null
}
function toolbarTitles(w) {
  const bar = first(w, (e) => role(e) === 'AXToolbar', 1)
  return bar ? kids(bar).map((b) => String(attr(b, 'AXTitle') || '')) : null
}
function isSettingsWindow(w) {
  const names = toolbarTitles(w)
  if (!names) return false
  if (names.indexOf('Extensions') >= 0 && names.indexOf('Websites') >= 0) return true
  // Settings titles itself after the selected pane, and that pane is one of
  // its toolbar buttons. A browser window's title is the page title instead.
  const title = String(attr(w, 'AXTitle') || '')
  return title.length > 0 && names.length >= 6 && names.indexOf(title) >= 0
}
function settingsWindow(proc) {
  for (const w of windows(proc)) { if (isSettingsWindow(w)) return w }
  return null
}
function browserWindow(proc) {
  for (const w of windows(proc)) {
    if (isSettingsWindow(w)) continue
    const bar = first(w, (e) => role(e) === 'AXToolbar', 1)
    if (bar && kids(bar).some((b) => String(attr(b, 'AXIdentifier') || '').indexOf('WebExtension-') === 0 || String(attr(b, 'AXIdentifier') || '') === 'NewTabButton')) return w
  }
  return null
}
function frontmostName() {
  try {
    const front = se.processes.whose({frontmost: true})()
    return front.length ? String(front[0].name()) : 'no app'
  } catch (e) { return 'an unknown app' }
}
function describeWindows(proc) {
  const list = windows(proc)
  if (list.length === 0) {
    const front = frontmostName()
    return front === 'Safari'
      ? 'System Events lists no Safari window at all and Safari is frontmost'
      : 'Safari could not be brought to the front, ' + front + ' holds it, and System Events lists no Safari window from there. Leave Safari in front while this step runs'
  }
  const titles = list.map((w) => JSON.stringify(String(attr(w, 'AXTitle') || '')) + (toolbarTitles(w) ? '' : ' (no toolbar)'))
  return 'System Events lists ' + list.length + ' Safari window' + (list.length === 1 ? '' : 's') + ' (' + titles.join(', ') + ') and ' + frontmostName() + ' is frontmost'
}
function wait(check, seconds) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    let v = null
    try { v = check() } catch (e) { v = null }
    if (v) return v
    delay(0.25)
  }
  return null
}
// Safari can read a switch on and drop it a moment later, so the value that
// counts is the one read after a settle.
const SWITCH_SETTLE_S = 1
const SETTINGS_MENU_WAIT = 8
const SETTINGS_SHORTCUT_WAIT = 4
const PANE_BUTTON_WAIT = 5
function openSettings(proc) {
  // System Events lists no windows for a Safari that is not frontmost, and
  // Settings opened from the automation window closes with it, so Safari
  // comes to the front and gets a plain window before the menu is used.
  safariApp.activate()
  delay(0.4)
  let w = settingsWindow(proc)
  if (w) return w
  // In the Safari a WebDriver session raised, Settings asked for from the
  // automation window never opens, so a plain window is made and used.
  if (SCRIPT.automation || !browserWindow(proc)) {
    try { safariApp.Document().make() } catch (e) {}
    wait(() => browserWindow(proc), 6)
    safariApp.activate()
    delay(0.3)
  }
  const items = proc.menuBars[0].menuBarItems.byName('Safari').menus[0].menuItems()
  for (const it of items) {
    const name = String(attr(it, 'AXTitle') || '')
    if (/^(Settings|Preferences)/.test(name)) { it.click(); break }
  }
  w = wait(() => settingsWindow(proc), SETTINGS_MENU_WAIT)
  if (w) return w
  // A keystroke goes to whichever app is in front, so the shortcut is only
  // sent once Safari holds the front.
  safariApp.activate()
  delay(0.3)
  if (frontmostName() === 'Safari') {
    se.keystroke(',', {using: ['command down']})
    w = wait(() => settingsWindow(proc), SETTINGS_SHORTCUT_WAIT)
    if (w) return w
  }
  throw new Error('Safari Settings did not open within ' + (SETTINGS_MENU_WAIT + SETTINGS_SHORTCUT_WAIT) + ' s of the menu click and the Command-Comma shortcut: ' + describeWindows(proc))
}
function showPane(proc, title) {
  const w = openSettings(proc)
  // System Events also stops listing the window when another app takes the
  // front, so a read that finds no toolbar brings Safari forward again.
  const button = wait(() => {
    const bar = first(settingsWindow(proc) || w, (e) => role(e) === 'AXToolbar', 1)
    if (!bar) { safariApp.activate(); return null }
    return kids(bar).filter((b) => String(attr(b, 'AXTitle') || '') === title)[0]
  }, PANE_BUTTON_WAIT)
  if (!button) throw new Error('Safari Settings has no ' + title + ' pane after ' + PANE_BUTTON_WAIT + ' s: ' + describeWindows(proc))
  if (String(attr(w, 'AXTitle') || '') !== title) {
    button.click()
    const shown = wait(() => String(attr(settingsWindow(proc), 'AXTitle') || '') === title, 6)
    if (!shown) {
      const now = settingsWindow(proc)
      const reads = 'the window still reads ' + JSON.stringify(String(attr(now, 'AXTitle') || '')) + ' after a click on its ' + title + ' button'
      throw new Error('Safari Settings did not switch to ' + title + ': ' + (blockerOf(now) || reads))
    }
  }
  return settingsWindow(proc)
}
function blockerOf(w) {
  const sheet = w ? kids(w).filter((k) => role(k) === 'AXSheet')[0] : null
  if (sheet) {
    const said = walk(sheet, (e) => role(e) === 'AXStaticText', 0, []).map((t) => String(attr(t, 'AXValue') || '').trim()).filter((t) => t && t !== 'Safari')
    return 'a sheet is open on Safari Settings and waits for an answer' + (said.length ? ' ("' + said.join(' ').slice(0, 200) + '")' : '')
  }
  for (const name of ['SecurityAgent', 'coreautha']) {
    const list = se.processes.whose({name: name})()
    if (list.length && windows(list[0]).length) {
      const said = walk(windows(list[0])[0], (e) => role(e) === 'AXStaticText', 0, []).map((t) => String(attr(t, 'AXValue') || '').trim()).filter((t) => t && t !== 'Safari')
      return 'the macOS password prompt (' + name + ') is open and waits for an answer' + (said.length ? ' ("' + said.join(' ').slice(0, 240) + '")' : '')
    }
  }
  return null
}
// An alert Safari raises over a page is not a sheet of Settings, so it is
// looked for under every window, and read as its text and its buttons.
function isAlert(e) {
  const r = role(e), sub = String(attr(e, 'AXSubrole') || '')
  return r === 'AXSheet' || sub === 'AXDialog' || sub === 'AXSystemDialog'
}
function alertOf(proc) {
  for (const w of windows(proc)) {
    const box = isAlert(w) ? w : first(w, isAlert, 5)
    if (!box) continue
    // Safari 27 puts the message in the dialog's title and a text area, and
    // the address it refused in a static text, so all three are read.
    const read = (kind) => walk(box, (e) => role(e) === kind, 0, []).map((t) => String(attr(t, 'AXValue') || '').trim())
    const texts = [String(attr(box, 'AXTitle') || '').trim()].concat(read('AXTextArea'), read('AXStaticText')).filter((t, i, all) => t && all.indexOf(t) === i)
    const buttons = walk(box, (e) => role(e) === 'AXButton', 0, []).map((b) => String(attr(b, 'AXTitle') || '').trim()).filter(Boolean)
    return {text: texts.join(' ').slice(0, 240), buttons: buttons.slice(0, 4)}
  }
  return null
}
function closeSettings(proc) {
  const w = settingsWindow(proc)
  if (!w) return
  const close = kids(w).filter((b) => String(attr(b, 'AXSubrole') || '') === 'AXCloseButton')[0]
  if (close) close.click()
}
function checkboxById(w, id) {
  return first(w, (e) => role(e) === 'AXCheckBox' && String(attr(e, 'AXIdentifier') || '') === id)
}
function checkboxTitled(w, title) {
  return first(w, (e) => role(e) === 'AXCheckBox' && String(attr(e, 'AXTitle') || '').toLowerCase() === title.toLowerCase())
}
function readValue(cb) { const v = attr(cb, 'AXValue'); return v === null ? null : Number(v) }
function setChecked(cb, on) {
  const before = readValue(cb)
  if (before === (on ? 1 : 0)) return {before, after: before, clicked: false}
  cb.click()
  const settled = wait(() => (readValue(cb) === (on ? 1 : 0) ? 1 : null), 5)
  if (settled) delay(SWITCH_SETTLE_S)
  return {before, after: readValue(cb), clicked: true}
}
function center(el) {
  const p = el.position(), s = el.size()
  return {x: p[0] + s[0] / 2, y: p[1] + s[1] / 2}
}
function mouse(kind, button, point) {
  $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, kind, $.CGPointMake(point.x, point.y), button))
}
function leftClick(point) {
  mouse($.kCGEventLeftMouseDown, $.kCGMouseButtonLeft, point)
  delay(0.12)
  mouse($.kCGEventLeftMouseUp, $.kCGMouseButtonLeft, point)
}
function rightClick(point) {
  mouse($.kCGEventRightMouseDown, $.kCGMouseButtonRight, point)
  delay(0.12)
  mouse($.kCGEventRightMouseUp, $.kCGMouseButtonRight, point)
}
function selectRowOf(proc, id) {
  const cell = first(settingsWindow(proc), (e) => role(e) === 'AXCell' && kids(e).some((k) => role(k) === 'AXCheckBox' && String(attr(k, 'AXIdentifier') || '') === id))
  const label = cell ? kids(cell).filter((k) => role(k) === 'AXStaticText')[0] : null
  const target = label || checkboxById(settingsWindow(proc), id)
  // The click is a real mouse event, so a window of another app or extension
  // lying over the row takes it. Settings is raised first and read back.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    safariApp.activate()
    try { settingsWindow(proc).actions.byName('AXRaise').perform() } catch (e) {}
    delay(0.3)
    leftClick(center(target))
    if (wait(() => detailsOf(settingsWindow(proc)), 2)) return
  }
}
function detailsOf(w) {
  return first(w, (e) => role(e) === 'AXGroup' && String(attr(e, 'AXIdentifier') || '') === 'Extension Details Box')
}
function answer(value) { return JSON.stringify(value) }
function failure(error) { return JSON.stringify({ok: false, error: String(error && error.message ? error.message : error)}) }
`

function literal(value: string): string {
  return JSON.stringify(String(value))
}

export interface ScriptHeader {
  kind:
    | 'probe'
    | 'running'
    | 'close'
    | 'alert'
    | 'cancel'
    | 'unsigned'
    | 'enabled'
    | 'websites'
    | 'shortcut'
    | 'button'
    | 'menu'
    | 'press'
  action?: string
  id?: string
  key?: string
  modifiers?: string[]
  automation?: boolean
}

function header(value: ScriptHeader): string {
  return `const SCRIPT = ${JSON.stringify(value)}\n`
}

export function readScriptHeader(source: string): ScriptHeader | null {
  const match = /^const SCRIPT = (\{.*\})$/m.exec(String(source || ''))
  if (!match) return null

  try {
    return JSON.parse(match[1]) as ScriptHeader
  } catch {
    return null
  }
}

export function accessibilityProbeScript(): string {
  return `${header({kind: 'probe'})}${PRELUDE}
(() => {
  try {
    const front = se.processes.whose({frontmost: true})()
    const count = front.length ? kids(front[0]).length : 0
    return answer({ok: true, elements: count})
  } catch (e) { return failure(e) }
})()`
}

export function safariRunningScript(): string {
  return `${header({kind: 'running'})}${PRELUDE}
(() => {
  try { return answer({ok: true, running: Boolean(safari())}) } catch (e) { return failure(e) }
})()`
}

export function closeSettingsScript(): string {
  return `${header({kind: 'close'})}${PRELUDE}
(() => {
  try {
    const proc = safari()
    if (!proc) return answer({ok: true, open: false, blocker: null})
    const blocker = blockerOf(settingsWindow(proc))
    if (!blocker) closeSettings(proc)
    return answer({ok: true, open: Boolean(settingsWindow(proc)), blocker: blocker})
  } catch (e) { return failure(e) }
})()`
}

export function cancelPromptScript(): string {
  return `${header({kind: 'cancel'})}${PRELUDE}
(() => {
  try {
    const proc = safari()
    const roots = []
    const w = proc ? settingsWindow(proc) : null
    if (w) kids(w).filter((k) => role(k) === 'AXSheet').forEach((k) => roots.push(k))
    for (const name of ['SecurityAgent', 'coreautha']) {
      const list = se.processes.whose({name: name})()
      if (list.length) windows(list[0]).forEach((k) => roots.push(k))
    }
    let canceled = 0
    for (const root of roots) {
      const cancel = first(root, (e) => role(e) === 'AXButton' && String(attr(e, 'AXTitle') || '') === 'Cancel')
      if (cancel) { cancel.click(); canceled += 1 }
    }
    if (canceled) delay(0.8)
    return answer({ok: true, canceled: canceled})
  } catch (e) { return failure(e) }
})()`
}

export function safariAlertScript(): string {
  return `${header({kind: 'alert'})}${PRELUDE}
(() => {
  try {
    const proc = safari()
    return answer({ok: true, alert: proc ? alertOf(proc) : null})
  } catch (e) { return failure(e) }
})()`
}

export function unsignedExtensionsScript(
  action: 'read' | 'on',
  automation = false
): string {
  return `${header({kind: 'unsigned', action, ...(automation ? {automation} : {})})}${PRELUDE}
(() => {
  try {
    const proc = safari()
    if (!proc) return answer({ok: false, error: 'Safari is not running'})
    const w = showPane(proc, 'Developer')
    const cb = checkboxTitled(w, ${literal(UNSIGNED_EXTENSIONS_TITLE)})
    if (!cb) return answer({ok: false, error: 'no checkbox titled ${UNSIGNED_EXTENSIONS_TITLE}'})
    const before = readValue(cb)
    const result = ${action === 'on' ? 'setChecked(cb, true)' : '{before, after: before, clicked: false}'}
    const blocker = result.after === 1 ? null : blockerOf(settingsWindow(proc))
    return answer({ok: true, before: result.before, after: result.after, clicked: result.clicked, blocker: blocker})
  } catch (e) { return failure(e) }
})()`
}

export function extensionEnabledScript(
  checkboxId: string,
  action: 'read' | 'on' | 'off',
  automation = false
): string {
  const set =
    action === 'read'
      ? '{before, after: before, clicked: false}'
      : `setChecked(cb, ${action === 'on'})`

  return `${header({kind: 'enabled', action, id: checkboxId, ...(automation ? {automation} : {})})}${PRELUDE}
(() => {
  try {
    const proc = safari()
    if (!proc) return answer({ok: false, error: 'Safari is not running'})
    const w = showPane(proc, 'Extensions')
    const cb = wait(() => checkboxById(settingsWindow(proc), ${literal(checkboxId)}), 6)
    if (!cb) return answer({ok: true, listed: false, before: null, after: null, clicked: false})
    const before = readValue(cb)
    const result = ${set}
    const blocker = result.clicked && result.after !== result.before ? null : (result.clicked ? blockerOf(settingsWindow(proc)) : null)
    return answer({ok: true, listed: true, before: result.before, after: result.after, clicked: result.clicked, blocker: blocker})
  } catch (e) { return failure(e) }
})()`
}

export function otherWebsitesScript(
  checkboxId: string,
  action: 'read' | 'allow',
  automation = false
): string {
  const everyWebsite =
    automation && action === 'allow'
      ? `    if (!sites) {
      // The automation Safari leaves that button dead. The every-website
      // button and its confirm sheet grant the same access there.
      const details = box()
      const every = first(details, (e) => role(e) === 'AXButton' && String(attr(e, 'AXTitle') || '').indexOf(${literal(ALWAYS_ALLOW_TITLE)}) === 0)
      const notYet = () => first(box(), (e) => role(e) === 'AXStaticText' && String(attr(e, 'AXValue') || '').indexOf('have not allowed this extension') >= 0)
      if (!every && !notYet()) { closeSettings(proc); return answer({ok: true, listed: true, before: ${literal(OTHER_WEBSITES_ALLOW)}, after: ${literal(OTHER_WEBSITES_ALLOW)}, everyWebsite: true}) }
      if (!every) return answer({ok: false, error: 'the Websites pane did not open and the row has no ${ALWAYS_ALLOW_TITLE} button'})
      every.click()
      const confirm = wait(() => {
        const sheet = kids(settingsWindow(proc)).filter((k) => role(k) === 'AXSheet')[0]
        return sheet ? first(sheet, (e) => role(e) === 'AXButton' && String(attr(e, 'AXTitle') || '') === ${literal(ALWAYS_ALLOW_TITLE)}) : null
      }, 6)
      if (!confirm) return answer({ok: false, error: 'no confirm sheet after ${ALWAYS_ALLOW_TITLE}'})
      confirm.click()
      const gone = wait(() => (kids(settingsWindow(proc)).some((k) => role(k) === 'AXSheet') ? null : 1), 6)
      const still = notYet()
      closeSettings(proc)
      return answer({ok: true, listed: true, before: 'Ask', after: gone && !still ? ${literal(OTHER_WEBSITES_ALLOW)} : 'Ask', everyWebsite: true})
    }
`
      : ''

  return `${header({kind: 'websites', action, id: checkboxId, ...(automation ? {automation} : {})})}${PRELUDE}
(() => {
  try {
    const proc = safari()
    if (!proc) return answer({ok: false, error: 'Safari is not running'})
    let w = showPane(proc, 'Extensions')
    const cb = wait(() => checkboxById(settingsWindow(proc), ${literal(checkboxId)}), 6)
    if (!cb) return answer({ok: true, listed: false, before: null, after: null})
    selectRowOf(proc, ${literal(checkboxId)})
    const box = () => detailsOf(settingsWindow(proc))
    const edit = wait(() => first(box(), (e) => role(e) === 'AXButton' && String(attr(e, 'AXTitle') || '') === ${literal(EDIT_WEBSITES_TITLE)}), 6)
    if (!edit) return answer({ok: false, error: 'no ${EDIT_WEBSITES_TITLE} button for the selected row'})
    edit.click()
    const sites = wait(() => (String(attr(settingsWindow(proc), 'AXTitle') || '') === 'Websites' ? settingsWindow(proc) : null), 6)
${everyWebsite}    if (!sites) return answer({ok: false, error: 'the Websites pane did not open'})
    const pop = wait(() => first(settingsWindow(proc), (e) => role(e) === 'AXPopUpButton' && ['Ask', 'Deny', 'Allow'].indexOf(String(attr(e, 'AXValue') || '')) >= 0), 6)
    if (!pop) return answer({ok: false, error: 'no For other websites pop-up on the Websites pane'})
    const before = String(attr(pop, 'AXValue') || '')
    let after = before
    if (${action === 'allow'} && before !== ${literal(OTHER_WEBSITES_ALLOW)}) {
      pop.click()
      delay(1)
      const item = first(pop, (e) => role(e) === 'AXMenuItem' && String(attr(e, 'AXTitle') || '') === ${literal(OTHER_WEBSITES_ALLOW)})
      if (!item) { se.keyCode(53); return answer({ok: false, error: 'the pop-up has no Allow item'}) }
      item.click()
      wait(() => (String(attr(pop, 'AXValue') || '') === ${literal(OTHER_WEBSITES_ALLOW)} ? 1 : null), 5)
      after = String(attr(pop, 'AXValue') || '')
    }
    showPane(proc, 'Extensions')
    closeSettings(proc)
    return answer({ok: true, listed: true, before, after})
  } catch (e) { return failure(e) }
})()`
}

export function readShortcutScript(checkboxId: string): string {
  return `${header({kind: 'shortcut', action: 'read', id: checkboxId})}${PRELUDE}
(() => {
  try {
    const proc = safari()
    if (!proc) return answer({ok: false, error: 'Safari is not running'})
    showPane(proc, 'Extensions')
    const cb = wait(() => checkboxById(settingsWindow(proc), ${literal(checkboxId)}), 6)
    if (!cb) return answer({ok: true, listed: false, shortcut: null})
    selectRowOf(proc, ${literal(checkboxId)})
    const box = wait(() => detailsOf(settingsWindow(proc)), 6)
    if (!box) return answer({ok: false, error: 'the row selection showed no details box'})
    const field = wait(() => first(detailsOf(settingsWindow(proc)), (e) => role(e) === 'AXTextField'), 6)
    const value = field ? String(attr(field, 'AXValue') || '') : ''
    closeSettings(proc)
    return answer({ok: true, listed: true, shortcut: value || null})
  } catch (e) { return failure(e) }
})()`
}

const BROWSER_WINDOW = `
function toolbarButton(proc, id) {
  safariApp.activate()
  delay(0.3)
  let w = browserWindow(proc)
  if (!w) {
    safariApp.Document().make()
    w = wait(() => browserWindow(proc), 8)
  }
  if (!w) throw new Error('Safari has no browser window')
  const bar = first(w, (e) => role(e) === 'AXToolbar', 1)
  return kids(bar).filter((b) => String(attr(b, 'AXIdentifier') || '') === id)[0] || null
}
function describeButton(b) {
  const value = attr(b, 'AXValue')
  return {
    id: String(attr(b, 'AXIdentifier') || ''),
    title: attr(b, 'AXDescription') === null ? (attr(b, 'AXTitle') === null ? null : String(attr(b, 'AXTitle'))) : String(attr(b, 'AXDescription')),
    tooltip: attr(b, 'AXHelp') === null ? null : String(attr(b, 'AXHelp')),
    badge: typeof value === 'string' && value.length > 0 ? value : null,
    enabled: attr(b, 'AXEnabled') === null ? null : Boolean(attr(b, 'AXEnabled'))
  }
}
`

export function toolbarButtonScript(buttonId: string): string {
  return `${header({kind: 'button', id: buttonId})}${PRELUDE}${BROWSER_WINDOW}
(() => {
  try {
    const proc = safari()
    if (!proc) return answer({ok: false, error: 'Safari is not running'})
    const b = toolbarButton(proc, ${literal(buttonId)})
    if (!b) return answer({ok: true, found: false, button: null})
    return answer({ok: true, found: true, button: describeButton(b)})
  } catch (e) { return failure(e) }
})()`
}

export function toolbarMenuScript(buttonId: string): string {
  return `${header({kind: 'menu', id: buttonId})}${PRELUDE}${BROWSER_WINDOW}
(() => {
  try {
    const proc = safari()
    if (!proc) return answer({ok: false, error: 'Safari is not running'})
    const b = toolbarButton(proc, ${literal(buttonId)})
    if (!b) return answer({ok: true, found: false, items: []})
    rightClick(center(b))
    const menu = wait(() => kids(b).filter((k) => role(k) === 'AXMenu')[0] || kids(proc).filter((k) => role(k) === 'AXMenu')[0] || null, 4)
    const items = []
    if (menu) {
      for (const it of kids(menu)) {
        const title = String(attr(it, 'AXTitle') || '')
        if (!title) continue
        items.push({title, enabled: Boolean(attr(it, 'AXEnabled'))})
      }
    }
    se.keyCode(53)
    delay(0.4)
    return answer({ok: true, found: true, opened: Boolean(menu), items})
  } catch (e) { try { se.keyCode(53) } catch (x) {} return failure(e) }
})()`
}

export function pressShortcutScript(shortcut: ParsedShortcut): string {
  const using = JSON.stringify(shortcut.modifiers)
  const press =
    shortcut.keyCode === undefined
      ? `se.keystroke(${literal(shortcut.key)}, {using: ${using}})`
      : `se.keyCode(${shortcut.keyCode}, {using: ${using}})`

  return `${header({kind: 'press', key: shortcut.key, modifiers: shortcut.modifiers})}${PRELUDE}${BROWSER_WINDOW}
(() => {
  try {
    const proc = safari()
    if (!proc) return answer({ok: false, error: 'Safari is not running'})
    safariApp.activate()
    let w = browserWindow(proc)
    if (!w) { safariApp.Document().make(); w = wait(() => browserWindow(proc), 8) }
    if (!w) throw new Error('Safari has no browser window')
    delay(0.3)
    ${press}
    delay(0.5)
    return answer({ok: true, key: ${literal(shortcut.key)}, modifiers: ${using}})
  } catch (e) { return failure(e) }
})()`
}
