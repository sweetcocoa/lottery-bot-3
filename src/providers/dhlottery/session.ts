const LOGIN_URL = 'https://www.dhlottery.co.kr/login';
const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const CONTEXT_OPTIONS = {
  viewport: { width: 1440, height: 1024 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  userAgent: DESKTOP_USER_AGENT,
};

export async function importPlaywright(): Promise<any> {
  try {
    return await import('playwright');
  } catch {
    throw new Error('playwright package is not installed. Install it before using browser-backed commands.');
  }
}

export async function createBrowserSession(): Promise<{ browser: any; context: any; page: any }> {
  const playwright = await importPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext(CONTEXT_OPTIONS);
  const page = await context.newPage();
  return { browser, context, page };
}

export async function login(page: any, username: string, password: string): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => typeof (window as any).login === 'function'
      && typeof (window as any).fnRSAencrypt === 'function'
      && !!(window as any).rsa?.n,
    { timeout: 15000 },
  );
  await page.evaluate(({ username, password }) => {
    const idInput = document.getElementById('inpUserId') as HTMLInputElement | null;
    const pwInput = document.getElementById('inpUserPswdEncn') as HTMLInputElement | null;
    if (!idInput || !pwInput) {
      throw new Error('Login inputs are missing');
    }
    idInput.value = username;
    pwInput.value = password;
    idInput.dispatchEvent(new Event('input', { bubbles: true }));
    pwInput.dispatchEvent(new Event('input', { bubbles: true }));
    idInput.dispatchEvent(new Event('change', { bubbles: true }));
    pwInput.dispatchEvent(new Event('change', { bubbles: true }));
    // @ts-ignore
    login();
  }, { username, password });
  await page.waitForTimeout(5000);

  if (page.url().includes('/login')) {
    throw new Error(`Login did not complete successfully. finalUrl=${page.url()}`);
  }
}
