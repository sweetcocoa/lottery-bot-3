import { readFile } from 'node:fs/promises';

export type LottoMode = 'fixed' | 'random_same' | 'random_distinct';
export type PensionMode = 'fixed' | 'random';

export interface AppConfig {
  lotto: {
    mode: LottoMode;
    count: number;
    fixed_numbers?: number[];
  };
  pension: {
    mode: PensionMode;
    count: 1;
    fixed?: {
      group: number;
      number: string;
    };
  };
  notifications: {
    single_chat: boolean;
    dry_run_prefix: string;
    live_prefix: string;
  };
}

type YamlValue = string | number | boolean | YamlMap | YamlValue[];
interface YamlMap {
  [key: string]: YamlValue;
}

function parseScalar(raw: string): YamlValue {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseScalar(item.trim()));
  }
  return trimmed;
}

export function parseSimpleYaml(content: string): YamlMap {
  const root: YamlMap = {};
  const stack: Array<{ indent: number; value: YamlMap }> = [{ indent: -1, value: root }];

  for (const originalLine of content.split(/\r?\n/)) {
    const line = originalLine.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const match = line.trim().match(/^([^:]+):(.*)$/);
    if (!match) {
      throw new Error(`Unsupported YAML line: ${originalLine}`);
    }
    const [, key, remainder] = match;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const current = stack[stack.length - 1].value;
    if (!remainder.trim()) {
      const child: YamlMap = {};
      current[key.trim()] = child;
      stack.push({ indent, value: child });
      continue;
    }
    current[key.trim()] = parseScalar(remainder.trim());
  }

  return root;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function asNumberArray(value: YamlValue | undefined, label: string): number[] | undefined {
  if (value === undefined) return undefined;
  assert(Array.isArray(value), `${label} must be an array`);
  const numbers = value.map((item) => {
    assert(typeof item === 'number', `${label} entries must be numbers`);
    return item;
  });
  return numbers;
}

export function validateConfig(value: YamlMap): AppConfig {
  const lotto = value.lotto as YamlMap | undefined;
  const pension = value.pension as YamlMap | undefined;
  const notifications = value.notifications as YamlMap | undefined;

  assert(lotto && typeof lotto === 'object', 'lotto config is required');
  assert(pension && typeof pension === 'object', 'pension config is required');
  assert(notifications && typeof notifications === 'object', 'notifications config is required');

  const lottoMode = lotto.mode;
  assert(lottoMode === 'fixed' || lottoMode === 'random_same' || lottoMode === 'random_distinct', 'lotto.mode is invalid');
  const lottoCount = lotto.count;
  assert(typeof lottoCount === 'number' && lottoCount >= 1, 'lotto.count must be >= 1');
  const fixedNumbers = asNumberArray(lotto.fixed_numbers, 'lotto.fixed_numbers');
  if (lottoMode === 'fixed') {
    assert(fixedNumbers, 'lotto.fixed_numbers is required for fixed mode');
    assert(fixedNumbers.length === 6, 'lotto.fixed_numbers must contain 6 numbers');
    const unique = new Set(fixedNumbers);
    assert(unique.size === 6, 'lotto.fixed_numbers must be unique');
    for (const n of fixedNumbers) {
      assert(Number.isInteger(n) && n >= 1 && n <= 45, 'lotto.fixed_numbers must be integers between 1 and 45');
    }
  }

  const pensionMode = pension.mode;
  assert(pensionMode === 'fixed' || pensionMode === 'random', 'pension.mode is invalid');
  assert(pension.count === 1, 'pension.count must be 1');
  const fixed = pension.fixed as YamlMap | undefined;
  if (pensionMode === 'fixed') {
    assert(fixed && typeof fixed === 'object', 'pension.fixed is required for fixed mode');
    assert(typeof fixed.group === 'number' && fixed.group >= 1 && fixed.group <= 5, 'pension.fixed.group must be 1..5');
    assert(typeof fixed.number === 'string' && /^\d{6}$/.test(fixed.number), 'pension.fixed.number must be a 6 digit string');
  }

  assert(notifications.single_chat === true || notifications.single_chat === false, 'notifications.single_chat must be a boolean');
  assert(typeof notifications.dry_run_prefix === 'string' && notifications.dry_run_prefix.length > 0, 'notifications.dry_run_prefix is required');
  assert(typeof notifications.live_prefix === 'string' && notifications.live_prefix.length > 0, 'notifications.live_prefix is required');

  return {
    lotto: {
      mode: lottoMode,
      count: lottoCount,
      fixed_numbers: fixedNumbers,
    },
    pension: {
      mode: pensionMode,
      count: 1,
      fixed: fixed && typeof fixed === 'object' ? {
        group: fixed.group as number,
        number: fixed.number as string,
      } : undefined,
    },
    notifications: {
      single_chat: notifications.single_chat as boolean,
      dry_run_prefix: notifications.dry_run_prefix as string,
      live_prefix: notifications.live_prefix as string,
    },
  };
}

export async function loadConfig(configPath = 'config/picks.yaml'): Promise<AppConfig> {
  const content = await readFile(configPath, 'utf8');
  return validateConfig(parseSimpleYaml(content));
}
