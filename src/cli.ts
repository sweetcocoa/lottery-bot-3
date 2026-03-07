import { runBuyCommand } from './commands/buy.ts';
import { runSummarizeCommand } from './commands/summarize.ts';

interface ParsedArgs {
  command?: string;
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (const token of rest) {
    if (!token.startsWith('--')) continue;
    const [key, value = 'true'] = token.slice(2).split('=', 2);
    flags[key] = value;
  }
  return { command, flags };
}

function printHelp(): void {
  console.log(`Usage:
  node --experimental-strip-types src/cli.ts buy --mode=dry-run|smoke|live [--provider=mock|browser] [--force=true|false] [--seed=value] [--target-week=YYYY-Www]
  node --experimental-strip-types src/cli.ts summarize --mode=dry-run|live [--artifact-source=github|local-fixture] [--target-week=YYYY-Www]`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv);
  if (!command || command === '--help' || flags.help === 'true') {
    printHelp();
    return;
  }

  if (command === 'buy') {
    await runBuyCommand({
      mode: (flags.mode as 'dry-run' | 'smoke' | 'live') ?? 'dry-run',
      provider: flags.provider as 'mock' | 'browser' | undefined,
      force: flags.force === 'true',
      seed: flags.seed,
      targetWeek: flags['target-week'],
    });
    return;
  }

  if (command === 'summarize') {
    await runSummarizeCommand({
      mode: (flags.mode as 'dry-run' | 'live') ?? 'dry-run',
      artifactSource: flags['artifact-source'] as 'github' | 'local-fixture' | undefined,
      targetWeek: flags['target-week'],
    });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
