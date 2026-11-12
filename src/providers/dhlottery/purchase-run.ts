export type PurchaseProduct = 'lotto' | 'pension';
export type PurchaseStage = 'open' | 'selection' | 'confirmation' | 'submission' | 'receipt';
type PurchaseState = 'not-started' | 'not-submitted' | 'rejected' | 'unconfirmed' | 'confirmed';

export class PurchaseRejectedError extends Error {}

export async function runPurchaseBatch(
  products: PurchaseProduct[],
  execute: (product: PurchaseProduct, setStage: (stage: PurchaseStage) => void) => Promise<string>,
): Promise<Partial<Record<PurchaseProduct, string>>> {
  const receipts: Partial<Record<PurchaseProduct, string>> = {};
  const state: Record<PurchaseProduct, PurchaseState> = { lotto: 'not-started', pension: 'not-started' };
  for (const product of products) {
    let stage: PurchaseStage = 'open';
    let submissionStarted = false;
    try {
      const receipt = (await execute(product, (nextStage) => {
        stage = nextStage;
        if (nextStage === 'submission') {
          if (submissionStarted) throw new Error('Duplicate purchase submission blocked');
          submissionStarted = true;
          console.log(`Purchase ${product}: submission starting`);
        }
      })).trim();
      if (!submissionStarted || !receipt) throw new Error('Missing verified purchase receipt');
      receipts[product] = receipt;
      state[product] = 'confirmed';
      console.log(`Purchase ${product}: receipt confirmed`);
    } catch (error) {
      state[product] = error instanceof PurchaseRejectedError ? 'rejected' : submissionStarted ? 'unconfirmed' : 'not-submitted';
      const reason = error instanceof Error ? error.message.split('\n', 1)[0] : String(error);
      const hint = state[product] === 'unconfirmed' ? ' Check account purchase history before another run.' : '';
      throw new Error(`Purchase stopped: product=${product} stage=${stage} lotto=${state.lotto} pension=${state.pension}; ${reason}.${hint}`, { cause: error });
    }
  }
  return receipts;
}
