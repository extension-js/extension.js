#!/usr/bin/env node
//
//  Migration script: rewrite legacy manifest output paths to the new standardized folders.
//  Usage:
//    node scripts/migrate-manifest-paths.cjs /abs/path/to/manifest.json
const fs = require('fs')
const path = require('path')

function migrate(manifestPath) {
  const abs = path.resolve(process.cwd(), manifestPath)
  if (!fs.existsSync(abs)) {
    console.error(`[migrate-manifest] File not found: ${abs}`)
    process.exit(1)
  }
  const raw = fs.readFileSync(abs, 'utf8')
  const manifest = JSON.parse(raw)

  // Clone to avoid accidental shared references
  const next = JSON.parse(JSON.stringify(manifest))

  // DevTools
  if (next.devtools_page && /devtools_page\/.+|devtools_page\.html$/.test(next.devtools_page)) {
    next.devtools_page = 'devtools/index.html'
  }

  // Options
  if (next.options_page && /options_ui\/page\.html$/.test(next.options_page)) {
    next.options_page = 'options/index.html'
  }
  if (next.options_ui && next.options_ui.page && /options_ui\/page\.html$/.test(next.options_ui.page)) {
    next.options_ui.page = 'options/index.html'
  }

  // Background HTML page (MV2)
  if (next.background && next.background.page && /background\/(?:page|index)\.html$/.test(next.background.page)) {
    next.background.page = 'background/index.html'
  }

  // Popups
  const rewritePopup = (val) => (val && /(?:page_action|browser_action)\/default_popup\.html$/.test(val) ? 'action/index.html' : val)
  if (next.action && next.action.default_popup) {
    next.action.default_popup = 'action/index.html'
  }
  if (next.browser_action && next.browser_action.default_popup) {
    next.browser_action.default_popup = rewritePopup(next.browser_action.default_popup)
  }
  if (next.page_action && next.page_action.default_popup) {
    next.page_action.default_popup = rewritePopup(next.page_action.default_popup)
  }

  // Sidebar / Side panel
  if (next.sidebar_action && next.sidebar_action.default_panel) {
    if (/sidebar_action\/default_panel\.html$/.test(next.sidebar_action.default_panel)) {
      next.sidebar_action.default_panel = 'sidebar/index.html'
    }
  }
  if (next.side_panel && next.side_panel.default_path) {
    if (/side_panel\/default_path\.html$/.test(next.side_panel.default_path)) {
      next.side_panel.default_path = 'sidebar/index.html'
    }
  }

  if (JSON.stringify(next) !== raw) {
    fs.writeFileSync(abs, JSON.stringify(next, null, 2))
    console.log(`[migrate-manifest] Updated: ${abs}`)
  } else {
    console.log('[migrate-manifest] No changes needed')
  }
}

const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/migrate-manifest-paths.cjs <path-to-manifest.json>')
  process.exit(1)
}

migrate(target)


