const { app } = require('electron');
const { createSupportService, installChildProcessAudit } = require('./core/support');

// Order is intentional: Windows process wrapping must exist before projects.js
// captures child_process methods, and Trusted/Terminal patches must exist before
// main.js destructures createProjectService/createSafeToolApi.
installChildProcessAudit(createSupportService(app));
require('./core/runtime-bootstrap').installRuntimePatches();
require('./core/browser-workspace').installBrowserWorkspace();
require('./main');
