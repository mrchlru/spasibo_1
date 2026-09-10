/** Проверка загрузки: ловим ошибки консоли и наличие контента в #root. */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://marchelxyz-muglehrbottopmanagment-8f80.twc1.net/';

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage();
const errors = [];
const failed = [];

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    errors.push(msg.text());
  }
});
page.on('pageerror', (err) => {
  errors.push(`PAGEERROR: ${err.message}`);
});
page.on('requestfailed', (req) => {
  failed.push(`${req.url()} :: ${req.failure()?.errorText || 'failed'}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);

const rootHtml = await page.locator('#root').innerHTML();
const hasLogin = await page.getByText(/Войти|Вход|Спасибо/i).count();
const title = await page.title();

console.log(JSON.stringify({
  url: URL,
  title,
  rootLength: rootHtml.length,
  hasLoginHints: hasLogin,
  rootPreview: rootHtml.slice(0, 400),
  errors: errors.slice(0, 20),
  failed: failed.filter((u) => !u.includes('photo-proxy')).slice(0, 20),
}, null, 2));

await browser.close();

if (rootHtml.length < 50 && errors.some((e) => e.includes('PAGEERROR'))) {
  process.exit(1);
}
