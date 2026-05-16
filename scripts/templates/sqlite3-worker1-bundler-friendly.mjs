// Custom bundler-friendly worker entry for XMTP's wa-sqlite bindings.

import './wa-sqlite-diesel-bundle.js';
import './sqlite3-opfs-async-proxy.js';

const initModule = self.sqlite3InitModule;

if (typeof initModule !== 'function') {
  throw new Error('sqlite3InitModule was not registered on the worker global scope');
}

initModule().catch((error) => {
  console.error('Failed to initialize sqlite3 worker', error);
  throw error;
});
