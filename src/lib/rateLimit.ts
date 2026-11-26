interface BucketEntry {
  timestamps: number[];
  lockedUntil: number;
}

const STORAGE_KEY = 'npb_rate_limit_state_v1';
const memoryBuckets = new Map<string, BucketEntry>();

function readBuckets(): Record<string, BucketEntry> {
  const merged: Record<string, BucketEntry> = {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, BucketEntry>;
      if (parsed && typeof parsed === 'object') {
        Object.assign(merged, parsed);
      }
    }
  } catch {
    // ignore storage errors
  }
  memoryBuckets.forEach((v, k) => {
    merged[k] = v;
  });
  return merged;
}

function writeBucket(key: string, entry: BucketEntry): void {
  memoryBuckets.set(key, entry);
  try {
    const all = readBuckets();
    all[key] = entry;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore storage errors
  }
}

export interface RateLimitPolicy {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
}

export const AUTH_RATE_LIMIT: RateLimitPolicy = {
  maxAttempts: 5,
  windowMs: 60_000,
  lockoutMs: 120_000,
};

export const PASSWORD_CHANGE_RATE_LIMIT: RateLimitPolicy = {
  maxAttempts: 5,
  windowMs: 300_000,
  lockoutMs: 300_000,
};

export function assertWithinRateLimit(key: string, policy: RateLimitPolicy): void {
  const now = Date.now();
  const entry = readBuckets()[key] ?? { timestamps: [], lockedUntil: 0 };

  if (entry.lockedUntil > now) {
    const seconds = Math.ceil((entry.lockedUntil - now) / 1000);
    throw new Error(`Too many attempts. Please wait ${seconds} second(s) before trying again.`);
  }

  const recent = entry.timestamps.filter((ts) => now - ts < policy.windowMs);
  if (recent.length >= policy.maxAttempts) {
    const lockedUntil = now + policy.lockoutMs;
    writeBucket(key, { timestamps: recent, lockedUntil });
    const seconds = Math.ceil(policy.lockoutMs / 1000);
    throw new Error(`Too many attempts. Locked for ${seconds} second(s).`);
  }
}

export function recordRateLimitFailure(key: string, policy: RateLimitPolicy): void {
  const now = Date.now();
  const entry = readBuckets()[key] ?? { timestamps: [], lockedUntil: 0 };
  const recent = entry.timestamps.filter((ts) => now - ts < policy.windowMs);
  recent.push(now);
  const lockedUntil = recent.length >= policy.maxAttempts ? now + policy.lockoutMs : 0;
  writeBucket(key, { timestamps: recent, lockedUntil });
}

export function clearRateLimit(key: string): void {
  memoryBuckets.delete(key);
  try {
    const all = readBuckets();
    delete all[key];
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}
