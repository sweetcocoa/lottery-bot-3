export function ledgerPageInfo(value: unknown, status: number): { rowCount: number; total: number } {
  if (status !== 200) throw new Error(`Purchase history search returned HTTP ${status}`);
  if (!value || typeof value !== 'object') throw new Error('Purchase history search returned an invalid response');
  const payload = value as { resultCode?: unknown; resultMessage?: unknown; data?: { list?: unknown; total?: unknown } };
  if (payload.resultCode) {
    throw new Error(`Purchase history search rejected: ${String(payload.resultCode)} ${String(payload.resultMessage ?? '').slice(0, 200)}`);
  }
  if (!Array.isArray(payload.data?.list)) {
    throw new Error('Purchase history search response does not contain a ticket list');
  }
  if (payload.data.total === null || payload.data.total === '' || payload.data.total === undefined) {
    throw new Error('Purchase history search response contains an invalid total count');
  }
  const total = Number(payload.data.total);
  if (!Number.isInteger(total) || total < payload.data.list.length) {
    throw new Error('Purchase history search response contains an invalid total count');
  }
  return { rowCount: payload.data.list.length, total };
}

export async function collectLedgerPages<T>(
  firstPage: { rows: T[]; total: number },
  loadPage: (pageNumber: number) => Promise<{ rows: T[]; total: number }>,
): Promise<T[]> {
  const rows = [...firstPage.rows];
  const pages = Math.ceil(firstPage.total / 10);
  if (pages > 100) throw new Error('Purchase history contains too many pages for a safe buy preflight');
  for (let pageNumber = 2; pageNumber <= pages; pageNumber += 1) {
    const nextPage = await loadPage(pageNumber);
    if (nextPage.total !== firstPage.total) throw new Error('Purchase history changed during buy preflight; retry the read-only check');
    rows.push(...nextPage.rows);
  }
  if (rows.length !== firstPage.total) throw new Error('Purchase history pagination did not return every row');
  return rows;
}
