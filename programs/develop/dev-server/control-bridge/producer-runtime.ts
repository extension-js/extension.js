/**
 * Browser-side agent-bridge PRODUCER (Slice 1).
 *
 * A self-contained dev-only IIFE prepended to the user extension's background
 * service worker (the CSP-free context that can open a localhost WebSocket).
 * It patches `console.*`, connects to the dev-server control WS, and forwards
 * each call as a LogEvent (docs/agent-bridge/log-event.schema.json). The broker
 * stamps `seq`; the producer never sets it.
 *
 * Injection bakes the control port + instanceId via `buildBridgeProducerSource`.
 * When the control bridge is unavailable (no port), the builder returns '' so
 * nothing is injected.
 */

export const BRIDGE_PRODUCER_SOURCE = `;(function () {
  try {
    var g = (typeof globalThis === "object" && globalThis) ? globalThis : this;
    if (!g || g.__extjsBridgeProducerInstalled) return;

    var PORT = parseInt("__EXTJS_CONTROL_PORT__", 10);
    var INSTANCE_ID = "__EXTJS_INSTANCE_ID__";
    var CONTEXT = "__EXTJS_CONTEXT__";
    if (!PORT || PORT < 1) return;

    var WS = g.WebSocket;
    if (typeof WS !== "function") return;

    var consoleRef = g.console || {};
    g.__extjsBridgeProducerInstalled = true;

    var LEVELS = ["log", "info", "warn", "error", "debug", "trace"];
    var socket = null;
    var open = false;
    var queue = [];
    var backoff = 250;
    var MAX_BACKOFF = 5000;
    var MAX_QUEUE = 1000;

    function nowId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function sanitize(args) {
      var out = [];
      for (var i = 0; i < args.length; i++) {
        var p = args[i];
        try {
          if (typeof p === "string") out.push(p.length > 2048 ? p.slice(0, 2048) + "..." : p);
          else if (p instanceof Error) out.push(p.name + ": " + p.message);
          else out.push(JSON.stringify(p));
        } catch (e) {
          out.push(String(p));
        }
        if (out.join(" ").length > 8192) break;
      }
      return out;
    }

    function flush() {
      while (queue.length && open && socket) {
        var f = queue.shift();
        try { socket.send(JSON.stringify(f)); } catch (e) { break; }
      }
    }

    function send(frame) {
      if (open && socket) {
        try { socket.send(JSON.stringify(frame)); return; } catch (e) {}
      }
      if (queue.length < MAX_QUEUE) queue.push(frame);
    }

    function schedule() {
      var delay = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
      try { setTimeout(connect, delay); } catch (e) {}
    }

    function connect() {
      try {
        socket = new WS("ws://127.0.0.1:" + PORT + "/extjs-control");
      } catch (e) {
        schedule();
        return;
      }
      socket.onopen = function () {
        open = true;
        backoff = 250;
        try {
          socket.send(JSON.stringify({type: "hello", v: 1, role: "producer", instanceId: INSTANCE_ID}));
        } catch (e) {}
        flush();
      };
      socket.onclose = function () {
        open = false;
        socket = null;
        schedule();
      };
      socket.onerror = function () {
        try { socket && socket.close(); } catch (e) {}
      };
    }

    LEVELS.forEach(function (level) {
      var orig = typeof consoleRef[level] === "function"
        ? consoleRef[level].bind(consoleRef)
        : function () {};
      consoleRef[level] = function () {
        try {
          send({
            type: "log",
            event: {
              v: 1,
              id: nowId(),
              timestamp: Date.now(),
              level: level,
              context: CONTEXT,
              messageParts: sanitize([].slice.call(arguments)),
              runId: INSTANCE_ID
            }
          });
        } catch (e) {}
        return orig.apply(consoleRef, arguments);
      };
    });

    connect();
  } catch (e) {}
})();
`

export interface BuildProducerOptions {
  controlPort: number | null | undefined
  instanceId: string
  context?: string
}

/**
 * Bake the control port / instanceId / context into the producer source.
 * Returns '' when the control bridge is unavailable (no port) so callers can
 * safely skip injection.
 */
export function buildBridgeProducerSource(opts: BuildProducerOptions): string {
  if (!opts.controlPort || opts.controlPort < 1) return ''
  return BRIDGE_PRODUCER_SOURCE.replace(
    /__EXTJS_CONTROL_PORT__/g,
    String(opts.controlPort)
  )
    .replace(/__EXTJS_INSTANCE_ID__/g, String(opts.instanceId))
    .replace(/__EXTJS_CONTEXT__/g, String(opts.context || 'background'))
}
