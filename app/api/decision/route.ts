import { NextResponse, type NextRequest } from "next/server";
import { runJevDecision } from "../../../lib/playground/customDecision";
import { DecisionRequestSchema } from "../../../lib/playground/schema";
import { checkAndIncrementGlobalDailyCap, checkVisitorRateLimit } from "../../../lib/rateLimit";

export const runtime = "nodejs";

/** Section 14's exact error copy. */
const ERROR_MESSAGES = {
  visitor_hourly: "You reached the live run limit. Recorded scenarios still work.",
  visitor_daily: "You reached the live run limit. Recorded scenarios still work.",
  global_daily: "Demo paused for today, recorded scenarios still work.",
  missing_config: "A configuration error occurred. No real payment was attempted.",
  invalid_body: "Some of the values submitted were outside the allowed range.",
};

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: ERROR_MESSAGES.missing_config }, { status: 500 });
  }

  const ip = getClientIp(req);
  const visitorCheck = await checkVisitorRateLimit(ip);
  if (!visitorCheck.allowed) {
    return NextResponse.json({ error: ERROR_MESSAGES[visitorCheck.reason!] }, { status: 429 });
  }
  const globalCheck = await checkAndIncrementGlobalDailyCap();
  if (!globalCheck.allowed) {
    return NextResponse.json({ error: ERROR_MESSAGES.global_daily }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: ERROR_MESSAGES.invalid_body }, { status: 400 });
  }

  const parsed = DecisionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: ERROR_MESSAGES.invalid_body, details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await runJevDecision({
    transactionInput: parsed.data.transaction,
    pspInputs: parsed.data.psps,
    apiKey,
    allowLive: true,
  });

  return NextResponse.json(result);
}
