import { constants, createPublicKey, publicEncrypt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { APIResponse } from 'playwright';

export const HISTORY_ORIGIN = 'https://www.dhlottery.co.kr';
const REQUEST_TIMEOUT_MS = 15000;
const READ_ATTEMPTS = 2;

type HistoryResponse = Pick<APIResponse, 'dispose' | 'headers' | 'json' | 'ok' | 'status' | 'text'>;
type ReadOptions = { maxRedirects?: number; headers?: Record<string, string> };
interface HistoryRequest {
  get(url: string, options: ReadOptions & { timeout: number }): Promise<HistoryResponse>;
  post(url: string, options: {
    form: Record<string, string>;
    headers: Record<string, string>;
    timeout: number;
    maxRedirects: number;
  }): Promise<HistoryResponse>;
}

function isTransientReadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.split('\n', 1)[0];
  return error.name === 'TimeoutError'
    || /\b(?:Timeout \d+ms exceeded|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED)\b/i.test(message);
}

export async function getHistoryPage(
  request: Pick<HistoryRequest, 'get'>,
  path: string,
  stage: string,
  options: ReadOptions = {},
): Promise<HistoryResponse> {
  for (let attempt = 1; ; attempt += 1) {
    let response: HistoryResponse;
    try {
      response = await request.get(`${HISTORY_ORIGIN}${path}`, { ...options, timeout: REQUEST_TIMEOUT_MS });
    } catch (error) {
      const transient = isTransientReadError(error);
      if (!transient || attempt === READ_ATTEMPTS) {
        const reason = transient ? 'timeout or connection failure' : 'request failed';
        throw new Error(`Dhlottery ${stage} failed (attempt ${attempt}/${READ_ATTEMPTS}): ${reason}`);
      }
      console.warn(`Dhlottery ${stage}: temporary connection error; retrying (${attempt}/${READ_ATTEMPTS})`);
      await delay(750);
      continue;
    }

    const status = response.status();
    if (![408, 502, 503, 504].includes(status)) return response;
    await response.dispose();
    if (attempt === READ_ATTEMPTS) {
      throw new Error(`Dhlottery ${stage} failed (attempt ${attempt}/${READ_ATTEMPTS}): HTTP ${status}`);
    }
    console.warn(`Dhlottery ${stage}: HTTP ${status}; retrying (${attempt}/${READ_ATTEMPTS})`);
    await delay(750);
  }
}

interface RsaModulusResponse {
  data?: { rsaModulus?: string; publicExponent?: string };
}

function encodeRsa(value: string, modulus: string, exponent: string): string {
  if (!/^[0-9a-f]+$/i.test(modulus) || !/^[0-9a-f]+$/i.test(exponent)) {
    throw new Error('Dhlottery returned an invalid login encryption key');
  }
  const toBase64Url = (hex: string) => Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex').toString('base64url');
  const key = createPublicKey({
    key: { kty: 'RSA', n: toBase64Url(modulus), e: toBase64Url(exponent) },
    format: 'jwk',
  });
  return publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(value, 'utf8')).toString('hex');
}

export async function loginForHistory(request: HistoryRequest, username: string, password: string): Promise<void> {
  const loginPage = await getHistoryPage(request, '/login', 'history login page');
  if (!loginPage.ok() || !((await loginPage.text()).includes('id="loginForm"'))) {
    throw new Error(`Dhlottery login page unavailable (status=${loginPage.status()})`);
  }

  const keyResponse = await getHistoryPage(request, '/login/selectRsaModulus.do', 'history login key');
  if (!keyResponse.ok()) throw new Error(`Dhlottery login key request failed (status=${keyResponse.status()})`);
  const keyData = (await keyResponse.json() as RsaModulusResponse).data;
  if (!keyData?.rsaModulus || !keyData.publicExponent) {
    throw new Error('Dhlottery login key response is incomplete');
  }

  const form = {
    userId: encodeRsa(username, keyData.rsaModulus, keyData.publicExponent),
    userPswdEncn: encodeRsa(password, keyData.rsaModulus, keyData.publicExponent),
    inpUserId: username,
  };
  let loginResponse: HistoryResponse;
  try {
    loginResponse = await request.post(`${HISTORY_ORIGIN}/login/securityLoginCheck.do`, {
      form,
      maxRedirects: 0,
      headers: { origin: HISTORY_ORIGIN, referer: `${HISTORY_ORIGIN}/login` },
      timeout: REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    // Playwright can include request details in its errors. Keep the login form out of diagnostics.
    const reason = isTransientReadError(error) ? 'timeout or connection failure' : 'request failed';
    throw new Error(`Dhlottery history login submission failed: ${reason}`);
  }
  const location = loginResponse.headers().location ?? '';
  if (location.includes('/mbrsrvc/ExpryPswdNoti')) {
    throw new Error('Dhlottery password has expired. Update DHLOTTERY_PASSWORD after changing it on the site.');
  }
  if (loginResponse.status() >= 400) {
    throw new Error(`Dhlottery login request failed (status=${loginResponse.status()})`);
  }

  const ledger = await getHistoryPage(request, '/mypage/mylotteryledger', 'history session verification', {
    maxRedirects: 0,
  });
  if (ledger.status() !== 200 || !(await ledger.text()).includes('MyLotteryledgerM')) {
    const loginRedirect = location ? new URL(location, HISTORY_ORIGIN).pathname : 'none';
    const ledgerRedirect = ledger.headers().location ? new URL(ledger.headers().location, HISTORY_ORIGIN).pathname : 'none';
    const loginBody = await loginResponse.text();
    const errorCode = loginBody.match(/const errorCode = '([\w-]{0,40})'/)?.[1] || 'none';
    const rawMessage = loginBody.match(/const errorMessage = '([^']{0,200})'/)?.[1] || 'none';
    const errorMessage = rawMessage.replaceAll(username, '[redacted]').replaceAll(password, '[redacted]');
    throw new Error(`Dhlottery login did not establish an authenticated purchase-history session (loginStatus=${loginResponse.status()}, loginRedirect=${loginRedirect}, errorCode=${errorCode}, errorMessage=${errorMessage}, ledgerStatus=${ledger.status()}, ledgerRedirect=${ledgerRedirect})`);
  }
}
