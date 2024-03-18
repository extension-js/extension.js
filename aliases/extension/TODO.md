# extension
> Create cross-browser extensions with no buid configuration.

<!--
  Use the "extension" package as an alias for the @extension-create/develop package.

  If the user runs "npx extension dev/build/start <my-extension>"
    - Execute normally.

  If the user tries to execute "npx extension create <my-extension>": 
    - Pick up the "create" argument and ignore, use the next argument as
      the project path/name for the package "extension-create", then download and execute it.
-->
