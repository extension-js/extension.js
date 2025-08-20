import {extensionDev} from '../../../../../../programs/develop/dist/module.js';
       const dir = "/Users/cezaraugusto/local/extension-land/extension.js/examples/content";
       // Short auto-exit to keep CI stable
       process.env.EXTENSION_AUTO_EXIT_MS = '2000';
       process.env.EXTENSION_FORCE_KILL_MS = '4000';
       extensionDev(dir, {browser: 'chrome', port: 0}).catch((e)=>{ console.error(e); process.exit(1) });