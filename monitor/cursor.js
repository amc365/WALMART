// A visible pointer, drawn inside the page.
//
// Playwright drives the browser below the operating system's cursor, so the
// real arrow never moves and clicks are invisible. This paints a dot that
// follows the synthetic mouse and flashes on each click, so a person watching
// can see what the monitor is doing.

const CURSOR_SCRIPT = `(() => {
  if (window.__monitorCursor) return;
  window.__monitorCursor = true;

  const install = () => {
    if (!document.body || document.getElementById('__monitor_cursor')) return;

    const dot = document.createElement('div');
    dot.id = '__monitor_cursor';
    dot.style.cssText = [
      'position:fixed', 'left:-100px', 'top:-100px',
      'width:22px', 'height:22px', 'margin:-11px 0 0 -11px',
      'border-radius:50%', 'background:rgba(0,113,220,.45)',
      'border:2px solid #0071dc', 'box-shadow:0 0 0 4px rgba(0,113,220,.18)',
      'pointer-events:none', 'z-index:2147483647',
      'transition:transform .12s ease'
    ].join(';');
    document.body.appendChild(dot);

    document.addEventListener('mousemove', (e) => {
      dot.style.left = e.clientX + 'px';
      dot.style.top = e.clientY + 'px';
    }, true);

    document.addEventListener('mousedown', () => {
      dot.style.transform = 'scale(.5)';
      dot.style.background = 'rgba(255,194,32,.85)';
    }, true);

    document.addEventListener('mouseup', () => {
      dot.style.transform = 'scale(1)';
      dot.style.background = 'rgba(0,113,220,.45)';
    }, true);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();`;

// Glides to the element and clicks it, slowly enough to follow by eye.
async function moveAndClick(page, locator, { steps = 30, pauseMs = 400 } = {}) {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await locator.boundingBox();
  if (!box) throw new Error('the link is not visible on the page');

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps });
  await page.waitForTimeout(pauseMs);
  await page.mouse.click(x, y);
}

module.exports = { CURSOR_SCRIPT, moveAndClick };
