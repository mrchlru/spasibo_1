/** Проверка старта под iPhone Safari и Android WebView UA. */
import { chromium, devices } from 'playwright';

const URL = process.argv[2] || 'https://marchelxyz-muglehrbottopmanagment-8f80.twc1.net/';

async function checkProfile(name, contextOptions) {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext(contextOptions);
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
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  const rootHtml = await page.locator('#root').innerHTML();
  const stillBlank = rootHtml.length < 80;

  console.log(JSON.stringify({
    profile: name,
    rootLength: rootHtml.length,
    stillBlank,
    errors,
    preview: rootHtml.slice(0, 300),
  }, null, 2));

  await browser.close();
  return stillBlank || errors.length > 0;
}

const iphone = devices['iPhone 13'];
const androidUa = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 SpasiboAndroid/1',
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
};

const failed = [];
if (await checkProfile('iphone-safari', iphone)) failed.push('iphone');
if (await checkProfile('android-apk', androidUa)) failed.push('android');

if (failed.length) {
  console.error('FAILED:', failed.join(', '));
  process.exit(1);
}
