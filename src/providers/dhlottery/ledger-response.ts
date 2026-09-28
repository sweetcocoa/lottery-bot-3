export function ledgerRowCount(value: unknown, status: number): number {
  if (status !== 200) throw new Error(`Purchase history search returned HTTP ${status}`);
  if (!value || typeof value !== 'object') throw new Error('Purchase history search returned an invalid response');
  const payload = value as { resultCode?: unknown; resultMessage?: unknown; data?: { list?: unknown } };
  if (payload.resultCode) {
    throw new Error(`Purchase history search rejected: ${String(payload.resultCode)} ${String(payload.resultMessage ?? '').slice(0, 200)}`);
  }
  if (!Array.isArray(payload.data?.list)) {
    throw new Error('Purchase history search response does not contain a ticket list');
  }
  return payload.data.list.length;
}
