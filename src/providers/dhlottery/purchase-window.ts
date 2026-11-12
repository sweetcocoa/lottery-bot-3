import type { Dialog, Frame, Page } from 'playwright';
import type { PurchaseProduct } from './purchase-run.ts';

const PRODUCT_SCREEN = {
  lotto: { intro: 'lt645', buyButton: '#btnBuyLt645', ready: '#btnSelectNum' },
  pension: { intro: 'pt720', buyButton: '#btnBuyPt720', ready: '.jogroup.num1' },
};

export async function withPurchaseWindow<T>(
  parent: Page,
  product: PurchaseProduct,
  use: (frame: Frame, allowPensionConfirmation: (allow: boolean) => void, checkDialog: () => void) => Promise<T>,
): Promise<T> {
  const context = parent.context();
  const config = PRODUCT_SCREEN[product];
  const observed = new Set<Page>();
  let popup: Page | undefined;
  let unexpectedDialog: string | undefined;
  let allowPensionConfirmation = false;
  const onDialog = async (dialog: Dialog) => {
    const message = dialog.message().replace(/\s+/g, ' ').trim().slice(0, 300);
    if (allowPensionConfirmation && product === 'pension' && dialog.type() === 'confirm'
      && message.includes('모든조 구매') && message.includes('정말 구매하시겠습니까?')) {
      allowPensionConfirmation = false;
      await dialog.accept().catch(() => undefined);
      return;
    }
    unexpectedDialog ??= message || 'Site displayed an unexpected dialog';
    await dialog.dismiss().catch(() => undefined);
  };
  const observe = (page: Page) => {
    if (observed.has(page)) return;
    observed.add(page);
    page.on('dialog', onDialog);
  };
  const checkDialog = () => {
    if (unexpectedDialog) throw new Error(`Site message: ${unexpectedDialog}`);
  };
  observe(parent);
  context.on('page', observe);
  try {
    const response = await parent.goto(`https://www.dhlottery.co.kr/${config.intro}/intro`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (!response?.ok()) throw new Error(`Product page returned HTTP ${response?.status() ?? 'unknown'}`);
    [popup] = await Promise.all([
      parent.waitForEvent('popup', { timeout: 15000 }),
      parent.locator(config.buyButton).click({ timeout: 10000 }),
    ]);
    const iframe = await popup.waitForSelector('#ifrm_tab', { state: 'attached', timeout: 15000 });
    const frame = await iframe?.contentFrame();
    if (!frame) throw new Error('Purchase window did not contain the game frame');
    await frame.locator(config.ready).waitFor({ state: 'visible', timeout: 15000 });
    checkDialog();
    return await use(frame, (allow) => { allowPensionConfirmation = allow; }, checkDialog);
  } catch (error) {
    if (unexpectedDialog && !(error instanceof Error && error.message.includes(unexpectedDialog))) {
      const reason = error instanceof Error ? error.message.split('\n', 1)[0] : String(error);
      throw new Error(`Site message: ${unexpectedDialog}; ${reason}`, { cause: error });
    }
    throw error;
  } finally {
    if (popup && !popup.isClosed()) await popup.close().catch(() => console.warn('Could not close purchase window'));
    context.off('page', observe);
    for (const page of observed) page.off('dialog', onDialog);
  }
}
