/** Проверка экрана входа под мобильными UA без localStorage. */
import { chromium, devices } from 'playwright';

const URL = process.argv[2] || 'https://marchelxyz-muglehrbottopmanagment-8f80.twc1.net/';

async function checkProfile(name, contextOptions) {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(4000);

  const rootHtml = await page.locator('#root').innerHTML();
  const hasLogin = await page.getByText(/Войти|Вход|логин|пароль/i).count();
  const stillBlank = rootHtml.length < 80;

  console.log(JSON.stringify({
    profile: name,
    rootLength: rootHtml.length,
    stillBlank,
    hasLoginHints: hasLogin,
    errors: errors.slice(0, 10),
    preview: rootHtml.slice(0, 400),
  }, null, 2));

  await browser.close();
  return stillBlank || errors.some((e) => e.startsWith('PAGEERROR') || e.includes('ReferenceError'));
}

const iphone = devices['iPhone 13'];
const androidUa = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 SpasiboAndroid/1',
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
};

let failed = false;
if (await checkProfile('iphone-login', iphone)) failed = true;
if (await checkProfile('android-login', androidUa)) failed = true;
process.exit(failed ? 1 : 0);
