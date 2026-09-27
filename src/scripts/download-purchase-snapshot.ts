import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir } from 'node:fs/promises';
import { getIsoWeek } from '../core/draw-calendar.ts';
import { loadPurchaseSnapshot } from '../core/purchase-snapshot.ts';

const run = promisify(execFile);
const repository = process.env.GITHUB_REPOSITORY;
const week = getIsoWeek();

if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  throw new Error('GITHUB_REPOSITORY is required to find the purchase snapshot');
}

try {
  const { stdout } = await run('gh', ['api', `repos/${repository}/actions/workflows/buy.yml/runs?status=completed&per_page=50`]);
  const payload = JSON.parse(stdout) as { workflow_runs?: Array<{ id: number; created_at: string }> };
  const candidates = (payload.workflow_runs ?? [])
    .filter((item) => Number.isInteger(item.id) && getIsoWeek(new Date(item.created_at)) === week)
    .sort((a, b) => b.id - a.id);

  let found = false;
  for (const candidate of candidates) {
    const { stdout: artifactOutput } = await run('gh', ['api', `repos/${repository}/actions/runs/${candidate.id}/artifacts`]);
    const artifacts = JSON.parse(artifactOutput) as { artifacts?: Array<{ name: string; expired: boolean }> };
    if (!artifacts.artifacts?.some((item) => item.name === `purchase-record-${candidate.id}` && !item.expired)) continue;

    try {
      const candidatePath = `artifacts/snapshot-candidates/${candidate.id}/purchase-record.json`;
      await mkdir(`artifacts/snapshot-candidates/${candidate.id}`, { recursive: true });
      await run('gh', ['run', 'download', String(candidate.id), '--name', `purchase-record-${candidate.id}`, '--dir', `artifacts/snapshot-candidates/${candidate.id}`]);
      await loadPurchaseSnapshot(week, candidatePath);
      await mkdir('artifacts/snapshot', { recursive: true });
      await copyFile(candidatePath, 'artifacts/snapshot/purchase-record.json');
      console.log(`Downloaded confirmed purchase snapshot for ${week} from run ${candidate.id}`);
      found = true;
      break;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping purchase snapshot from run ${candidate.id}: ${reason}`);
    }
  }

  if (!found) console.log(`No confirmed purchase snapshot found for ${week}`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`Purchase snapshot lookup failed; history will still be attempted: ${reason}`);
}
