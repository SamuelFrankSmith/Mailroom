export type FrequencyUnit = 'h' | 'd' | 'w' | 'y';

export interface ParsedFrequency {
  amount: number;
  unit: FrequencyUnit;
  raw: string;
}

const FREQ_RE = /^(\d+)([hdwy])$/;

export function parseFrequency(raw: string): ParsedFrequency {
  const match = FREQ_RE.exec(raw.toLowerCase());
  if (!match) throw new Error(`Invalid frequency: "${raw}". Use <number><unit> e.g. 1d, 2w, 3h, 1y`);
  const amount = parseInt(match[1] as string, 10);
  if (amount === 0) throw new Error('Frequency amount must be at least 1');
  return { amount, unit: match[2] as FrequencyUnit, raw: raw.toLowerCase() };
}

export function validateFrequency(raw: string): string | null {
  try {
    parseFrequency(raw);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// Used by the scheduler: advances from the previous next_post_at by one interval (no drift).
export function computeNextPostAt(postTime: string, frequencyRaw: string, fromPostAt: string): string {
  const freq = parseFrequency(frequencyRaw);
  const [hhStr, mmStr] = postTime.split(':');
  const hh = parseInt(hhStr as string, 10);
  const mm = parseInt(mmStr as string, 10);
  const base = new Date(fromPostAt);

  switch (freq.unit) {
    case 'h':
      base.setUTCHours(base.getUTCHours() + freq.amount);
      break;
    case 'd':
      base.setUTCDate(base.getUTCDate() + freq.amount);
      base.setUTCHours(hh, mm, 0, 0);
      break;
    case 'w':
      base.setUTCDate(base.getUTCDate() + freq.amount * 7);
      base.setUTCHours(hh, mm, 0, 0);
      break;
    case 'y':
      base.setUTCFullYear(base.getUTCFullYear() + freq.amount);
      base.setUTCHours(hh, mm, 0, 0);
      break;
  }

  return base.toISOString();
}

// Used by /establish-mailbox: finds the first future occurrence starting from today at HH:mm.
export function computeInitialNextPostAt(postTime: string, frequencyRaw: string, now: string): string {
  const freq = parseFrequency(frequencyRaw);
  const [hhStr, mmStr] = postTime.split(':');
  const hh = parseInt(hhStr as string, 10);
  const mm = parseInt(mmStr as string, 10);
  const nowDate = new Date(now);

  if (freq.unit === 'h') {
    // Start from today at HH:mm, advance by amount hours until future
    const candidate = new Date(nowDate);
    candidate.setUTCHours(hh, mm, 0, 0);
    while (candidate <= nowDate) {
      candidate.setUTCHours(candidate.getUTCHours() + freq.amount);
    }
    return candidate.toISOString();
  }

  // d/w/y: use today at HH:mm if it hasn't passed, otherwise advance by one interval
  const candidate = new Date(nowDate);
  candidate.setUTCHours(hh, mm, 0, 0);

  if (candidate > nowDate) {
    return candidate.toISOString();
  }

  return computeNextPostAt(postTime, frequencyRaw, candidate.toISOString());
}

export function getTodayMMdd(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${month}/${day}`;
}
