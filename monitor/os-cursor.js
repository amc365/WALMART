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

const FRAME_MS = 16; // ~60 steps a second, which reads as smooth movement

function runPowerShell(script, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };

    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    const timer = setTimeout(() => { child.kill(); finish(null); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); finish(null); });
    child.on('exit', (code) => { clearTimeout(timer); finish(code === 0 ? out.trim() : null); });
  });
}

// Where the pointer is right now, in screen pixels.
async function getPosition() {
  if (!isSupported()) return null;
  const out = await runPowerShell(
    "Add-Type -AssemblyName System.Windows.Forms; $p = [System.Windows.Forms.Cursor]::Position; Write-Output \"$($p.X),$($p.Y)\"",
    5000
  );
  if (!out) return null;
  const [x, y] = out.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// Glides from wherever the pointer is now to (x, y) in screen pixels, taking
// roughly durationMs. Eased so it starts and stops gently rather than sliding
// at a constant machine-like rate.
async function glideTo(x, y, { durationMs = 1200, timeoutMs = 25000 } = {}) {
  if (!isSupported()) return false;

  const steps = Math.min(600, Math.max(12, Math.round(durationMs / FRAME_MS)));
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$tx = ${Math.round(x)}
$ty = ${Math.round(y)}
$start = [System.Windows.Forms.Cursor]::Position
for ($i = 1; $i -le ${steps}; $i++) {
  $t = $i / ${steps}
  $e = if ($t -lt 0.5) { 2 * $t * $t } else { 1 - [Math]::Pow(-2 * $t + 2, 2) / 2 }
  $nx = [int]($start.X + (($tx - $start.X) * $e))
  $ny = [int]($start.Y + (($ty - $start.Y) * $e))
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($nx, $ny)
  Start-Sleep -Milliseconds ${FRAME_MS}
}
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($tx, $ty)`.trim();

  return (await runPowerShell(script, timeoutMs)) !== null;
}

// Glides, then checks where the pointer actually ended up. The arrow can be
// knocked off course — the person moves the mouse, or another window grabs it —
// so it is walked back to the same spot until it lands or the attempts run out.
async function glideAndSettle(x, y, { durationMs = 1200, tolerancePx = 6, attempts = 3, onRetry = null } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const moved = await glideTo(x, y, { durationMs: attempt === 1 ? durationMs : Math.min(durationMs, 600) });
    if (!moved) return false;

    const landed = await getPosition();
    if (!landed) return true; // cannot verify; assume it went where it was told
    if (Math.abs(landed.x - x) <= tolerancePx && Math.abs(landed.y - y) <= tolerancePx) return true;

    if (onRetry) onRetry(attempt, landed);
  }
  return false;
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

module.exports = { isSupported, glideTo, glideAndSettle, getPosition, pageToScreen };
