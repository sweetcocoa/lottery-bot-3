import { constants, createPublicKey, publicEncrypt } from 'node:crypto';

const BASE_URL = 'https://www.dhlottery.co.kr';
const REQUEST_TIMEOUT_MS = 15000;

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

export async function loginForHistory(request: any, username: string, password: string): Promise<void> {
  const loginPage = await request.get(`${BASE_URL}/login`, { timeout: REQUEST_TIMEOUT_MS });
  if (!loginPage.ok() || !((await loginPage.text()).includes('id="loginForm"'))) {
    throw new Error(`Dhlottery login page unavailable (status=${loginPage.status()})`);
  }

  const keyResponse = await request.get(`${BASE_URL}/login/selectRsaModulus.do`, { timeout: REQUEST_TIMEOUT_MS });
  if (!keyResponse.ok()) throw new Error(`Dhlottery login key request failed (status=${keyResponse.status()})`);
  const keyData = (await keyResponse.json() as RsaModulusResponse).data;
  if (!keyData?.rsaModulus || !keyData.publicExponent) {
    throw new Error('Dhlottery login key response is incomplete');
  }

  const loginResponse = await request.post(`${BASE_URL}/login/securityLoginCheck.do`, {
    form: {
      userId: encodeRsa(username, keyData.rsaModulus, keyData.publicExponent),
      userPswdEncn: encodeRsa(password, keyData.rsaModulus, keyData.publicExponent),
      inpUserId: username,
    },
    maxRedirects: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });
  const location = loginResponse.headers().location ?? '';
  if (location.includes('/mbrsrvc/ExpryPswdNoti')) {
    throw new Error('Dhlottery password has expired. Update DHLOTTERY_PASSWORD after changing it on the site.');
  }
  if (loginResponse.status() >= 400) {
    throw new Error(`Dhlottery login request failed (status=${loginResponse.status()})`);
  }

  const ledger = await request.get(`${BASE_URL}/mypage/mylotteryledger`, {
    maxRedirects: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });
  if (ledger.status() !== 200 || !(await ledger.text()).includes('MyLotteryledgerM')) {
    const loginRedirect = location ? new URL(location, BASE_URL).pathname : 'none';
    const ledgerRedirect = ledger.headers().location ? new URL(ledger.headers().location, BASE_URL).pathname : 'none';
    throw new Error(`Dhlottery login did not establish an authenticated purchase-history session (loginStatus=${loginResponse.status()}, loginRedirect=${loginRedirect}, ledgerStatus=${ledger.status()}, ledgerRedirect=${ledgerRedirect})`);
  }
}
