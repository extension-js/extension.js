const { log } = require('log-md')

module.exports = function () {
  log(`
    # Help center for the \`create\` command

    ## The \`<project-directory>\` argument (required).

    The project's directory where your extension will be installed.
    \`create-browser-extension\` can't install files without this information.

    ## The \`--template\` _<template-name>_ flag

    A template name can be provided if your project needs a special config.

    Valid template names can be any published npm module, for example
    \`cbe-standard-template\`.

    Feels something is wrong? Help by reporting a bug:
    https://github.com/cezaraugusto/create-browser-extension/issues/new
  `)
}
