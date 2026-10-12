import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Section 10.3: per-visitor limit (~10 live runs/hour, 30/day) and a global daily cap, backed
 * by Upstash Redis in production. Falls back to an in-memory counter when Upstash isn't
 * configured (local dev), so the API route works out of the box without external setup —
 * but that fallback resets on every server restart and doesn't share state across instances,
 * so it is not a substitute for Upstash in a real deployment.
 */

const upstashConfigured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

const redis = upstashConfigured ? Redis.fromEnv() : null;

const hourlyLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 h"), prefix: "pdl:hourly" })
  : null;
const dailyLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, "1 d"), prefix: "pdl:daily" })
  : null;

// In-memory fallback state (local dev only).
const memoryHourly = new Map<string, number[]>();
const memoryDaily = new Map<string, number[]>();
let memoryGlobalDailyCount = 0;
let memoryGlobalDailyDay = currentUtcDay();

function currentUtcDay(): number {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
}

function pruneAndCount(timestamps: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: "visitor_hourly" | "visitor_daily" | "global_daily";
}

const GLOBAL_DAILY_CAP = Number(process.env.GLOBAL_DAILY_CAP ?? 500);

/** Visitor-level limits (section 10.3: ~10/hour, 30/day per IP). */
export async function checkVisitorRateLimit(ip: string): Promise<RateLimitResult> {
  if (hourlyLimiter && dailyLimiter) {
    const hourly = await hourlyLimiter.limit(ip);
    if (!hourly.success) return { allowed: false, reason: "visitor_hourly" };
    const daily = await dailyLimiter.limit(ip);
    if (!daily.success) return { allowed: false, reason: "visitor_daily" };
    return { allowed: true };
  }

  const hourTimestamps = pruneAndCount(memoryHourly.get(ip) ?? [], 60 * 60 * 1000);
  if (hourTimestamps.length >= 10) {
    memoryHourly.set(ip, hourTimestamps);
    return { allowed: false, reason: "visitor_hourly" };
  }
  const dayTimestamps = pruneAndCount(memoryDaily.get(ip) ?? [], 24 * 60 * 60 * 1000);
  if (dayTimestamps.length >= 30) {
    memoryDaily.set(ip, dayTimestamps);
    return { allowed: false, reason: "visitor_daily" };
  }

  const now = Date.now();
  hourTimestamps.push(now);
  dayTimestamps.push(now);
  memoryHourly.set(ip, hourTimestamps);
  memoryDaily.set(ip, dayTimestamps);
  return { allowed: true };
}

/** Global daily cap (section 10.3), counted by call count (simpler than reading OpenRouter usage data). */
export async function checkAndIncrementGlobalDailyCap(): Promise<RateLimitResult> {
  if (redis) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `pdl:global-daily:${day}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60 * 60 * 25);
    if (count > GLOBAL_DAILY_CAP) return { allowed: false, reason: "global_daily" };
    return { allowed: true };
  }

  const today = currentUtcDay();
  if (today !== memoryGlobalDailyDay) {
    memoryGlobalDailyDay = today;
    memoryGlobalDailyCount = 0;
  }
  memoryGlobalDailyCount++;
  if (memoryGlobalDailyCount > GLOBAL_DAILY_CAP) return { allowed: false, reason: "global_daily" };
  return { allowed: true };
}

export function isUpstashConfigured(): boolean {
  return upstashConfigured;
}
