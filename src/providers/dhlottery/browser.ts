import { mkdir, writeFile } from 'node:fs/promises';
import type { LottoTicket, PensionTicket } from '../../core/random-picks.ts';
import { createBrowserSession, login } from './session.ts';

interface BrowserInput {
  username: string;
  password: string;
  week: string;
  lottoTickets: LottoTicket[];
  pensionTickets: PensionTicket[];
}

export interface BrowserArtifacts {
  diagnosticsPath: string;
  receiptId?: string;
}

const LOTTO_INTRO_URL = 'https://www.dhlottery.co.kr/lt645/intro';
const LOTTO_PURCHASE_URL = 'https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40';
const PENSION_PURCHASE_URL = 'https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LP72';

export class BrowserDhlotteryProvider {
  async smoke(input: BrowserInput): Promise<BrowserArtifacts> {
    return runBrowserFlow('smoke', input, async (session) => {
      await login(session.page, input.username, input.password);
      const purchasePage = await openPurchasePage(session.page);
      const lottoFrame = await resolveGameFrame(purchasePage);
      await lottoFrame.locator('#btnSelectNum').waitFor({ state: 'visible', timeout: 10000 });
      await switchToPensionTab(purchasePage);
      const pensionFrame = await resolveGameFrame(purchasePage);
      await pensionFrame.locator('#lotto720_radio_group_wrapper_num1').waitFor({ state: 'attached', timeout: 10000 });
      await pensionFrame.locator('.lotto720_select_number_wrapper').first().waitFor({ state: 'visible', timeout: 10000 });

      const details = [
        `mode=smoke`,
        `week=${input.week}`,
        `loginUrl=${session.page.url()}`,
        `purchaseUrl=${purchasePage.url()}`,
        `lottoReady=true`,
        `pensionReady=true`,
      ];
      return { details };
    });
  }

  async purchase(input: BrowserInput): Promise<BrowserArtifacts> {
    return runBrowserFlow('purchase', input, async (session) => {
      await login(session.page, input.username, input.password);
      const purchasePage = await openPurchasePage(session.page);
      let lottoReceipt = 'lotto-skipped';
      if (input.lottoTickets.length > 0) {
        const lottoFrame = await resolveGameFrame(purchasePage);
        await purchaseLottoTickets(lottoFrame, input.lottoTickets);
        lottoReceipt = await finalizeLottoPurchase(lottoFrame);
      }

      let pensionReceipt = 'pension-skipped';
      if (input.pensionTickets.length > 0) {
        await switchToPensionTab(purchasePage);
        const pensionFrame = await resolveGameFrame(purchasePage);
        await purchasePensionTickets(pensionFrame, input.pensionTickets);
        pensionReceipt = await finalizePensionPurchase(pensionFrame);
      }

      const details = [
        `mode=live`,
        `week=${input.week}`,
        `lotto=${input.lottoTickets.map((ticket) => ticket.join('-')).join('|')}`,
        `lottoReceipt=${lottoReceipt}`,
        `pension=${input.pensionTickets.map((ticket) => `${ticket.group}:${ticket.number}`).join('|')}`,
        `pensionReceipt=${pensionReceipt}`,
      ];
      return {
        receiptId: `browser-${input.week}-${Date.now()}`,
        details,
      };
    });
  }
}

async function runBrowserFlow(
  mode: 'smoke' | 'purchase',
  input: BrowserInput,
  action: (session: { page: any }) => Promise<{ details: string[]; receiptId?: string }>,
): Promise<BrowserArtifacts> {
  const { browser, page } = await createBrowserSession();
  await mkdir('artifacts/diagnostics', { recursive: true });
  const diagnosticsPath = `artifacts/diagnostics/browser-${mode}-${input.week}.txt`;
  const screenshotPath = `artifacts/diagnostics/browser-${mode}-${input.week}.png`;

  try {
    const result = await action({ page });
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    await writeDiagnostics(diagnosticsPath, result.details);
    return {
      diagnosticsPath,
      receiptId: result.receiptId,
    };
  } catch (error) {
    const details = await collectPageDetails(page);
    await captureGameFrameArtifacts(page, `artifacts/diagnostics/browser-${mode}-${input.week}`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    await writeDiagnostics(diagnosticsPath, [
      `mode=${mode}`,
      `week=${input.week}`,
      ...details,
      `error=${error instanceof Error ? error.message : String(error)}`,
    ]);
    throw error;
  } finally {
    await browser.close();
  }
}

async function writeDiagnostics(path: string, lines: string[]): Promise<void> {
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
}

async function captureGameFrameArtifacts(page: any, basePath: string): Promise<void> {
  const frameHandle = await page.$('#ifrm_tab').catch(() => null);
  if (!frameHandle) {
    return;
  }
  await page.locator('#ifrm_tab').screenshot({ path: `${basePath}-iframe.png` }).catch(() => undefined);
  const frame = await frameHandle.contentFrame().catch(() => null);
  if (!frame) {
    return;
  }
  const html = await frame.content().catch(() => '');
  if (html) {
    await writeFile(`${basePath}-frame.html`, html, 'utf8').catch(() => undefined);
  }
}

async function collectPageDetails(page: any): Promise<string[]> {
  const title = await page.title().catch(() => '');
  const currentUrl = page.url();
  const checks = {
    hasBuyButton: await page.locator('#btnBuyLt645').count().catch(() => 0),
    hasGameFrame: await page.locator('#ifrm_tab').count().catch(() => 0),
    hasLoginInput: await page.locator('#inpUserId').count().catch(() => 0),
  };
  return [
    `currentUrl=${currentUrl}`,
    `title=${title}`,
    `hasBuyButton=${checks.hasBuyButton}`,
    `hasGameFrame=${checks.hasGameFrame}`,
    `hasLoginInput=${checks.hasLoginInput}`,
  ];
}

async function openPurchasePage(page: any): Promise<any> {
  await page.goto(LOTTO_INTRO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#btnBuyLt645').waitFor({ state: 'visible', timeout: 10000 });

  const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await page.locator('#btnBuyLt645').click();
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
    if (await looksLikePurchasePage(popup)) {
      return popup;
    }
    await popup.close().catch(() => undefined);
  }

  const directPage = await page.context().newPage();
  await directPage.goto(LOTTO_PURCHASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (await looksLikePurchasePage(directPage)) {
    return directPage;
  }

  const details = await collectPageDetails(directPage);
  throw new Error(`Could not reach purchase page.\n${details.join('\n')}`);
}

async function looksLikePurchasePage(page: any): Promise<boolean> {
  if (page.url().includes('m.dhlottery.co.kr')) {
    return false;
  }
  const hasFrame = await page.locator('#ifrm_tab').count().catch(() => 0);
  return hasFrame > 0 || page.url().includes('TotalGame.jsp');
}

async function resolveGameFrame(popup: any): Promise<any> {
  const handle = await popup.waitForSelector('#ifrm_tab', { timeout: 15000 });
  const frame = await handle.contentFrame();
  if (!frame) {
    throw new Error('Could not access purchase iframe');
  }
  await frame.waitForLoadState('domcontentloaded').catch(() => undefined);
  return frame;
}

async function switchToPensionTab(popup: any): Promise<void> {
  const canUseTabview = await popup.evaluate(() => typeof (window as any).tabview === 'function').catch(() => false);
  if (canUseTabview) {
    await popup.evaluate(() => {
      // @ts-ignore
      tabview('LP72');
    });
    await popup.waitForTimeout(1500);
    return;
  }

  await popup.goto(PENSION_PURCHASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
}

async function purchaseLottoTickets(frame: any, tickets: LottoTicket[]): Promise<void> {
  if (tickets.length > 5) {
    throw new Error('Lotto purchase supports at most 5 tickets per run');
  }
  for (const ticket of tickets) {
    for (const value of ticket) {
      await setCheckboxValue(frame, `#check645num${value}`);
    }
    await frame.waitForFunction(
      () => document.querySelectorAll('#checkNumGroup input[type="checkbox"][name="check645num"]:checked').length === 6,
      { timeout: 5000 },
    );
    await frame.locator('#btnSelectNum').click();
    await frame.waitForTimeout(300);
  }
}

async function finalizeLottoPurchase(frame: any): Promise<string> {
  await frame.locator('#btnBuy').click();
  await frame.locator('#popupLayerConfirm input[value="확인"]').click();
  await frame.waitForSelector('#report', { state: 'visible', timeout: 30000 });
  const receipt = await frame.locator('#barCode1').textContent();
  await frame.locator('#closeLayer').click();
  return (receipt || 'lotto-receipt-missing').trim();
}

async function purchasePensionTickets(frame: any, tickets: PensionTicket[]): Promise<void> {
  for (const ticket of tickets) {
    await selectPensionGroup(frame, ticket.group);
    for (const digit of ticket.number.split('')) {
      await frame.locator(`.lotto720_select_number_wrapper a:has-text("${digit}")`).first().click();
      await frame.waitForTimeout(100);
    }
    await frame.evaluate(() => {
      // @ts-ignore
      doVerify();
    });
    await frame.waitForTimeout(1000);
  }
}

async function finalizePensionPurchase(frame: any): Promise<string> {
  const page = frame.page();
  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 })
    .then(async (dialog: any) => {
      const message = dialog.message();
      await dialog.accept();
      return message;
    })
    .catch(() => null);
  await frame.evaluate(() => {
    // @ts-ignore
    doOrder();
  });
  const dialogMessage = await dialogPromise;
  try {
    await frame.waitForFunction(() => {
      const popup = document.querySelector('#lotto720_popup_confirm') as HTMLElement | null;
      if (!popup) {
        return false;
      }
      const style = window.getComputedStyle(popup);
      return style.display !== 'none' && style.visibility !== 'hidden' && popup.offsetParent !== null;
    }, { timeout: 10000 });
  } catch {
    const state = await collectPensionOrderState(frame);
    throw new Error([
      'Pension confirm popup did not appear after doOrder().',
      `dialog=${dialogMessage ?? 'none'}`,
      ...state,
    ].join('\n'));
  }
  await frame.evaluate(() => {
    // @ts-ignore
    doOrderRequest();
  });
  await frame.waitForFunction(() => {
    const popup = document.querySelector('#lotto720_popup_compleate') as HTMLElement | null;
    if (!popup) {
      return false;
    }
    const style = window.getComputedStyle(popup);
    return style.display !== 'none' && style.visibility !== 'hidden' && popup.offsetParent !== null;
  }, { timeout: 30000 });
  const receipt = await frame.locator('#orderNo').inputValue().catch(() => '');
  return (receipt || 'pension-order-missing').trim();
}

async function collectPensionOrderState(frame: any): Promise<string[]> {
  return frame.evaluate(() => {
    const getValue = (selector: string) => {
      return (document.querySelector(selector) as HTMLInputElement | null)?.value ?? '';
    };
    const confirm = document.querySelector('#lotto720_popup_confirm') as HTMLElement | null;
    const complete = document.querySelector('#lotto720_popup_compleate') as HTMLElement | null;
    return [
      `frm.BUY_NO=${getValue('#frm input[name="BUY_NO"]')}`,
      `frm.BUY_CNT=${getValue('#frm input[name="BUY_CNT"]')}`,
      `frm.BUY_SET_TYPE=${getValue('#frm input[name="BUY_SET_TYPE"]')}`,
      `set_type=${getValue('#set_type')}`,
      `classnum=${getValue('#classnum')}`,
      `selnum=${getValue('#selnum')}`,
      `confirm.display=${confirm ? window.getComputedStyle(confirm).display : 'missing'}`,
      `complete.display=${complete ? window.getComputedStyle(complete).display : 'missing'}`,
    ];
  });
}

async function setCheckboxValue(frame: any, selector: string): Promise<void> {
  await frame.locator(selector).waitFor({ state: 'attached', timeout: 10000 });
  await frame.evaluate((targetSelector: string) => {
    const element = document.querySelector(targetSelector) as HTMLInputElement | null;
    if (!element) {
      throw new Error(`Missing input: ${targetSelector}`);
    }
    element.checked = true;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector);
}

async function selectPensionGroup(frame: any, group: number): Promise<void> {
  const groupSelector = `.jogroup.num${group}`;
  await frame.locator(groupSelector).waitFor({ state: 'visible', timeout: 10000 });
  await frame.locator(groupSelector).click();
  await frame.waitForFunction(
    (expectedGroup: number) => {
      const setType = (document.querySelector('#set_type') as HTMLInputElement | null)?.value;
      const classNum = (document.querySelector('#classnum') as HTMLInputElement | null)?.value;
      return setType === 'S' && classNum === String(expectedGroup);
    },
    group,
    { timeout: 5000 },
  );
}
