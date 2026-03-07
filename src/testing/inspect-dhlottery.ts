import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function dumpPage(page: any, label: string): Promise<void> {
  await mkdir('artifacts/inspection', { recursive: true });
  await page.screenshot({ path: `artifacts/inspection/${label}.png`, fullPage: true });
  await writeFile(`artifacts/inspection/${label}.html`, await page.content(), 'utf8');
  const links = await page.locator('a').evaluateAll((nodes: HTMLAnchorElement[]) =>
    nodes.slice(0, 200).map((node) => ({
      text: (node.textContent || '').trim(),
      href: node.href,
    })),
  );
  await writeFile(`artifacts/inspection/${label}.links.json`, `${JSON.stringify(links, null, 2)}\n`, 'utf8');
  const inputs = await page.locator('input').evaluateAll((nodes: HTMLInputElement[]) =>
    nodes.map((node) => ({
      type: node.type,
      name: node.name,
      id: node.id,
      placeholder: node.placeholder,
      autocomplete: node.autocomplete,
      valueLength: node.value?.length ?? 0,
    })),
  );
  await writeFile(`artifacts/inspection/${label}.inputs.json`, `${JSON.stringify(inputs, null, 2)}\n`, 'utf8');
}

async function clickFirst(page: any, candidates: string[]): Promise<boolean> {
  for (const candidate of candidates) {
    const locator = page.locator(candidate).first();
    if (await locator.count()) {
      await locator.click();
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

async function dumpFrame(page: any, frameSelector: string, label: string): Promise<void> {
  const handle = await page.waitForSelector(frameSelector, { timeout: 15000 });
  const frame = await handle.contentFrame();
  if (!frame) {
    throw new Error(`Could not resolve frame for ${frameSelector}`);
  }
  await frame.waitForLoadState('domcontentloaded').catch(() => undefined);
  await mkdir('artifacts/inspection', { recursive: true });
  await writeFile(`artifacts/inspection/${label}.html`, await frame.content(), 'utf8');
  const inputs = await frame.locator('input').evaluateAll((nodes: HTMLInputElement[]) =>
    nodes.map((node) => ({
      type: node.type,
      name: node.name,
      id: node.id,
      placeholder: node.placeholder,
      autocomplete: node.autocomplete,
      valueLength: node.value?.length ?? 0,
    })),
  );
  await writeFile(`artifacts/inspection/${label}.inputs.json`, `${JSON.stringify(inputs, null, 2)}\n`, 'utf8');
  const links = await frame.locator('a').evaluateAll((nodes: HTMLAnchorElement[]) =>
    nodes.slice(0, 200).map((node) => ({
      text: (node.textContent || '').trim(),
      href: node.href,
    })),
  );
  await writeFile(`artifacts/inspection/${label}.links.json`, `${JSON.stringify(links, null, 2)}\n`, 'utf8');
}

async function clickAndDumpPopup(page: any, selector: string, label: string): Promise<any> {
  const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
  const locator = page.locator(selector);
  if (!await locator.count()) {
    throw new Error(`Could not find ${selector}`);
  }
  await locator.click();
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
    await dumpPage(popup, label);
    return popup;
  }
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(1000);
  await dumpPage(page, label);
  return page;
}

async function main(): Promise<void> {
  const username = requiredEnv('DHLOTTERY_USERNAME');
  const password = requiredEnv('DHLOTTERY_PASSWORD');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });

  try {
    await page.goto('https://www.dhlottery.co.kr/login', { waitUntil: 'domcontentloaded' });
    await dumpPage(page, '01-login');

    const idInput = page.locator('#inpUserId');
    const pwInput = page.locator('#inpUserPswdEncn');
    if (!await idInput.count() || !await pwInput.count()) {
      throw new Error('Could not find login inputs. See artifacts/inspection/01-login.inputs.json');
    }
    await idInput.fill(username);
    await pwInput.fill(password);

    if (!await clickFirst(page, [
      '#btnLogin',
      'button:has-text("로그인")',
    ])) {
      throw new Error('Could not find login submit control');
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await dumpPage(page, '02-after-login');

    await page.goto('https://www.dhlottery.co.kr/lt645/intro', { waitUntil: 'domcontentloaded' });
    await dumpPage(page, '03-lotto-intro');
    const popup = await clickAndDumpPopup(page, '#btnBuyLt645', '04-lotto-buy');
    await dumpFrame(popup, '#ifrm_tab', '04-lotto-buy-frame');

    await popup.evaluate(() => {
      // @ts-ignore
      tabview('LP72');
    });
    await popup.waitForTimeout(1500);
    await dumpPage(popup, '05-pension-buy');
    await dumpFrame(popup, '#ifrm_tab', '05-pension-buy-frame');
    if (popup !== page) {
      await popup.close().catch(() => undefined);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
