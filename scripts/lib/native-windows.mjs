// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {execFileSync} from 'node:child_process'

// A browser's native load-error alert (Opera: "Failed to load extension from:
// <path>. Extension type is not supported.") is not a page target and the
// accessibility API lists no window for it. The window server still does.
const LIST_WINDOWS_JXA = `
ObjC.import('CoreGraphics')
function run(argv) {
  const pid = Number(argv[0])
  let screenAccess = null
  try { screenAccess = Boolean($.CGPreflightScreenCaptureAccess()) } catch (e) {}
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0))) || []
  const windows = all
    .filter((w) => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0)
    .map((w) => ({
      id: w.kCGWindowNumber,
      name: w.kCGWindowName || '',
      onscreen: Boolean(w.kCGWindowIsOnscreen),
      width: Math.round(w.kCGWindowBounds.Width),
      height: Math.round(w.kCGWindowBounds.Height)
    }))
  return JSON.stringify({screenAccess, windows})
}
`

// Null means the window server could not be asked, which the caller reports
// as a skip. Only the pid the session contract names is ever looked up.
export function listNativeWindows(pid) {
  if (process.platform !== 'darwin') return null
  if (!Number.isInteger(pid) || pid <= 0) return null

  try {
    const out = execFileSync(
      'osascript',
      ['-l', 'JavaScript', '-e', LIST_WINDOWS_JXA, String(pid)],
      {encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore']}
    )
    const parsed = JSON.parse(out.trim().split(/\r?\n/).pop() || 'null')

    return parsed && Array.isArray(parsed.windows) ? parsed : null
  } catch {
    return null
  }
}

// Every healthy session measured owns helpers this size or smaller: 1 by 1
// anchors and 1512 by 33 menu bar strips.
const HELPER_EDGE = 100

function isSubstantial(window) {
  return window.width > HELPER_EDGE && window.height > HELPER_EDGE
}

function describeWindow(window) {
  return `${window.width} by ${window.height} (${window.onscreen ? 'on' : 'off'} screen)`
}

// Measured on macOS: a healthy session always owns one titled window, next to
// untitled ones that stay off screen (500 by 500 on Chrome, Opera and Vivaldi,
// 1029 by 592 on Opera, 416 by 183 on Yandex). Opera's load-error alert is the
// only window its process owns, untitled, 260 by 304 to 320. The on-screen
// flag follows the active Space, so it reads false for the alert and for a
// healthy main window alike and cannot carry the verdict.
export function judgeNativeWindows(windows) {
  const list = Array.isArray(windows) ? windows : []
  const titled = list.filter((window) => window.name)
  const untitled = list.filter(
    (window) => !window.name && isSubstantial(window)
  )

  if (!titled.length && untitled.length) {
    return {
      status: 'fail',
      detail: `the browser owns no titled window, only untitled ones: ${untitled
        .map(describeWindow)
        .join(
          ', '
        )}. It never opened a window of its own, which is what a native dialog blocking startup leaves (Opera raises a 260 by 304 alert for an extension it refuses to load)`
    }
  }

  if (!titled.length) {
    return {
      status: 'pass',
      detail: `the browser owns no titled window and no dialog-sized one (${list.length} helper window(s))`
    }
  }

  const loose = untitled.filter((window) => window.onscreen)

  if (loose.length) {
    return {
      status: 'pass',
      detail: `an untitled ${loose.map(describeWindow).join(' and ')} window sits next to "${titled[0].name}", look at it by hand`
    }
  }

  return {
    status: 'pass',
    detail: `"${titled[0].name}" ${describeWindow(titled[0])}, no untitled window on screen`
  }
}

export function argvIsHeadless(argvText) {
  return /(?:^|\s)--?headless(?:=\S*)?(?=\s|$)/.test(String(argvText || ''))
}

// Why the check cannot run here, or null when it can. A skip is always said
// out loud: a check that silently passes where it cannot look proves nothing.
export function nativeWindowSkipReason({platform, argvText, listing}) {
  if (platform !== 'darwin') {
    return `the window server is only read on macOS, this is ${platform}`
  }

  if (argvIsHeadless(argvText)) {
    return 'the session is headless, it has no window to read (clear EXTENSION_BROWSER_FLAGS for a headed run)'
  }

  if (!listing) return 'the window server did not answer for this pid'

  if (listing.screenAccess === false) {
    return 'window titles need the Screen Recording permission for this terminal, without them every window reads as untitled'
  }

  return null
}

// The paths one ps line carries after --load-extension=. A path can hold
// spaces, so the value runs to the next switch rather than the next space.
export function loadExtensionPaths(argvText) {
  const text = String(argvText || '')
  const start = text.indexOf('--load-extension=')
  if (start === -1) return []

  const value = text.slice(start + '--load-extension='.length)
  const end = value.search(/\s--[a-zA-Z]/)

  return (end === -1 ? value : value.slice(0, end))
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function themeCompanionPaths(argvText) {
  return loadExtensionPaths(argvText).filter((entry) =>
    /(?:^|[\\/])extension-js-theme(?:[\\/]|$)/.test(entry)
  )
}
