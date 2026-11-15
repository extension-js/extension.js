// Extension.js types for a project that brings its own @types/chrome.
// The generated extension-env.d.ts loads that package next to this file.
/// <reference types="node" />
/// <reference path="./assets.d.ts" />
/// <reference path="./env.d.ts" />

declare global {
  // Firefox, Safari and Chromium 148 onward ship the browser global natively.
  // The opt-in webextension-polyfill provides it on an older Chromium.
  const browser: typeof import('webextension-polyfill')
}

export {}
