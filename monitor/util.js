// Some Playwright page calls (page.content() in particular) do not honour
// their own timeout while a navigation is still pending — they block until the
// browser closes. Anything run against a page that may be wedged goes through
// this hard race so a single stuck section cannot hang the whole run.
function withTimeout(promise, ms, fallback) {
  let timer;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), guard])
    .finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
