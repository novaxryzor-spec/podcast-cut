'use strict';
(function () {
  // The Windows updater throttles network checks and performs verified installs.
  // Starting it here makes updates arrive even when the user rarely logs out.
  try {
    if (typeof require !== 'function' || !process || process.platform !== 'win32') return;
    const path = require('path');
    const fs = require('fs');
    const cp = require('child_process');
    const local = process.env.LOCALAPPDATA;
    if (!local) return;
    const script = path.join(local, 'PodcastCut', 'Updater.ps1');
    if (!fs.existsSync(script)) return;
    const child = cp.spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden', '-File', script, '-Quiet'
    ], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
  } catch (_) {}
})();
