const LOGIN_URL = 'https://www.dhlottery.co.kr/login';
const EXPIRED_PASSWORD_PATH = '/mbrsrvc/ExpryPswdNoti';
const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const NAVIGATION_ATTEMPTS = 3;

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
  const launchOptions: Record<string, unknown> = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_CHANNEL) {
    launchOptions.channel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
  }
  const browser = await launchChromium(playwright, launchOptions);
  const context = await browser.newContext(CONTEXT_OPTIONS);
  const page = await context.newPage();
  return { browser, context, page };
}

export async function gotoWithRetries(page: any, url: string, options: Record<string, unknown>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt += 1) {
    try {
      await page.goto(url, options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < NAVIGATION_ATTEMPTS) {
        await page.waitForTimeout(attempt * 1000);
      }
    }
  }
  throw lastError;
}

async function launchChromium(playwright: any, launchOptions: Record<string, unknown>): Promise<any> {
  try {
    return await playwright.chromium.launch(launchOptions);
  } catch (error) {
    if (launchOptions.channel || !isMissingBundledBrowserError(error)) {
      throw error;
    }
    try {
      return await playwright.chromium.launch({ ...launchOptions, channel: 'chrome' });
    } catch (fallbackError) {
      const original = error instanceof Error ? error.message : String(error);
      const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Unable to launch Playwright Chromium. bundled=${original}; chromeFallback=${fallback}`);
    }
  }
}

function isMissingBundledBrowserError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes('Executable doesn\'t exist')
    || error.message.includes('playwright install');
}

export async function login(page: any, username: string, password: string): Promise<void> {
  await gotoWithRetries(page, LOGIN_URL, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForFunction(
    () => typeof (window as any).login === 'function'
      && typeof (window as any).fnRSAencrypt === 'function'
      && !!(window as any).rsa?.n,
    { timeout: 30000 },
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
  await page.waitForTimeout(1000);
  await page.waitForFunction(
    () => window.location.pathname !== '/login',
    { timeout: 15000 },
  ).catch(() => undefined);

  const finalUrl = page.url();
  if (finalUrl.includes(EXPIRED_PASSWORD_PATH)) {
    throw new Error('Dhlottery password has expired. Change the password on dhlottery.co.kr, then update the DHLOTTERY_PASSWORD GitHub secret.');
  }
  if (finalUrl.includes('/login')) {
    throw new Error(`Login did not establish an authenticated Dhlottery session. finalUrl=${finalUrl}`);
  }
}
