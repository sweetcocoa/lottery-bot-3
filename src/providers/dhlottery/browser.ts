import { mkdir, writeFile } from 'node:fs/promises';
import type { LottoTicket, PensionTicket } from '../../core/random-picks.ts';
import { runPurchaseBatch, type PurchaseProduct } from './purchase-run.ts';
import { buyLottoOnScreen, buyPensionOnScreen } from './purchase-screen.ts';
import { withPurchaseWindow } from './purchase-window.ts';
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
}

export class BrowserDhlotteryProvider {
  async smoke(input: BrowserInput): Promise<BrowserArtifacts> {
    return runBrowserFlow('smoke', input, async ({ page }) => {
      await login(page, input.username, input.password);
      const details = [`mode=smoke`, `week=${input.week}`];
      for (const product of requestedProducts(input)) {
        await withPurchaseWindow(page, product, async () => undefined);
        details.push(`${product}Ready=true`);
      }
      return { details };
    });
  }

  async purchase(input: BrowserInput & { lottoRound: number; pensionRound: number }): Promise<BrowserArtifacts & {
    receipts: Partial<Record<PurchaseProduct, string>>;
  }> {
    if (input.lottoTickets.length > 5 || input.pensionTickets.length > 1) {
      throw new Error('Requested purchase count exceeds the configured product limits');
    }
    return runBrowserFlow('purchase', input, async ({ page }) => {
      await login(page, input.username, input.password);
      const receipts = await runPurchaseBatch(requestedProducts(input), (product, setStage) =>
        withPurchaseWindow(page, product, (frame, allowConfirmation, checkDialog) => product === 'lotto'
          ? buyLottoOnScreen(frame, input.lottoTickets, input.lottoRound, setStage, checkDialog)
          : buyPensionOnScreen(frame, input.pensionTickets[0], input.pensionRound, setStage, allowConfirmation, checkDialog)));
      return {
        receipts,
        details: [`mode=live`, `week=${input.week}`, ...Object.keys(receipts).map((product) => `${product}=confirmed`)],
      };
    });
  }
}

function requestedProducts(input: BrowserInput): PurchaseProduct[] {
  const products: PurchaseProduct[] = [];
  if (input.lottoTickets.length) products.push('lotto');
  if (input.pensionTickets.length) products.push('pension');
  return products;
}

async function runBrowserFlow<T extends { details: string[] }>(
  mode: 'smoke' | 'purchase',
  input: BrowserInput,
  action: (session: { page: any }) => Promise<T>,
): Promise<BrowserArtifacts & Omit<T, 'details'>> {
  await mkdir('artifacts/diagnostics', { recursive: true });
  const { browser, page } = await createBrowserSession();
  const diagnosticsPath = `artifacts/diagnostics/browser-${mode}-${input.week}.txt`;

  try {
    const { details, ...result } = await action({ page });
    await writeDiagnostics(diagnosticsPath, details).catch(() => console.warn('Could not save purchase diagnostics'));
    return { ...result, diagnosticsPath };
  } catch (error) {
    await writeDiagnostics(diagnosticsPath, [
      `mode=${mode}`,
      `week=${input.week}`,
      `pageClosed=${page.isClosed()}`,
      `error=${error instanceof Error ? error.message : String(error)}`,
    ]).catch(() => console.warn('Could not save purchase failure diagnostics'));
    throw error;
  } finally {
    await browser.close().catch(() => console.warn('Could not close purchase browser'));
  }
}

async function writeDiagnostics(path: string, lines: string[]): Promise<void> {
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
}
