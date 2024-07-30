import { transformSync } from 'esbuild';
import { parse } from 'acorn';
import * as walk from 'acorn-walk';
import { generate } from 'astring';
import { Callee, has } from './checkApiExists';
import { resolvePropertyArg, resolveStringArg } from './parser';

function checkMethod(callee: Callee, args: any, path: any, namespace: string) {
  if (
    has(callee, `${namespace}.action.setIcon`) ||
    has(callee, `${namespace}.browserAction.setIcon`) ||
    has(callee, `${namespace}.pageAction.setIcon`) ||
    has(callee, `${namespace}.declarativeContent.SetIcon`) ||
    has(callee, `${namespace}.action.setPopup`) ||
    has(callee, `${namespace}.browserAction.setPopup`) ||
    has(callee, `${namespace}.pageAction.setPopup`) ||
    has(callee, `${namespace}.scriptBadge.setPopup`)
  ) {
    resolvePropertyArg(path, 'r.solve');
  }

  if (has(callee, `${namespace}.devtools.panels.create`)) {
    resolveStringArg(path, `${namespace}.devtools.panels.create`);
  }

  if (has(callee, `${namespace}.downloads.download`)) {
    resolvePropertyArg(path, 'r.solve');
  }

  if (has(callee, `${namespace}.runtime.getURL`)) {
    resolveStringArg(path, `${namespace}.runtime.getURL`);
  }

  if (
    has(callee, `${namespace}.scripting.insertCSS`) ||
    has(callee, `${namespace}.scripting.removeCSS`) ||
    has(callee, `${namespace}.scripting.executeScript`)
  ) {
    resolvePropertyArg(path, 'r.solve');
  }

  if (
    has(callee, `${namespace}.scripting.registerContentScripts`) ||
    has(callee, `${namespace}.declarativeContent.RequestContentScript`)
  ) {
    resolvePropertyArg(path, 'r.solve');
  }

  if (has(callee, `${namespace}.declarativeContent.RequestContentScript`)) {
    resolvePropertyArg(path, 'r.solve');
  }

  if (
    has(callee, `${namespace}.tabs.create`) ||
    has(callee, `${namespace}.tabs.executeScript`) ||
    has(callee, `${namespace}.tabs.insertCSS`) ||
    has(callee, `${namespace}.windows.create`)
  ) {
    if (args.length > 0) {
      resolvePropertyArg(path, 'r.solve');
    }
  }

  if (has(callee, `${namespace}.sidePanel.setOptions`)) {
    resolvePropertyArg(path, 'r.solve');
  }

  if (has(callee, `${namespace}.notifications.create`)) {
    resolvePropertyArg(path, 'r.solve');
  }
}

export function transformSource(source: string) {
  // Use esbuild to transform the source
  const esbuildResult = transformSync(source, {
    loader: 'ts',
    format: 'esm',
  });

  // Parse the transformed source to an AST
  const ast = parse(esbuildResult.code, {
    sourceType: 'module',
    ecmaVersion: 'latest',
  });

  // Traverse and modify the AST
  walk.simple(ast, {
    CallExpression(node: any) {
      const namespaces = ['chrome', 'browser'];
      const callee: Callee = node.callee;
      const args = node.arguments;

      namespaces.forEach((namespace) => {
        checkMethod(callee, args, node, namespace);
      });
    },
  });

  // Generate the modified code from the AST
  const output = generate(ast);

  return output;
}
