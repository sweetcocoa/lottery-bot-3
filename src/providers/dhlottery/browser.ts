import { mkdir, writeFile } from 'node:fs/promises';
import type { LottoTicket, PensionTicket } from '../../core/random-picks.ts';

interface BrowserPurchaseInput {
  username: string;
  password: string;
  week: string;
  lottoTickets: LottoTicket[];
  pensionTickets: PensionTicket[];
}

export class BrowserDhlotteryProvider {
  async purchase(input: BrowserPurchaseInput): Promise<{ receiptId: string; diagnosticsPath: string }> {
    const playwright = await importPlaywright();
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
    await mkdir('artifacts/diagnostics', { recursive: true });
    const diagnosticsPath = `artifacts/diagnostics/browser-purchase-${input.week}.txt`;

    try {
      await login(page, input.username, input.password);

      const lotteryPopup = await openPurchasePopup(page);
      const lottoFrame = await resolveGameFrame(lotteryPopup);
      await purchaseLottoTickets(lottoFrame, input.lottoTickets);
      const lottoReceipt = await finalizeLottoPurchase(lottoFrame);

      await lotteryPopup.evaluate(() => {
        // @ts-ignore
        tabview('LP72');
      });
      await lotteryPopup.waitForTimeout(1500);
      const pensionFrame = await resolveGameFrame(lotteryPopup);
      await purchasePensionTickets(pensionFrame, input.pensionTickets);
      const pensionReceipt = await finalizePensionPurchase(pensionFrame);

      const summary = [
        `week=${input.week}`,
        `lotto=${input.lottoTickets.map((ticket) => ticket.join('-')).join('|')}`,
        `lottoReceipt=${lottoReceipt}`,
        `pension=${input.pensionTickets.map((ticket) => `${ticket.group}:${ticket.number}`).join('|')}`,
        `pensionReceipt=${pensionReceipt}`,
      ].join('\n');
      await writeFile(diagnosticsPath, `${summary}\n`, 'utf8');
      return {
        receiptId: `browser-${input.week}-${Date.now()}`,
        diagnosticsPath,
      };
    } catch (error) {
      await page.screenshot({ path: `artifacts/diagnostics/browser-purchase-${input.week}.png`, fullPage: true }).catch(() => undefined);
      throw error;
    } finally {
      await browser.close();
    }
  }
}

async function importPlaywright(): Promise<any> {
  try {
    return await import('playwright');
  } catch {
    throw new Error('playwright package is not installed. Install it before using --provider=browser or --mode=live.');
  }
}

async function login(page: any, username: string, password: string): Promise<void> {
  await page.goto('https://www.dhlottery.co.kr/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#inpUserId').fill(username);
  await page.locator('#inpUserPswdEncn').fill(password);
  await page.locator('#btnLogin').click();
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
}

async function openPurchasePopup(page: any): Promise<any> {
  await page.goto('https://www.dhlottery.co.kr/lt645/intro', { waitUntil: 'domcontentloaded' });
  const popupPromise = page.waitForEvent('popup', { timeout: 10000 });
  await page.locator('#btnBuyLt645').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
  return popup;
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

async function purchaseLottoTickets(frame: any, tickets: LottoTicket[]): Promise<void> {
  if (tickets.length > 5) {
    throw new Error('Lotto purchase supports at most 5 tickets per run');
  }
  for (const ticket of tickets) {
    for (const value of ticket) {
      await frame.locator(`#check645num${value}`).check();
    }
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
    await frame.locator(`#lotto720_radio_group_wrapper_num${ticket.group}`).check();
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
  await frame.evaluate(() => {
    // @ts-ignore
    doOrder();
  });
  await frame.waitForSelector('#lotto720_popup_confirm', { state: 'visible', timeout: 10000 });
  await frame.evaluate(() => {
    // @ts-ignore
    doOrderRequest();
  });
  await frame.waitForSelector('#lotto720_popup_compleate', { state: 'visible', timeout: 30000 });
  const receipt = await frame.locator('#orderNo').inputValue().catch(() => '');
  return (receipt || 'pension-order-missing').trim();
}
