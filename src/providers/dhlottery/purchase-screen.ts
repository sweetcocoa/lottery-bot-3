import type { Frame } from 'playwright';
import type { LottoTicket, PensionTicket } from '../../core/random-picks.ts';
import { PurchaseRejectedError, type PurchaseStage } from './purchase-run.ts';

const STEP_TIMEOUT = 10000;
const RECEIPT_TIMEOUT = 30000;
const TICKET_PRICE = 1000;

export async function buyLottoOnScreen(
  frame: Frame, tickets: LottoTicket[], round: number, stage: (value: PurchaseStage) => void, checkDialog: () => void,
): Promise<string> {
  stage('selection');
  await checkLottoRound(frame, round);
  for (const [index, ticket] of tickets.entries()) {
    for (const number of ticket) await frame.locator(`label[for="check645num${number}"]`).click({ timeout: STEP_TIMEOUT });
    const selected = await frame.locator('#checkNumGroup input[name="check645num"]:checked')
      .evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
    if (ticketKey(selected) !== ticketKey(ticket)) throw new Error('Lotto selection does not match the requested ticket');
    await frame.locator('#btnSelectNum').click({ timeout: STEP_TIMEOUT });
    await frame.waitForFunction((slot: string) => Boolean(document.querySelector(`#num5${slot}`)?.textContent?.trim()),
      'ABCDE'[index], { timeout: STEP_TIMEOUT });
    checkDialog();
  }

  stage('confirmation');
  const queued = await frame.evaluate(() => Array.from('ABCDE', (slot) => Array.from({ length: 6 }, (_, index) =>
    Number(document.querySelector(`#num${index}${slot}`)?.textContent?.trim() || 0)))
    .filter((row) => row.some((number) => number !== 0)));
  assertTicketList(queued, tickets, 'Lotto confirmation');
  await checkLottoRound(frame, round);
  const amount = await frame.locator('#payAmt').textContent({ timeout: STEP_TIMEOUT });
  if (readAmount(amount) !== tickets.length * TICKET_PRICE) throw new Error('Lotto checkout amount does not match the requested tickets');
  await frame.locator('#btnBuy').click({ timeout: STEP_TIMEOUT });
  await waitForLottoPanel(frame, '#popupLayerConfirm', STEP_TIMEOUT);
  await checkLottoAlert(frame);
  await checkLottoRound(frame, round);
  checkDialog();

  stage('submission');
  await frame.locator('#popupLayerConfirm input[value="확인"]').click({ timeout: STEP_TIMEOUT });
  stage('receipt');
  await waitForLottoPanel(frame, '#report', RECEIPT_TIMEOUT);
  await checkLottoAlert(frame);
  checkDialog();
  const receipt = await frame.evaluate(() => ({
    id: document.querySelector('#barCode1')?.textContent?.trim(),
    round: document.querySelector('#buyRound')?.textContent?.trim(),
    amount: document.querySelector('#nBuyAmount')?.textContent,
    tickets: Array.from(document.querySelectorAll('#reportRow li .nums'), (row) =>
      Array.from(row.querySelectorAll('span'), (node) => Number(node.textContent?.trim()))),
  }));
  if (!receipt.id || Number(receipt.round?.match(/^제\s*(\d+)\s*회$/)?.[1]) !== round
    || readAmount(receipt.amount) !== tickets.length * TICKET_PRICE) {
    throw new Error('Lotto receipt is missing or does not match the expected round and amount');
  }
  assertTicketList(receipt.tickets, tickets, 'Lotto receipt');
  return receipt.id;
}

async function checkLottoRound(frame: Frame, round: number): Promise<void> {
  const current = await frame.locator('#curRound').textContent({ timeout: STEP_TIMEOUT });
  if (Number(current) !== round) throw new Error(`Lotto checkout is not on round ${round}`);
}

async function waitForLottoPanel(frame: Frame, selector: string, timeout: number): Promise<void> {
  await frame.waitForFunction((target: string) => [target, '#popupLayerAlert'].some((id) => {
    const element = document.querySelector(id);
    return !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  }), selector, { timeout });
}

async function checkLottoAlert(frame: Frame): Promise<void> {
  const alert = frame.locator('#popupLayerAlert');
  if (await alert.isVisible()) {
    const message = await alert.locator('.layer-message').textContent({ timeout: STEP_TIMEOUT });
    throw new Error(`Lotto order failed: ${message?.replace(/\s+/g, ' ').trim() || 'site rejected the request'}`);
  }
}

export async function buyPensionOnScreen(
  frame: Frame,
  ticket: PensionTicket,
  round: number,
  stage: (value: PurchaseStage) => void,
  allowConfirmation: (allow: boolean) => void,
  checkDialog: () => void,
): Promise<string> {
  stage('selection');
  await checkPensionRound(frame, round);
  await frame.locator(`.jogroup.num${ticket.group}`).click({ timeout: STEP_TIMEOUT });
  await frame.waitForFunction((group: number) => (document.querySelector('#classnum') as HTMLInputElement | null)?.value === String(group),
    ticket.group, { timeout: STEP_TIMEOUT });
  for (const [index, digit] of Array.from(ticket.number).entries()) {
    await frame.locator(`.lotto720_select_number_wrapper .numsgroup.num${digit}`).click({ timeout: STEP_TIMEOUT });
    await frame.waitForFunction(({ slot, value }) => (document.querySelector(`#num${slot}`) as HTMLInputElement | null)?.value === value,
      { slot: index + 1, value: digit }, { timeout: STEP_TIMEOUT });
    checkDialog();
  }
  await frame.locator('.lotto720_btn_confirm_number').click({ timeout: STEP_TIMEOUT });
  await frame.waitForFunction(() => {
    const selected = (document.querySelector('#frm input[name="BUY_NO"]') as HTMLInputElement | null)?.value;
    const recommendation = document.querySelector('#lotto720_popup_recomand');
    return Boolean(selected) || Boolean(recommendation?.getClientRects().length);
  }, null, { timeout: STEP_TIMEOUT });
  checkDialog();
  await checkPensionSelection(frame, ticket);

  stage('confirmation');
  const confirm = frame.locator('#lotto720_popup_confirm .btn_blue');
  allowConfirmation(true);
  try {
    await frame.locator('.lotto720_btn_pay').click({ timeout: STEP_TIMEOUT });
    checkDialog();
    await confirm.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  } finally {
    allowConfirmation(false);
  }
  checkDialog();
  await checkPensionRound(frame, round);
  await checkPensionSelection(frame, ticket);
  checkDialog();

  stage('submission');
  await confirm.click({ timeout: STEP_TIMEOUT });
  stage('receipt');
  const panel = frame.locator('#lotto720_popup_pay');
  await panel.waitFor({ state: 'visible', timeout: RECEIPT_TIMEOUT });
  checkDialog();
  const receipt = await panel.evaluate((root) => {
    const text = (selector: string) => root.querySelector(selector)?.textContent?.trim() ?? '';
    return { id: text('.orderNo'), sold: text('.saleCnt'), failed: text('.failCnt'), ticket: text('.saleTicket li'), reason: text('.saleRetMsg') };
  });
  if (receipt.sold === '0' && receipt.failed === '1') {
    throw new PurchaseRejectedError(`Pension order failed: ${receipt.reason || 'No ticket was sold'}`);
  }
  if (!receipt.id || receipt.sold !== '1' || receipt.failed !== '0'
    || receipt.ticket.replace(/\s/g, '') !== `${ticket.group}조${ticket.number}`) {
    throw new Error('Pension receipt does not confirm the requested ticket');
  }
  return receipt.id;
}

async function checkPensionRound(frame: Frame, round: number): Promise<void> {
  if (Number(await frame.locator('#ROUND').inputValue({ timeout: STEP_TIMEOUT })) !== round) {
    throw new Error(`Pension checkout is not on round ${round}`);
  }
}

async function checkPensionSelection(frame: Frame, ticket: PensionTicket): Promise<void> {
  const selection = await frame.evaluate(() => {
    const value = (selector: string) => (document.querySelector(selector) as HTMLInputElement | null)?.value ?? '';
    return { ticket: value('#frm input[name="BUY_NO"]'), count: value('#frm input[name="BUY_CNT"]'), amount: value('#curpay') };
  });
  if (selection.ticket !== `${ticket.group}${ticket.number}` || selection.count !== '1' || readAmount(selection.amount) !== TICKET_PRICE) {
    throw new Error('Pension ticket or amount was not verified; no alternative number will be selected');
  }
}

function ticketKey(ticket: number[]): string {
  return [...ticket].sort((a, b) => a - b).join(',');
}

function assertTicketList(actual: number[][], expected: LottoTicket[], stage: string): void {
  if (JSON.stringify(actual.map(ticketKey).sort()) !== JSON.stringify(expected.map(ticketKey).sort())) {
    throw new Error(`${stage} tickets do not match the requested numbers`);
  }
}

function readAmount(value: string | null | undefined): number {
  const amount = value?.trim().replaceAll(',', '');
  return amount && /^\d+$/.test(amount) ? Number(amount) : NaN;
}
