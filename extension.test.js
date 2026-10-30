// Loads NinjaAdBlocker as a real unpacked extension in Chromium and checks detection.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

const EXT = path.resolve(__dirname, '..');
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '✅ ' : '❌ ') + msg); if (!ok) failed++; };

(async () => {
  // 1. Manifest sanity
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  check(m.manifest_version === 3, 'manifest is V3');
  for (const cs of m.content_scripts)
    for (const f of [...(cs.js || []), ...(cs.css || [])])
      check(fs.existsSync(path.join(EXT, f)), `file exists: ${f}`);

  // 2. Serve fixture over http (content scripts don't run on file://)
  const html = fs.readFileSync(path.join(__dirname, 'fixture.html'));
  const server = http.createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
  await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(1000);

  // Simulate a lazy-loaded ad (MutationObserver)
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'outbrain-widget';
    d.innerHTML = '<small>ממומן</small>';
    document.getElementById('late').appendChild(d);
  });
  await page.waitForTimeout(1000);

  const veiled = sel => page.evaluate(s => document.querySelector(s)?.classList.contains('ninja-veil'), sel);
  check(await veiled('#taboola-below-article'), 'Taboola block veiled');
  check(await veiled('.ad-container'), 'ad-container 300x250 veiled');
  check(await veiled('ins.adsbygoogle'), 'adsbygoogle veiled');
  check(await veiled('.outbrain-widget'), 'lazy-loaded Outbrain veiled');
  check(!(await veiled('header')), 'header untouched');
  check(!(await veiled('#story')), 'article untouched');
  check(!(await veiled('.shadow-header')), '"shadow-header" card untouched (no false positive)');

  // Anti-adblock view: element still in DOM with real size
  const h = await page.evaluate(() => document.querySelector('.ad-container').offsetHeight);
  check(h === 250, `veiled ad still reports offsetHeight=250 (got ${h})`);

  await ctx.close(); server.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
