import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { loginForHistory } from '../src/providers/dhlottery/history-login.ts';

function response(status: number, body: unknown, location?: string) {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    text: async () => String(body),
    json: async () => body,
    headers: (): Record<string, string> => location ? { location } : {},
    dispose: async () => undefined,
  };
}

test('history login establishes and verifies an authenticated session without rendering the login page', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const seen: string[] = [];
  let loginPageCalls = 0;
  const request = {
    get: async (url: string) => {
      seen.push(url);
      if (url.endsWith('/login')) {
        loginPageCalls += 1;
        if (loginPageCalls === 1) throw new Error('apiRequestContext.get: Timeout 15000ms exceeded.');
        return response(200, '<form id="loginForm">');
      }
      if (url.endsWith('/login/selectRsaModulus.do')) return response(200, {
        data: {
          rsaModulus: Buffer.from(jwk.n!, 'base64url').toString('hex'),
          publicExponent: Buffer.from(jwk.e!, 'base64url').toString('hex'),
        },
      });
      return response(200, 'MyLotteryledgerM');
    },
    post: async (url: string, options: { form: Record<string, string>; headers: Record<string, string> }) => {
      seen.push(url);
      assert.equal(options.headers.referer, 'https://www.dhlottery.co.kr/login');
      assert.equal(options.form.inpUserId, 'test-user');
      const decrypt = (value: string) => privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(value, 'hex')).toString();
      assert.equal(decrypt(options.form.userId), 'test-user');
      assert.equal(decrypt(options.form.userPswdEncn), 'test-password');
      return response(302, '', '/main');
    },
  };

  await loginForHistory(request, 'test-user', 'test-password');
  assert.equal(loginPageCalls, 2);
  assert.equal(seen.length, 5);
  assert.match(seen.at(-1)!, /mylotteryledger$/);
});

test('history login never replays or leaks the submitted form after a timeout', async () => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  let submissions = 0;
  const request = {
    get: async (url: string) => url.endsWith('/login')
      ? response(200, '<form id="loginForm">')
      : response(200, { data: {
        rsaModulus: Buffer.from(jwk.n!, 'base64url').toString('hex'),
        publicExponent: Buffer.from(jwk.e!, 'base64url').toString('hex'),
      } }),
    post: async () => {
      submissions += 1;
      throw new Error('apiRequestContext.post: Timeout 15000ms exceeded.\nform=private');
    },
  };
  await assert.rejects(loginForHistory(request, 'user', 'password'), (error: Error) => {
    assert.match(error.message, /submission failed: timeout/);
    assert.doesNotMatch(error.message, /form=private/);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(submissions, 1);
});

test('history login rejects an unauthenticated ledger response', async () => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const request = {
    get: async (url: string) => url.endsWith('/login')
      ? response(200, '<form id="loginForm">')
      : url.endsWith('selectRsaModulus.do')
        ? response(200, { data: {
          rsaModulus: Buffer.from(jwk.n!, 'base64url').toString('hex'),
          publicExponent: Buffer.from(jwk.e!, 'base64url').toString('hex'),
        } })
        : response(302, '', '/login'),
    post: async () => response(302, '', '/login'),
  };
  await assert.rejects(loginForHistory(request, 'user', 'password'), /did not establish an authenticated/);
});
