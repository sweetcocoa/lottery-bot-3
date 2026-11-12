import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { buyLottoOnScreen, buyPensionOnScreen } from '../src/providers/dhlottery/purchase-screen.ts';
import { runPurchaseBatch } from '../src/providers/dhlottery/purchase-run.ts';
import { withPurchaseWindow } from '../src/providers/dhlottery/purchase-window.ts';

const numbers = [1, 3, 5, 7, 9, 11];
const ticket = { group: 1, number: '012345' };

function lottoFixture(): string {
  return `<meta charset="utf-8">
    <span id="curRound">1250</span><span id="payAmt">0</span>
    <div id="checkNumGroup">${numbers.map((n) => `<input type="checkbox" id="check645num${n}" name="check645num" value="${n}"><label for="check645num${n}">${n}</label>`).join('')}</div>
    <button id="btnSelectNum" onclick="selectTicket()">Select</button>
    ${Array.from('ABCDE', (slot) => Array.from({ length: 6 }, (_, i) => `<span id="num${i}${slot}"></span>`).join('')).join('')}
    <button id="btnBuy" onclick="document.querySelector('#popupLayerConfirm').hidden = false">Confirm</button>
    <div id="popupLayerConfirm" hidden><input type="button" value="확인" onclick="submitFixture()"></div>
    <div id="popupLayerAlert" hidden></div>
    <div id="report" hidden><span id="barCode1">fixture-lotto</span><span id="buyRound">제 1250회</span><span id="nBuyAmount">1,000</span>
      <ul id="reportRow"><li><div class="nums">${numbers.map((number) => `<span>${number}</span>`).join('')}</div></li></ul></div>
    <script>
      function selectTicket() {
        Array.from(document.querySelectorAll('input:checked')).forEach((input,i) => {
          document.querySelector('#num' + i + 'A').textContent = input.value;
          input.checked = false;
        });
        document.querySelector('#payAmt').textContent = '1,000';
      }
      async function submitFixture() {
        await recordFixtureSubmission('lotto');
        document.querySelector('#popupLayerConfirm').hidden = true;
        document.querySelector('#report').hidden = false;
      }
    </script>`;
}

function pensionFixture(outcome: 'closed' | 'number-only' | 'success' | 'wrong-price' | 'low-balance'): string {
  return `<meta charset="utf-8">
    <input id="ROUND" type="hidden" value="341"><input id="classnum" type="hidden">
    <button class="jogroup num1" onclick="document.querySelector('#classnum').value='1'">1</button>
    ${Array.from({ length: 6 }, (_, i) => `<input id="num${i + 1}" type="hidden">`).join('')}
    <div class="lotto720_select_number_wrapper">${Array.from(ticket.number, (digit) => `<button class="numsgroup num${digit}" onclick="choose('${digit}')">${digit}</button>`).join('')}</div>
    <form id="frm"><input name="BUY_NO" type="hidden"><input name="BUY_CNT" type="hidden"><input id="curpay" type="hidden"></form>
    <button class="lotto720_btn_confirm_number" onclick="verify()">Verify</button>
    <button class="lotto720_btn_pay" onclick="prepare()">Confirm</button>
    <div id="lotto720_popup_confirm" hidden><button class="btn_blue" onclick="submitFixture()">Submit</button></div>
    <input id="orderNo" type="hidden">
    <div id="lotto720_popup_pay" hidden><span class="orderNo">fixture-pension</span><span class="saleCnt">1</span><span class="failCnt">0</span>
      <ul class="saleTicket"><li><span>1조</span>012345</li></ul></div>
    <script>
      const scenario = ${JSON.stringify(outcome)};
      let digits = '';
      function choose(value) {
        if (scenario === 'closed') { alert('Fixture session ended'); parent.close(); return; }
        digits += value;
        document.querySelector('#num' + digits.length).value = value;
      }
      function verify() {
        document.querySelector('[name=BUY_NO]').value = '1' + digits;
        document.querySelector('[name=BUY_CNT]').value = '1';
        document.querySelector('#curpay').value = scenario === 'wrong-price' ? '2000' : '1000';
      }
      function prepare() {
        if (scenario === 'low-balance') { alert('보유중인 예치금을 확인해 주세요'); return; }
        if (confirm('모든조 구매 안내. 정말 구매하시겠습니까?')) document.querySelector('#lotto720_popup_confirm').hidden = false;
      }
      async function submitFixture() {
        await recordFixtureSubmission('pension');
        document.querySelector('#orderNo').value = 'created-only';
        if (scenario === 'number-only') { parent.close(); return; }
        document.querySelector('#lotto720_popup_pay').hidden = false;
      }
    </script>`;
}

test('purchase browser fixtures isolate both windows and never treat an order number as a receipt', {
  skip: process.env.RUN_PURCHASE_FIXTURES !== '1', timeout: 45000,
}, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const submissions: string[] = [];
    let outcome: Parameters<typeof pensionFixture>[0] = 'success';
    await context.exposeBinding('recordFixtureSubmission', (_, product: string) => { submissions.push(product); });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET' || url.origin !== 'https://www.dhlottery.co.kr') return route.abort();
      const product = url.pathname.includes('pt720') ? 'pt720' : 'lt645';
      let body: string;
      if (url.pathname === `/${product}/intro`) {
        const button = product === 'pt720' ? 'btnBuyPt720' : 'btnBuyLt645';
        body = `<button id="${button}" onclick="window.open('/${product}/fixture-popup', 'fixture')">Open</button>`;
      } else if (url.pathname === `/${product}/fixture-popup`) {
        body = `<iframe id="ifrm_tab" src="/${product}/fixture-frame"></iframe>`;
      } else if (url.pathname === `/${product}/fixture-frame`) {
        body = product === 'pt720' ? pensionFixture(outcome) : lottoFixture();
      } else {
        return route.abort();
      }
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    });

    const page = await context.newPage();
    const run = () => runPurchaseBatch(['lotto', 'pension'], (product, stage) =>
      withPurchaseWindow(page, product, (frame, allow, check) => product === 'lotto'
        ? buyLottoOnScreen(frame, [numbers], 1250, stage, check)
        : buyPensionOnScreen(frame, ticket, 341, stage, allow, check)));
    assert.deepEqual(await run(), { lotto: 'fixture-lotto', pension: 'fixture-pension' });
    assert.deepEqual(submissions.splice(0), ['lotto', 'pension']);
    assert.equal(context.pages().length, 1);

    outcome = 'closed';
    await assert.rejects(run(), /stage=selection lotto=confirmed pension=not-submitted.*Fixture session ended/);
    assert.deepEqual(submissions.splice(0), ['lotto']);

    outcome = 'number-only';
    await assert.rejects(run(), /lotto=confirmed pension=unconfirmed/);
    assert.deepEqual(submissions.splice(0), ['lotto', 'pension']);

    outcome = 'wrong-price';
    await assert.rejects(run(), /lotto=confirmed pension=not-submitted.*amount was not verified/);
    assert.deepEqual(submissions.splice(0), ['lotto']);

    outcome = 'low-balance';
    await assert.rejects(run(), /stage=confirmation lotto=confirmed pension=not-submitted.*예치금을 확인해 주세요/);
    assert.deepEqual(submissions, ['lotto']);
  } finally {
    await browser.close();
  }
});
