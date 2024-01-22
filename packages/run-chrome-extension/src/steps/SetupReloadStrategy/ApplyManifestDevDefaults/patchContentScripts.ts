export default function patchContentScripts(manifest: any) {
  // const contentScriptEntry = {
  //   matches: ['<all_urls>'],
  //   js: ['extension-dispatch-reloader.js']
  // }

  // if (manifest.content_scripts) {
  //   manifest.content_scripts.push(contentScriptEntry)
  // } else {
  //   manifest.content_scripts = [contentScriptEntry]
  // }

  return manifest.content_scripts
}
