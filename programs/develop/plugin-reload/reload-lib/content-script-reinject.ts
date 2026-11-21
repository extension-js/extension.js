// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {isChromiumBasedBrowser} from '../../lib/constants'
import {humanLine} from '../../lib/messaging'
import type {
  ContentScriptWrapperExtension,
  ContentScriptWrapperModule,
  ContentScriptWrapperPoint,
  ContentScriptWrapperReadModule
} from '../../plugin-web-extension/shared/content-script-wrapper-extensions'
import * as messages from '../messages'

// Tells a root mounted by this build from one an earlier build left behind.
function createBuildToken(source: string): string {
  let hash = 0

  for (let index = 0; index < source.length; index++) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0
  }

  return hash.toString(16)
}

// Dev-only DOM instrumentation: it patches the Node.prototype removal APIs,
// installs a whole-document MutationObserver and writes data-extjs-debug-*.
const hostInstrumentationInline =
  'function __EXTENSIONJS_debugObserveOwnedRootRemoval(){\n' +
  '  try {\n' +
  '    if (!__EXTENSIONJS_HOST_INSTRUMENTATION_ENABLED) return;\n' +
  '    if (typeof globalThis !== "object" || !globalThis || globalThis.__EXTJS_DEBUG_REMOVAL_OBSERVER__) return;\n' +
  '    if (typeof MutationObserver !== "function" || typeof document === "undefined") return;\n' +
  '    var target = document.documentElement || document.body || document;\n' +
  '    if (!target) return;\n' +
  '    var observer = new MutationObserver(function(records){\n' +
  '      try {\n' +
  '        var ownedKey = __EXTENSIONJS_ownerToken();\n' +
  '        var findOwnedRoot = function(node){\n' +
  '          try {\n' +
  '            if (!node || node.nodeType !== 1) return null;\n' +
  '            if (typeof node.getAttribute === "function" && String(node.getAttribute("data-extjs-reinject-owner") || "") === ownedKey) return node;\n' +
  '            if (typeof node.querySelector === "function") {\n' +
  '              return node.querySelector("[data-extjs-reinject-owner=\\"" + ownedKey.replace(/"/g, "\\\\\\"") + "\\"]");\n' +
  '            }\n' +
  // A node the page detached can throw on query, so it is not an owned root
  '          } catch (error) {}\n' +
  '          return null;\n' +
  '        };\n' +
  '        for (var r = 0; r < records.length; r++) {\n' +
  '          var removedNodes = Array.from(records[r].removedNodes || []);\n' +
  '          for (var n = 0; n < removedNodes.length; n++) {\n' +
  '            var node = removedNodes[n];\n' +
  '            var ownedRoot = findOwnedRoot(node);\n' +
  '            if (!ownedRoot || typeof ownedRoot.getAttribute !== "function") continue;\n' +
  '            var owner = String(ownedRoot.getAttribute("data-extjs-reinject-owner") || "");\n' +
  '            if (!owner || owner !== ownedKey) continue;\n' +
  '            var pageRoot = document.documentElement;\n' +
  '            if (pageRoot && typeof pageRoot.setAttribute === "function") {\n' +
  '              if (!pageRoot.getAttribute("data-extjs-debug-last-removal")) pageRoot.setAttribute("data-extjs-debug-last-removal", "mutation-observer");\n' +
  '              if (!pageRoot.getAttribute("data-extjs-debug-last-removal-key")) pageRoot.setAttribute("data-extjs-debug-last-removal-key", owner);\n' +
  '              if (!pageRoot.getAttribute("data-extjs-debug-last-removal-source")) pageRoot.setAttribute("data-extjs-debug-last-removal-source", "mutation-observer");\n' +
  '              if (!pageRoot.getAttribute("data-extjs-debug-last-removed-node-tag")) pageRoot.setAttribute("data-extjs-debug-last-removed-node-tag", String(node.tagName || "").toLowerCase());\n' +
  '              if (!pageRoot.getAttribute("data-extjs-debug-last-removed-node-id")) pageRoot.setAttribute("data-extjs-debug-last-removed-node-id", String(node.id || ""));\n' +
  '              if (!pageRoot.getAttribute("data-extjs-debug-last-removed-node-class")) pageRoot.setAttribute("data-extjs-debug-last-removed-node-class", String(node.className || ""));\n' +
  '              if (!pageRoot.getAttribute("data-extjs-debug-last-removed-node-direct")) pageRoot.setAttribute("data-extjs-debug-last-removed-node-direct", String(node === ownedRoot));\n' +
  '              if (!pageRoot.getAttribute("data-extjs-debug-last-removal-ready-state")) pageRoot.setAttribute("data-extjs-debug-last-removal-ready-state", String(document.readyState || ""));\n' +
  '              if (!pageRoot.getAttribute("data-extjs-debug-last-removal-url")) pageRoot.setAttribute("data-extjs-debug-last-removal-url", String(location.href || ""));\n' +
  '              pageRoot.setAttribute("data-extjs-debug-stage", "root-removed-observed");\n' +
  '            }\n' +
  '            return;\n' +
  '          }\n' +
  '        }\n' +
  // Removal tracing is debug only and must not break the page observer
  '      } catch (error) {}\n' +
  '    });\n' +
  '    observer.observe(target, { childList: true, subtree: true });\n' +
  '    globalThis.__EXTJS_DEBUG_REMOVAL_OBSERVER__ = observer;\n' +
  // Without a usable MutationObserver the removal trace stays off
  '  } catch (error) {}\n' +
  '}\n' +
  'function __EXTENSIONJS_patchDomRemovalApis(){\n' +
  '  try {\n' +
  '    if (!__EXTENSIONJS_HOST_INSTRUMENTATION_ENABLED) return;\n' +
  '    if (typeof globalThis !== "object" || !globalThis || globalThis.__EXTJS_DEBUG_DOM_APIS_PATCHED__) return;\n' +
  '    var record = function(source, node, parent){\n' +
  '      try {\n' +
  '        var pageRoot = document.documentElement;\n' +
  '        if (!pageRoot || typeof pageRoot.setAttribute !== "function") return;\n' +
  '        var ownedRoot = null;\n' +
  '        if (node && node.nodeType === 1) {\n' +
  '          if (typeof node.getAttribute === "function" && String(node.getAttribute("data-extjs-reinject-owner") || "") === __EXTENSIONJS_ownerToken()) ownedRoot = node;\n' +
  '          else if (typeof node.querySelector === "function") ownedRoot = node.querySelector("[data-extjs-reinject-owner=\\"" + __EXTENSIONJS_ownerToken().replace(/"/g, "\\\\\\"") + "\\"]");\n' +
  '        }\n' +
  '        if (!ownedRoot) return;\n' +
  '        pageRoot.setAttribute("data-extjs-debug-stage", "dom-api-removal");\n' +
  '        pageRoot.setAttribute("data-extjs-debug-last-removal", source);\n' +
  '        pageRoot.setAttribute("data-extjs-debug-last-removal-source", source);\n' +
  '        pageRoot.setAttribute("data-extjs-debug-last-removal-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
  '        pageRoot.setAttribute("data-extjs-debug-last-removed-node-tag", String(node && node.tagName || "").toLowerCase());\n' +
  '        pageRoot.setAttribute("data-extjs-debug-last-removed-node-id", String(node && node.id || ""));\n' +
  '        pageRoot.setAttribute("data-extjs-debug-last-removed-node-class", String(node && node.className || ""));\n' +
  '        pageRoot.setAttribute("data-extjs-debug-last-removed-node-direct", String(node === ownedRoot));\n' +
  '        pageRoot.setAttribute("data-extjs-debug-last-removal-ready-state", String(document.readyState || ""));\n' +
  '        pageRoot.setAttribute("data-extjs-debug-last-removal-url", String(location.href || ""));\n' +
  '        pageRoot.setAttribute("data-extjs-debug-last-removal-parent-tag", String(parent && parent.tagName || "").toLowerCase());\n' +
  // A failed debug write must not block the page's own node removal
  '      } catch (error) {}\n' +
  '    };\n' +
  '    try {\n' +
  '      var originalRemoveChild = Node.prototype.removeChild;\n' +
  '      if (typeof originalRemoveChild === "function") {\n' +
  '        Node.prototype.removeChild = function(child){\n' +
  '          record("Node.removeChild", child, this);\n' +
  '          return originalRemoveChild.call(this, child);\n' +
  '        };\n' +
  '      }\n' +
  // A locked Node prototype leaves removeChild untraced, nothing else
  '    } catch (error) {}\n' +
  '    try {\n' +
  '      var originalReplaceChildren = Element.prototype.replaceChildren;\n' +
  '      if (typeof originalReplaceChildren === "function") {\n' +
  '        Element.prototype.replaceChildren = function(){\n' +
  '          try {\n' +
  '            var existing = Array.from(this.childNodes || []);\n' +
  '            for (var i = 0; i < existing.length; i++) record("Element.replaceChildren", existing[i], this);\n' +
  // Tracing must never stop the page's own replaceChildren call
  '          } catch (error) {}\n' +
  '          return originalReplaceChildren.apply(this, arguments);\n' +
  '        };\n' +
  '      }\n' +
  // A locked Element prototype leaves replaceChildren untraced
  '    } catch (error) {}\n' +
  '    globalThis.__EXTJS_DEBUG_DOM_APIS_PATCHED__ = true;\n' +
  // DOM removal tracing is debug only, the reload goes on without it
  '  } catch (error) {}\n' +
  '}\n' +
  'if (__EXTENSIONJS_HOST_INSTRUMENTATION_ENABLED) {\n' +
  // The removal observer is debug only and must not stop the bundle
  '  try { __EXTENSIONJS_debugObserveOwnedRootRemoval(); } catch (error) {}\n' +
  // Removal API patches are debug only and must not stop the bundle
  '  try { __EXTENSIONJS_patchDomRemovalApis(); } catch (error) {}\n' +
  '}\n'

// Reinject markers and the root sweeps they drive: a development bundle
// can be injected many times into one live page, so it has to find and
// retire whatever its previous generation left behind.
const reinjectMarkerInline =
  'function __EXTENSIONJS_setReinjectMarker(key, generation, status){\n' +
  '  try {\n' +
  '    if (!__EXTENSIONJS_DEV_MARKERS_ENABLED || typeof document === "undefined") return;\n' +
  '    var root = document.body || document.documentElement;\n' +
  '    if (!root) return;\n' +
  '    var __extjsToken = __EXTENSIONJS_ownerToken();\n' +
  '    var marker = null;\n' +
  '    try {\n' +
  '      var markers = Array.from(document.querySelectorAll("[data-extjs-reinject-marker=\\"true\\"]"));\n' +
  '      for (var i = 0; i < markers.length; i++) {\n' +
  '        var current = markers[i];\n' +
  '        if (!current || typeof current.getAttribute !== "function") continue;\n' +
  // Match by qualified owner (key + extension id): distinct extensions share
  // bundle keys, and sharing a marker element corrupts generation tracking.
  '        var currentOwner = String(current.getAttribute("data-extjs-marker-owner") || "");\n' +
  '        if (currentOwner === __extjsToken) { marker = current; break; }\n' +
  '        if (!currentOwner && current.getAttribute("data-extjs-reinject-key") === key) { marker = current; break; }\n' +
  '      }\n' +
  // A failed marker lookup falls through to a fresh marker below
  '    } catch (error) {}\n' +
  '    if (!marker && typeof document.createElement === "function") {\n' +
  '      marker = document.createElement("div");\n' +
  '      marker.setAttribute("data-extjs-reinject-marker", "true");\n' +
  '      marker.setAttribute("hidden", "");\n' +
  '      marker.setAttribute("aria-hidden", "true");\n' +
  // The hidden attribute still hides a marker whose style is locked
  '      try { marker.style.display = "none"; } catch (error) {}\n' +
  '      root.appendChild(marker);\n' +
  '    }\n' +
  '    if (!marker) return;\n' +
  '    marker.setAttribute("data-extjs-reinject-key", String(__EXTENSIONJS_BUNDLE_KEY || key || ""));\n' +
  '    marker.setAttribute("data-extjs-marker-owner", __extjsToken);\n' +
  '    marker.setAttribute("data-extjs-reinject-generation", String(generation));\n' +
  '    marker.setAttribute("data-extjs-reinject-status", String(status || "mounted"));\n' +
  '    marker.setAttribute("data-extjs-reinject-build", String(__EXTENSIONJS_REINJECT_BUILD_TOKEN || ""));\n' +
  // Marker text is a debug label, its attributes carry the real state
  '    try { marker.textContent = String(__EXTENSIONJS_BUNDLE_KEY || key || "") + ":" + String(generation) + ":" + String(status || "mounted"); } catch (error) {}\n' +
  '    try {\n' +
  '      var roots = Array.from(document.querySelectorAll("#extension-root,[data-extension-root]:not([data-extension-root=\\"extension-js-devtools\\"])"));\n' +
  '      var ownedRootCount = 0;\n' +
  '      for (var j = 0; j < roots.length; j++) {\n' +
  '        var host = roots[j];\n' +
  '        if (!host || typeof host.setAttribute !== "function") continue;\n' +
  '        var hostOwner = String(host.getAttribute("data-extjs-reinject-owner") || "");\n' +
  '        if (hostOwner && hostOwner !== __extjsToken) continue;\n' +
  // Companion extensions (devtools/theme) never adopt anonymous roots, an
  // unowned root in the shared DOM belongs to the USER extension mid-mount.
  '        if (!hostOwner && __EXTENSIONJS_NO_FOREIGN_ADOPT) continue;\n' +
  // Adopt only roots OUR mount created: anything unowned that predates the
  // mount belongs to a sibling script or another extension.
  '        if (!hostOwner && __EXTENSIONJS_PRE_MOUNT_ROOTS.indexOf(host) !== -1) continue;\n' +
  '        ownedRootCount++;\n' +
  '        host.setAttribute("data-extjs-reinject-owner", __extjsToken);\n' +
  '        host.setAttribute("data-extjs-reinject-key", String(__EXTENSIONJS_BUNDLE_KEY || key || ""));\n' +
  '        host.setAttribute("data-extjs-reinject-generation", String(generation));\n' +
  '        host.setAttribute("data-extjs-reinject-status", String(status || "mounted"));\n' +
  '        host.setAttribute("data-extjs-reinject-build", String(__EXTENSIONJS_REINJECT_BUILD_TOKEN || ""));\n' +
  '        try {\n' +
  '          if (!host.__extjsDebugRemovePatched) {\n' +
  '            host.__extjsDebugRemovePatched = true;\n' +
  '            var __extjsOriginalRemove = typeof host.remove === "function" ? host.remove.bind(host) : null;\n' +
  '            if (__extjsOriginalRemove) {\n' +
  '              host.remove = function(){\n' +
  '                try {\n' +
  '                  var pageRoot = document.documentElement;\n' +
  '                  if (pageRoot && typeof pageRoot.setAttribute === "function") {\n' +
  '                    pageRoot.setAttribute("data-extjs-debug-stage", "root-remove-called");\n' +
  '                    pageRoot.setAttribute("data-extjs-debug-last-removal", "remove()");\n' +
  '                    pageRoot.setAttribute("data-extjs-debug-last-removal-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
  '                    pageRoot.setAttribute("data-extjs-debug-last-removal-source", "patched-host-remove");\n' +
  '                  }\n' +
  // A failed debug write must not block the root's own remove call
  '                } catch (error) {}\n' +
  '                return __extjsOriginalRemove();\n' +
  '              };\n' +
  '            }\n' +
  '          }\n' +
  // A host that refuses the remove patch only loses removal tracing
  '        } catch (error) {}\n' +
  '      }\n' +
  '      try {\n' +
  '        marker.setAttribute("data-extjs-debug-stage", String(status || ""));\n' +
  '        marker.setAttribute("data-extjs-debug-root-count", String(roots.length));\n' +
  '        marker.setAttribute("data-extjs-debug-owned-root-count", String(ownedRootCount));\n' +
  '        marker.setAttribute("data-extjs-debug-marker-count", String(markers.length));\n' +
  // Root and marker counts on the marker are debug diagnostics only
  '      } catch (error) {}\n' +
  // Roots left untagged here are swept as orphans on the next run
  '    } catch (error) {}\n' +
  '    try {\n' +
  '      var pageRoot = document.documentElement;\n' +
  '      if (pageRoot && typeof pageRoot.setAttribute === "function") {\n' +
  '        pageRoot.setAttribute("data-extjs-last-reinject-key", String(__EXTENSIONJS_BUNDLE_KEY || key || ""));\n' +
  '        pageRoot.setAttribute("data-extjs-last-reinject-generation", String(generation));\n' +
  '        pageRoot.setAttribute("data-extjs-last-reinject-status", String(status || "mounted"));\n' +
  '        pageRoot.setAttribute("data-extjs-last-reinject-build", String(__EXTENSIONJS_REINJECT_BUILD_TOKEN || ""));\n' +
  '        pageRoot.setAttribute("data-extjs-debug-stage", marker.getAttribute("data-extjs-debug-stage") || String(status || ""));\n' +
  '        pageRoot.setAttribute("data-extjs-debug-root-count", marker.getAttribute("data-extjs-debug-root-count") || "0");\n' +
  '        pageRoot.setAttribute("data-extjs-debug-owned-root-count", marker.getAttribute("data-extjs-debug-owned-root-count") || "0");\n' +
  '        pageRoot.setAttribute("data-extjs-debug-marker-count", marker.getAttribute("data-extjs-debug-marker-count") || "0");\n' +
  '      }\n' +
  // The page root mirror of the marker state is diagnostic only
  '    } catch (error) {}\n' +
  // A page that blocks DOM writes runs the bundle without markers
  '  } catch (error) {}\n' +
  '}\n' +
  'function __EXTENSIONJS_cleanupKnownRoots(staleEvenIfSameBuild){\n' +
  '  try {\n' +
  '    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;\n' +
  '    var __extjsToken = __EXTENSIONJS_ownerToken();\n' +
  '    var roots = Array.from(document.querySelectorAll("#extension-root,[data-extension-root]:not([data-extension-root=\\"extension-js-devtools\\"])"));\n' +
  '    for (var i = 0; i < roots.length; i++) {\n' +
  '      var host = roots[i];\n' +
  '      if (!host || typeof host.getAttribute !== "function") continue;\n' +
  '      var hostOwner = String(host.getAttribute("data-extjs-reinject-owner") || "");\n' +
  '      if (!hostOwner || hostOwner !== __extjsToken) continue;\n' +
  '      // Build-aware: only remove hosts owned by us whose build token does NOT\n' +
  '      // match the current bundle. Fresh roots from the current mount carry\n' +
  '      // the active build token and must be preserved; orphans from a prior\n' +
  '      // build (e.g. the old isolated world after `chrome.runtime.reload`)\n' +
  '      // carry stale tokens and should be cleared so we never end up with two\n' +
  '      // hosts owned by the same key.\n' +
  '      // EXCEPT when this bundle starts in a FRESH world (no registry entry,\n' +
  '      // because the old isolated world was destroyed by `chrome.runtime.reload`):\n' +
  '      // a same-build root then predates this execution and is a stale zombie\n' +
  '      // (its scripts died with the world). Unedited sibling scripts in a\n' +
  '      // multi-script entry keep their build token across recompiles, so the\n' +
  '      // token equality alone must not protect them here.\n' +
  '      var hostBuild = String(host.getAttribute("data-extjs-reinject-build") || "");\n' +
  '      var currentBuild = String(__EXTENSIONJS_REINJECT_BUILD_TOKEN || "");\n' +
  '      if (!staleEvenIfSameBuild && hostBuild && currentBuild && hostBuild === currentBuild) continue;\n' +
  '      try {\n' +
  '        var pageRoot = document.documentElement;\n' +
  '        if (pageRoot && typeof pageRoot.setAttribute === "function") {\n' +
  '          pageRoot.setAttribute("data-extjs-debug-stage", "cleanup-known-roots");\n' +
  '          pageRoot.setAttribute("data-extjs-debug-last-removal", "cleanup-known-roots");\n' +
  '          pageRoot.setAttribute("data-extjs-debug-last-removal-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
  '          pageRoot.setAttribute("data-extjs-debug-last-removal-source", "cleanup-known-roots");\n' +
  '          pageRoot.setAttribute("data-extjs-debug-last-removed-node-tag", String(host.tagName || "").toLowerCase());\n' +
  '        }\n' +
  // A failed debug write must not stop the stale root removal below
  '      } catch (error) {}\n' +
  // A root the page already detached has nothing left to remove
  '      try { host.remove(); } catch (error) {}\n' +
  '    }\n' +
  // A failed stale root sweep must not stop the new mount
  '  } catch (error) {}\n' +
  '}\n' +
  'function __EXTENSIONJS_cleanupOrphanRoots(){\n' +
  '  try {\n' +
  '    // At bundle execution start, before this run has mounted anything, any\n' +
  '    // `data-extension-root` host without `data-extjs-reinject-owner` is an\n' +
  '    // orphan from a prior session that died before `setReinjectMarker`\n' +
  '    // could tag it (typically: the previous isolated world was destroyed\n' +
  '    // by a `chrome.runtime.reload` mid-mount, or its `whenReady`-deferred\n' +
  '    // `apply` never fired). We have not created our own root yet, so any\n' +
  '    // untagged host we touch here is by definition not from THIS run, but\n' +
  '    // it may belong to a DIFFERENT extension mid-mount in the same DOM.\n' +
  '    // Companion extensions never sweep, and everyone else sweeps only when\n' +
  '    // a reinject marker proves a prior generation of THIS script ran here.\n' +
  '    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;\n' +
  '    if (__EXTENSIONJS_NO_FOREIGN_ADOPT) return;\n' +
  '    var __extjsToken = __EXTENSIONJS_ownerToken();\n' +
  '    var sawPriorGeneration = false;\n' +
  '    try {\n' +
  '      var markers = Array.from(document.querySelectorAll("[data-extjs-reinject-marker=\\"true\\"]"));\n' +
  '      for (var m = 0; m < markers.length; m++) {\n' +
  '        if (markers[m] && typeof markers[m].getAttribute === "function" && String(markers[m].getAttribute("data-extjs-marker-owner") || "") === __extjsToken) { sawPriorGeneration = true; break; }\n' +
  '      }\n' +
  // Unreadable markers prove no prior generation, so nothing is swept
  '    } catch (error) {}\n' +
  '    if (!sawPriorGeneration) return;\n' +
  '    var roots = Array.from(document.querySelectorAll("[data-extension-root]:not([data-extension-root=\\"extension-js-devtools\\"])"));\n' +
  '    for (var i = 0; i < roots.length; i++) {\n' +
  '      var host = roots[i];\n' +
  '      if (!host || typeof host.getAttribute !== "function") continue;\n' +
  '      var hostOwner = String(host.getAttribute("data-extjs-reinject-owner") || "");\n' +
  '      if (hostOwner) continue;\n' +
  // An orphan the page already detached has nothing left to remove
  '      try { host.remove(); } catch (error) {}\n' +
  '    }\n' +
  // A failed orphan sweep must not stop this bundle from mounting
  '  } catch (error) {}\n' +
  '}\n'

function textAt(
  point: ContentScriptWrapperPoint,
  module: ContentScriptWrapperModule
): string {
  switch (point) {
    case 'style-host-filter':
      return (
        '          var hostOwner = String(host.getAttribute("data-extjs-reinject-owner") || "");\n' +
        '          if (hostOwner && hostOwner !== __extjsToken) continue;\n' +
        '          if (!hostOwner && __EXTENSIONJS_NO_FOREIGN_ADOPT) continue;\n' +
        '          if (!hostOwner && __EXTENSIONJS_PRE_MOUNT_ROOTS.indexOf(host) !== -1) continue;\n' +
        '          if (!hostOwner && String(host.getAttribute("data-extjs-reinject-key") || "") && String(host.getAttribute("data-extjs-reinject-key") || "") !== String(__EXTENSIONJS_BUNDLE_KEY || "")) continue;\n'
      )
    case 'after-bridge-base':
      return `var __EXTENSIONJS_REINJECT_BUILD_TOKEN=${JSON.stringify(createBuildToken(module.source))};\n`
    case 'after-owner-token':
      return (
        'var __EXTENSIONJS_DEV_MARKERS_ENABLED=true;\n' +
        // A MAIN world script shares the page's own globals and DOM prototypes,
        // so the observer and the removal API patches would land on the host
        // page itself, those stay in the isolated world.
        `var __EXTENSIONJS_HOST_INSTRUMENTATION_ENABLED=${JSON.stringify(!module.isMainWorld)};\n`
      )
    case 'after-style-urls':
      return 'var __EXTENSIONJS_REINJECT_REGISTRY=(typeof globalThis==="object" && globalThis ? (globalThis.__EXTENSIONJS_DEV_REINJECT__ || (globalThis.__EXTENSIONJS_DEV_REINJECT__={})) : {});\n'
    case 'after-cleanup-list':
      return (
        'function __EXTENSIONJS_readReinjectGeneration(entry){\n' +
        '  try {\n' +
        '    if (!entry) return 0;\n' +
        '    if (typeof entry === "function" && typeof entry.__extjsGeneration === "number") return entry.__extjsGeneration;\n' +
        '    if (typeof entry === "object") {\n' +
        '      if (typeof entry.__extjsGeneration === "number") return entry.__extjsGeneration;\n' +
        '      if (typeof entry.generation === "number") return entry.generation;\n' +
        '      if (typeof entry.cleanup === "function" && typeof entry.cleanup.__extjsGeneration === "number") return entry.cleanup.__extjsGeneration;\n' +
        '    }\n' +
        // An unreadable registry entry counts as generation zero below
        '  } catch (error) {}\n' +
        '  return 0;\n' +
        '}\n'
      )
    case 'after-register-cleanup':
      return reinjectMarkerInline
    case 'in-composed-cleanup':
      return (
        // A failed root sweep must not block the rest of the cleanup
        '    try { __EXTENSIONJS_cleanupKnownRoots(); } catch (error) {}\n' +
        // The cleaned marker is diagnostic, a failed write keeps cleanup going
        '    try { __EXTENSIONJS_setReinjectMarker(__EXTENSIONJS_REINJECT_KEY, Number(__EXTENSIONJS_REINJECT_GENERATION) || 0, "cleaned"); } catch (error) {}\n'
      )
    case 'after-composed-cleanup':
      return (
        'function __EXTENSIONJS_recordExecutionSnapshot(stage){\n' +
        '  try {\n' +
        '    if (!__EXTENSIONJS_DEV_MARKERS_ENABLED) return;\n' +
        '    if (typeof document === "undefined") return;\n' +
        '    var pageRoot = document.documentElement;\n' +
        '    if (!pageRoot || typeof pageRoot.getAttribute !== "function" || typeof pageRoot.setAttribute !== "function") return;\n' +
        '    var currentCount = Number(pageRoot.getAttribute("data-extjs-debug-execution-count") || "0");\n' +
        '    var nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;\n' +
        '    var roots = [];\n' +
        // An unreadable root list records a zero count in the snapshot
        '    try { roots = Array.from(document.querySelectorAll("#extension-root,[data-extension-root]:not([data-extension-root=\\"extension-js-devtools\\"])")); } catch (error) {}\n' +
        '    pageRoot.setAttribute("data-extjs-debug-execution-count", String(nextCount));\n' +
        '    pageRoot.setAttribute("data-extjs-debug-last-execution-stage", String(stage || ""));\n' +
        '    pageRoot.setAttribute("data-extjs-debug-last-execution-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
        '    pageRoot.setAttribute("data-extjs-debug-existing-root-count-before-cleanup", String(roots.length));\n' +
        // The execution snapshot is diagnostic and must not stop the bundle
        '  } catch (error) {}\n' +
        '}\n'
      )
    case 'before-asset-base':
      return (
        (module.isMainWorld ? '' : hostInstrumentationInline) +
        'if (__EXTENSIONJS_DEV_MARKERS_ENABLED) {\n' +
        // A failed bootstrap snapshot only loses a debug attribute
        '  try { __EXTENSIONJS_recordExecutionSnapshot("bootstrap"); } catch (error) {}\n' +
        '}\n' +
        'var __EXTENSIONJS_previousEntry=__EXTENSIONJS_REINJECT_REGISTRY[__EXTENSIONJS_REINJECT_KEY];\n' +
        'var __EXTENSIONJS_REINJECT_GENERATION=__EXTENSIONJS_readReinjectGeneration(__EXTENSIONJS_previousEntry);\n' +
        '// Sweep untagged orphans (prior-session roots that died before tagging)\n' +
        '// before any further cleanup runs. Safe here because our mount has not\n' +
        '// produced any roots yet, any untagged host is by definition not ours.\n' +
        // A failed orphan sweep must not stop this bundle from mounting
        'try { __EXTENSIONJS_cleanupOrphanRoots(); } catch (error) {}\n' +
        'try {\n' +
        '  var __EXTENSIONJS_previousCleanup=typeof __EXTENSIONJS_previousEntry === "function" ? __EXTENSIONJS_previousEntry : (__EXTENSIONJS_previousEntry && typeof __EXTENSIONJS_previousEntry.cleanup === "function" ? __EXTENSIONJS_previousEntry.cleanup : null);\n' +
        '  if (typeof __EXTENSIONJS_previousCleanup === "function") {\n' +
        '    if (__EXTENSIONJS_DEV_MARKERS_ENABLED) {\n' +
        '      try {\n' +
        '        var __extjsPageRoot = document.documentElement;\n' +
        '        if (__extjsPageRoot && typeof __extjsPageRoot.setAttribute === "function") {\n' +
        '          __extjsPageRoot.setAttribute("data-extjs-debug-stage", "previous-cleanup");\n' +
        '          __extjsPageRoot.setAttribute("data-extjs-debug-last-removal", "previous-cleanup");\n' +
        '          __extjsPageRoot.setAttribute("data-extjs-debug-last-removal-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
        '          __extjsPageRoot.setAttribute("data-extjs-debug-last-removal-source", "previous-cleanup");\n' +
        '        }\n' +
        // A failed debug write must not skip the previous cleanup call
        '      } catch (error) {}\n' +
        '    }\n' +
        '    __EXTENSIONJS_previousCleanup();\n' +
        '  }\n' +
        // A throwing previous cleanup must not block the new mount
        '} catch (error) {}\n' +
        // No registry entry = fresh isolated world: any root we own predates this
        // execution and must go, even when its build token still matches.
        // A failed stale root sweep must not block the new mount
        'try { __EXTENSIONJS_cleanupKnownRoots(!__EXTENSIONJS_previousEntry); } catch (error) {}\n' +
        // A top-level await ends this run before the script mounts, so the
        // next injection has to find this copy and retire it while it waits.
        'var __EXTENSIONJS_retired=false;\n' +
        'function __EXTENSIONJS_retire(){\n' +
        '  __EXTENSIONJS_retired = true;\n' +
        // A throwing cleanup must not undo the retired flag set above
        '  try { __EXTENSIONJS_composeCleanup(null)(); } catch (error) {}\n' +
        '}\n' +
        'try {\n' +
        '  __EXTENSIONJS_retire.__extjsGeneration = __EXTENSIONJS_REINJECT_GENERATION;\n' +
        '  __EXTENSIONJS_REINJECT_REGISTRY[__EXTENSIONJS_REINJECT_KEY] = __EXTENSIONJS_retire;\n' +
        // A locked registry only means the next run cannot retire this copy
        '} catch (error) {}\n'
      )
    case 'mount-without-function':
      return (
        // A failed generation bump leaves the marker on the prior count
        '    try { __EXTENSIONJS_REINJECT_GENERATION = (Number(__EXTENSIONJS_REINJECT_GENERATION) || 0) + 1; } catch (error) {}\n' +
        // The executed marker is diagnostic and must not stop the bundle
        '    try { __EXTENSIONJS_setReinjectMarker(__EXTENSIONJS_REINJECT_KEY, Number(__EXTENSIONJS_REINJECT_GENERATION) || 0, "executed"); } catch (error) {}\n'
      )
    case 'after-mount':
      return (
        '      __EXTENSIONJS_REINJECT_GENERATION = (Number(__EXTENSIONJS_REINJECT_GENERATION) || 0) + 1;\n' +
        // The registry stores unmount, so the generation has to ride on it.
        // A locked unmount function still unmounts without generation tags
        '      try { unmount.__extjsGeneration = __EXTENSIONJS_REINJECT_GENERATION; unmount.__extjsKey = __EXTENSIONJS_REINJECT_KEY; } catch (error) {}\n' +
        // The mounted marker is diagnostic and must not stop the bundle
        '      try { __EXTENSIONJS_setReinjectMarker(__EXTENSIONJS_REINJECT_KEY, __EXTENSIONJS_REINJECT_GENERATION, "mounted"); } catch (error) {}\n'
      )
    case 'mount-failed':
      // The mount error is already warned above, this marker is diagnostic
      return '      try { __EXTENSIONJS_setReinjectMarker(__EXTENSIONJS_REINJECT_KEY, Number(__EXTENSIONJS_REINJECT_GENERATION) || 0, "mount-error"); } catch (ignored) {}\n'
    case 'end-before-styles':
      return (
        `try { if (!__EXTENSIONJS_retired) __EXTENSIONJS_REINJECT_GENERATION = (Number(__EXTENSIONJS_REINJECT_GENERATION) || 0) + 1; } catch (error) {
        // A failed bump leaves the marker on the count before it
      }\n` +
        `try { if (!__EXTENSIONJS_retired) __EXTENSIONJS_setReinjectMarker(__EXTENSIONJS_REINJECT_KEY, Number(__EXTENSIONJS_REINJECT_GENERATION) || 0, "executed"); } catch (error) {
        // The marker is for diagnosis and never stops the bundle
      }\n`
      )
    case 'end-after-styles':
      return `try { if (!__EXTENSIONJS_retired) __EXTENSIONJS_REINJECT_REGISTRY[__EXTENSIONJS_REINJECT_KEY] = { cleanup: __EXTENSIONJS_composeCleanup(null), generation: Number(__EXTENSIONJS_REINJECT_GENERATION) || 0, build: __EXTENSIONJS_REINJECT_BUILD_TOKEN }; } catch (error) {
        // A locked registry leaves this copy for the next reload to skip
      }\n`
    case 'before-mount-call':
      return 'if (!__EXTENSIONJS_retired) '
    case 'after-mount-call':
      return `try { if (!__EXTENSIONJS_retired) __EXTENSIONJS_REINJECT_REGISTRY[__EXTENSIONJS_REINJECT_KEY] = __EXTENSIONJS_cleanup } catch (error) {
      // A locked registry leaves this copy for the next reload to skip
    }\n`
    default:
      return ''
  }
}

// One hint per entry per process: a dev session recompiles the entry on every
// save, and the advice does not change between them.
const hintedEntriesWithoutDefaultExport = new Set<string>()
const hintedEntriesCallingTheirDefault = new Set<string>()

function readModule(module: ContentScriptWrapperReadModule): void {
  const {defaultExport, file, resourcePath} = module

  if (
    defaultExport.kind === 'none' &&
    module.isDeclaredEntry &&
    !hintedEntriesWithoutDefaultExport.has(resourcePath)
  ) {
    hintedEntriesWithoutDefaultExport.add(resourcePath)
    humanLine(
      messages.contentScriptWithoutDefaultExport(
        file,
        isChromiumBasedBrowser(module.browser)
      )
    )
  }

  if (
    defaultExport.kind === 'found' &&
    defaultExport.callsElsewhere > 0 &&
    !hintedEntriesCallingTheirDefault.has(resourcePath)
  ) {
    hintedEntriesCallingTheirDefault.add(resourcePath)
    humanLine(messages.defaultExportCalledAgain(file, defaultExport.name))
  }
}

// A copy adopts the roots its mount creates, and the hot update runtime of
// a dev session loads update chunks from the extension.
export const contentScriptReinject: ContentScriptWrapperExtension = {
  textAt,
  adoptsRoots: true,
  loadsFiles: true,
  readModule
}
