# extension-create
> Create cross-browser extensions with no buid configuration.

<!--
  Use the "extension-create" package as an alias for the @extension-create/create package.

  If the user runs "npx extension-create <my-extension>"
    - Execute normally.

  If the user tries to execute "npx extension-create create <my-extension>": 
    - Pick up the "create" argument  and ignore, use the next argument as
      the project path/name, execute as-is.

  If the user tries to execute "dev", "start", "build":
   - Warn user that they should use the "extension" package, but download it and execute anyway.
-->
