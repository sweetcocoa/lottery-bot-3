import { request } from 'playwright';
import { loginForHistory } from '../providers/dhlottery/history-login.ts';

const username = process.env.DHLOTTERY_USERNAME;
const password = process.env.DHLOTTERY_PASSWORD;
if (!username || !password) throw new Error('Missing history credentials');
const session = await request.newContext({
  baseURL: 'https://www.dhlottery.co.kr',
  extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  timeout: 15000,
});
const headers = { AJAX: 'true', requestMenuUri: '/mypage/mylotteryledger', referer: 'https://www.dhlottery.co.kr/mypage/mylotteryledger' };

function shape(value: unknown, depth = 0): unknown {
  if (depth > 5) return typeof value;
  if (Array.isArray(value)) return { size: value.length, first: shape(value[0], depth + 1) };
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item, depth + 1)]));
  if (typeof value === 'string') return { type: 'string', pattern: value.replace(/[0-9]/g, '0').replace(/\p{L}/gu, 'x') };
  return value === null ? null : typeof value;
}

try {
  await loginForHistory(session, username, password);
  const params = { srchStrDt: '20261026', srchEndDt: '20261108', sort: '', ltGdsCd: '', winResult: '', lramSmam: '', pageNum: '1', recordCountPerPage: '10' };
  const listResponse = await session.get('/mypage/selectMyLotteryledger.do', { params, headers });
  if (!listResponse.ok()) throw new Error(`History list returned HTTP ${listResponse.status()}`);
  const list = await listResponse.json();
  const row = list.data?.list?.find((row: any) => row.ltGdsCd === 'LO40');
  console.log(JSON.stringify({ listStatus: listResponse.status(), resultCode: list.resultCode, totalType: typeof list.data?.total, foundLotto: !!row }));
  if (!row) throw new Error('No lotto row found');
  const detailResponse = await session.get('/mypage/lotto645TicketDetail.do', { headers, params: {
    ntslOrdrNo: row.ntslOrdrNo, barcd: row.gmInfo, srchStrDt: params.srchStrDt, srchEndDt: params.srchEndDt,
  } }).catch(() => { throw new Error('Read-only ticket detail request failed'); });
  if (!detailResponse.ok()) throw new Error(`Ticket details returned HTTP ${detailResponse.status()}`);
  const detail = await detailResponse.json();
  console.log(JSON.stringify({ detailStatus: detailResponse.status(), resultCode: detail.resultCode, success: detail.data?.success, shape: shape(detail.data?.ticket) }));
} finally {
  await session.dispose();
}
