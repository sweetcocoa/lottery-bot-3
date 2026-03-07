import { mkdir, writeFile } from 'node:fs/promises';
import type { LottoTicket, PensionTicket } from '../../core/random-picks.ts';

export interface PurchaseArtifacts {
  receiptId: string;
  diagnosticsPath: string;
}

export class MockDhlotteryProvider {
  async purchase(input: {
    mode: 'dry-run' | 'smoke' | 'live';
    week: string;
    lottoTickets: LottoTicket[];
    pensionTickets: PensionTicket[];
  }): Promise<PurchaseArtifacts> {
    await mkdir('artifacts/diagnostics', { recursive: true });
    const diagnosticsPath = `artifacts/diagnostics/mock-purchase-${input.week}.txt`;
    const contents = [
      `mode=${input.mode}`,
      `week=${input.week}`,
      `lotto=${input.lottoTickets.map((ticket) => ticket.join('-')).join('|')}`,
      `pension=${input.pensionTickets.map((ticket) => `${ticket.group}:${ticket.number}`).join('|')}`,
    ].join('\n');
    await writeFile(diagnosticsPath, `${contents}\n`, 'utf8');
    return {
      receiptId: `mock-${input.week}`,
      diagnosticsPath,
    };
  }
}
