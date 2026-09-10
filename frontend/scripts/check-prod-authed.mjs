/** Проверка старта для «авторизованного» пользователя (localStorage). */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://marchelxyz-muglehrbottopmanagment-8f80.twc1.net/';

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext();
await context.addInitScript(() => {
  const user = {
    id: 1,
    status: 'approved',
    has_seen_onboarding: true,
    is_admin: true,
    balance: 100,
    first_name: 'Test',
  };
  localStorage.setItem('userId', '1');
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('spasibo_app_settings_snapshot', JSON.stringify({
    season_theme: 'summer',
    theme_assets: null,
  }));
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(6000);

const rootHtml = await page.locator('#root').innerHTML();
const hasFeed = /лента|спасиб|feed|HomePage/i.test(rootHtml);
const stillLoading = rootHtml.includes('LoadingScreen') || rootHtml.length < 100;

console.log(JSON.stringify({
  rootLength: rootHtml.length,
  stillLoading,
  hasFeedHints: hasFeed,
  pageErrors: errors,
  preview: rootHtml.slice(0, 500),
}, null, 2));

await browser.close();
process.exit(stillLoading || errors.length > 0 ? 1 : 0);
