// Moves the real Windows mouse pointer.
//
// Playwright drives the browser below the operating system, so its clicks never
// move the arrow on screen. This glides the actual pointer to the spot
// Playwright is about to click, so the work can be watched as if a person were
// doing it. The click itself is still Playwright's — the pointer is only
// following along, which means nudging the mouse cannot misfire a click.
//
// Windows only, via PowerShell that ships with the OS. Everywhere else this is
// a no-op and the in-page dot is used instead.

const { spawn } = require('child_process');

function isSupported() {
  return process.platform === 'win32';
}

// Glides from wherever the pointer is now to (x, y) in screen pixels.
function glideTo(x, y, { steps = 24, stepMs = 12, timeoutMs = 8000 } = {}) {
  if (!isSupported()) return Promise.resolve(false);

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$target = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
$start = [System.Windows.Forms.Cursor]::Position
for ($i = 1; $i -le ${steps}; $i++) {
  $nx = [int]($start.X + (($target.X - $start.X) * $i / ${steps}))
  $ny = [int]($start.Y + (($target.Y - $start.Y) * $i / ${steps}))
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($nx, $ny)
  Start-Sleep -Milliseconds ${stepMs}
}`.trim();

  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };

    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, stdio: 'ignore'
    });
    const timer = setTimeout(() => { child.kill(); finish(false); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); finish(false); });
    child.on('exit', (code) => { clearTimeout(timer); finish(code === 0); });
  });
}

// Where a point inside the page sits on the physical screen. Accounts for the
// window's position, the browser's own toolbar, and display scaling.
async function pageToScreen(page, clientX, clientY) {
  return page.evaluate(([cx, cy]) => {
    const ratio = window.devicePixelRatio || 1;
    const frameX = window.screenX + (window.outerWidth - window.innerWidth) / 2;
    const frameY = window.screenY + (window.outerHeight - window.innerHeight);
    return { x: (frameX + cx) * ratio, y: (frameY + cy) * ratio };
  }, [clientX, clientY]);
}

module.exports = { isSupported, glideTo, pageToScreen };
