import type { Browser, BrowserContext, LaunchOptions, Page } from 'playwright';

const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const CONTEXT_OPTIONS = {
  viewport: { width: 1440, height: 1024 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  userAgent: DESKTOP_USER_AGENT,
};

async function importPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    throw new Error('playwright package is not installed. Install it before using browser-backed commands.');
  }
}

export async function createBrowserSession(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const playwright = await importPlaywright();
  const launchOptions: LaunchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_CHANNEL) {
    launchOptions.channel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
  }
  const browser = await launchChromium(playwright, launchOptions);
  try {
    const context = await browser.newContext(CONTEXT_OPTIONS);
    const page = await context.newPage();
    return { browser, context, page };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

async function launchChromium(playwright: typeof import('playwright'), launchOptions: LaunchOptions): Promise<Browser> {
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
