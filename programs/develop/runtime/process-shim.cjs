// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

'use strict'

var noop = function () {}

function nextTick(callback) {
  var args = Array.prototype.slice.call(arguments, 1)
  var run = function () {
    callback.apply(null, args)
  }
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(run)
  } else {
    Promise.resolve().then(run)
  }
}

module.exports = {
  // Unknown env keys resolve to `undefined` instead of throwing.
  env: {},
  argv: [],
  version: '',
  versions: {},
  platform: 'browser',
  arch: 'browser',
  // Truthy hint used by some libraries to detect a browser-shimmed process.
  browser: true,
  title: 'browser',
  pid: 0,
  nextTick: nextTick,
  cwd: function () {
    return '/'
  },
  chdir: noop,
  umask: function () {
    return 0
  },
  on: noop,
  once: noop,
  off: noop,
  addListener: noop,
  removeListener: noop,
  removeAllListeners: noop,
  prependListener: noop,
  prependOnceListener: noop,
  emit: noop,
  listeners: function () {
    return []
  }
}
