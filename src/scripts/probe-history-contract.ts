import { createBrowserSession } from '../providers/dhlottery/session.ts';
import { loginForHistory } from '../providers/dhlottery/history-login.ts';

const username = process.env.DHLOTTERY_USERNAME;
const password = process.env.DHLOTTERY_PASSWORD;
if (!username || !password) throw new Error('Missing history credentials');
const { browser, page } = await createBrowserSession();
try {
  await loginForHistory(page.context().request, username, password);
  const responsePromise = page.waitForResponse((r: any) => r.url().includes('/selectMyLotteryledger.do'), { timeout: 25000 });
  const [response] = await Promise.all([responsePromise, page.goto('https://www.dhlottery.co.kr/mypage/mylotteryledger', { waitUntil: 'domcontentloaded', timeout: 20000 })]);
  const url = new URL(response.url());
  const data = (await response.json()).data;
  const shapes = data.list.map((row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null ? null : { type: typeof value, shape: typeof value === 'string' ? value.replace(/[0-9]/g, '0').replace(/\p{L}/gu, 'x') : undefined, productCode: ['LO40', 'LP72'].includes(String(value)) ? value : undefined }])));
  console.log(JSON.stringify({ path: url.pathname, paramKeys: [...url.searchParams.keys()], sort: url.searchParams.get('sort'), shapes: [...new Set(shapes.map((shape: unknown) => JSON.stringify(shape)))].slice(0, 4) }));
  const responses: Array<Promise<void>> = [];
  page.on('response', (res: any) => {
    const requestUrl = new URL(res.url());
    if (!/ticket|ledger|lt645/i.test(requestUrl.pathname)) return;
    responses.push((async () => {
      const contentType = res.headers()['content-type'] ?? '';
      const body = contentType.includes('json') ? await res.json() : null;
      console.log(JSON.stringify({ path: requestUrl.pathname, paramKeys: [...requestUrl.searchParams.keys()], status: res.status(),
        data: body?.data && Object.fromEntries(Object.entries(body.data).map(([key, value]) => [key, Array.isArray(value)
          ? { size: value.length, firstRowKeys: Object.keys(value[0] ?? {}) } : typeof value])) }));
    })().catch(() => undefined));
  });
  await page.evaluate(() => {
    const site = window as any;
    site.probeCalls = [];
    for (const [target, method, order] of [[site.ajaxUtil, 'sendHttpJson', 'paramsFirst'], [site.cmmUtil, 'openLayerPopup', 'pathFirst']]) {
      const original = target[method];
      target[method] = function (...args: any[]) {
        const path = args[1];
        const params = order === 'paramsFirst' ? args[0] : args[2];
        if (typeof path === 'string' && /ticket|ledger|lt645/i.test(path) && params && typeof params === 'object') {
          site.probeCalls.push({ path, params: Object.fromEntries(Object.entries(params).map(([key, value]) => [key,
            [...new Set((site.MyLotteryledgerM.list ?? []).flatMap((row: Record<string, unknown>) => Object.keys(row).filter((field) => row[field] === value)))] ])) });
        }
        return original.apply(this, args);
      };
    }
  });
  const row = page.locator('.whl-body .whl-row').filter({ hasText: '로또6/45' }).first();
  await row.locator('.barcd').click({ timeout: 10000 });
  await page.locator('#Lotto645TicketP .ticket-num-line .ticket-num-wrap').first().waitFor({ timeout: 15000 });
  console.log(JSON.stringify(await page.evaluate(() => (window as any).probeCalls)));
  await Promise.allSettled(responses);
} finally {
  await browser.close();
}
