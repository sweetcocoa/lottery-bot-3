import { readFile } from 'node:fs/promises';

const MAX_REASON_LENGTH = 1200;

export async function readBuyFailureReason(path = 'artifacts/diagnostics/buy-command.log'): Promise<string | undefined> {
  try {
    return extractBuyFailureReason(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export function extractBuyFailureReason(log: string): string | undefined {
  const lines = log
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const explicitReasonIndex = lines.findIndex((line) => /(?:lotto|pension) order failed:/i.test(line));
  if (explicitReasonIndex >= 0) {
    const explicitReason = lines[explicitReasonIndex];
    const nextLine = lines[explicitReasonIndex + 1];
    const continuation = nextLine && /^오류메시지[:：]/.test(nextLine) ? ` ${nextLine}` : '';
    return trimReason(`${explicitReason}${continuation}`);
  }

  const errorLine = [...lines].reverse().find((line) =>
    /(?:^error=|\berror\b|timeout|failed|부족|초과|오류)/i.test(line),
  );
  return errorLine ? trimReason(errorLine) : undefined;
}

function trimReason(reason: string): string {
  return reason.replace(/\s+/g, ' ').slice(0, MAX_REASON_LENGTH);
}
