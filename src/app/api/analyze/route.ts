import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const MAX_CODE_BYTES = 50_000;
const MAX_TRACKED_CLIENTS = 5_000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 20_000,
});

type RateLimitEntry = {
  count: number;
  resetTime: number;
};

type RefactoringSuggestion = {
  severity: 'high' | 'medium' | 'low';
  suggestion: string;
};

type AnalysisResult = {
  overall_score: number;
  architecture_score: number;
  readability_score: number;
  performance_score: number;
  summary: string;
  patterns_detected: string[];
  performance_concerns: string[];
  refactoring_suggestions: RefactoringSuggestion[];
};

const requestCounts = new Map<string, RateLimitEntry>();

function jsonNoCache(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  );
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  response.headers.set('X-Content-Type-Options', 'nosniff');

  return response;
}

function getRateLimitKey(request: NextRequest): string {
  const xForwardedFor = request.headers.get('x-forwarded-for');
  const xRealIp = request.headers.get('x-real-ip');
  const cfConnectingIp = request.headers.get('cf-connecting-ip');

  const forwardedIp = xForwardedFor?.split(',')[0]?.trim();
  const rawIp = forwardedIp || cfConnectingIp || xRealIp || 'unknown';

  // Bound key length to avoid unbounded memory usage from crafted headers.
  return rawIp.slice(0, 128);
}

function cleanupExpiredRateLimits(now: number): void {
  for (const [key, value] of requestCounts.entries()) {
    if (now > value.resetTime) {
      requestCounts.delete(key);
    }
  }
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(key);

  if (requestCounts.size > MAX_TRACKED_CLIENTS) {
    cleanupExpiredRateLimits(now);
  }

  // Reset or initialize the counter if missing or expired
  if (!entry || now > entry.resetTime) {
    requestCounts.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  // Max 10 requests per minute
  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  entry.count++;
  requestCounts.set(key, entry);
  return true;
}

function isScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isRefactoringSuggestionArray(
  value: unknown,
): value is RefactoringSuggestion[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        'severity' in item &&
        'suggestion' in item &&
        (item.severity === 'high' ||
          item.severity === 'medium' ||
          item.severity === 'low') &&
        typeof item.suggestion === 'string',
    )
  );
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    isScore(candidate.overall_score) &&
    isScore(candidate.architecture_score) &&
    isScore(candidate.readability_score) &&
    isScore(candidate.performance_score) &&
    typeof candidate.summary === 'string' &&
    candidate.summary.trim().length > 0 &&
    isStringArray(candidate.patterns_detected) &&
    isStringArray(candidate.performance_concerns) &&
    isRefactoringSuggestionArray(candidate.refactoring_suggestions)
  );
}

function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const withoutFences = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    : trimmed;

  return JSON.parse(withoutFences);
}

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not configured');
    return jsonNoCache({ error: 'Analysis service is not configured.' }, 500);
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonNoCache(
      { error: 'Content-Type must be application/json.' },
      415,
    );
  }

  const rateLimitKey = getRateLimitKey(request);
  if (!checkRateLimit(rateLimitKey)) {
    return jsonNoCache(
      {
        error: `Rate limit exceeded. Max ${MAX_REQUESTS_PER_WINDOW} requests per minute.`,
      },
      429,
    );
  }

  try {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonNoCache({ error: 'Invalid JSON payload.' }, 400);
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonNoCache({ error: 'Request body must be a JSON object.' }, 400);
    }

    const { code } = payload as { code?: unknown };

    // Validation
    if (typeof code !== 'string') {
      return jsonNoCache({ error: '"code" must be a string.' }, 400);
    }

    const trimmedCode = code.trim();
    if (!trimmedCode) {
      return jsonNoCache({ error: 'No code provided.' }, 400);
    }

    const codeByteLength = new TextEncoder().encode(trimmedCode).length;
    if (codeByteLength > MAX_CODE_BYTES) {
      return jsonNoCache(
        { error: `Code too large (max ${MAX_CODE_BYTES / 1000}KB).` },
        400,
      );
    }

    // Create the prompt
    const prompt = `You are a code quality analyzer. Analyze the following code and return ONLY valid JSON. No markdown, no explanation, no extra text. Just pure JSON.

Code to analyze:
\`\`\`
${trimmedCode}
\`\`\`

Return ONLY this JSON structure (no additional text before or after):
{
  "overall_score": <number 0-100>,
  "architecture_score": <number 0-100>,
  "readability_score": <number 0-100>,
  "performance_score": <number 0-100>,
  "summary": "<one sentence summary>",
  "patterns_detected": ["<pattern1>", "<pattern2>", "<pattern3>"],
  "performance_concerns": ["<concern1>", "<concern2>"],
  "refactoring_suggestions": [
    { "severity": "high|medium|low", "suggestion": "<suggestion text>" },
    { "severity": "high|medium|low", "suggestion": "<suggestion text>" }
  ]
}`;

    // Call OpenAI API
    const message = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text from response
    const responseText = message.choices[0]?.message?.content;
    if (!responseText || typeof responseText !== 'string') {
      return jsonNoCache(
        { error: 'Analysis service returned an empty response.' },
        502,
      );
    }

    // Parse JSON response
    let results: unknown;
    try {
      results = parseModelJson(responseText);
    } catch {
      console.error('Failed to parse model response JSON');
      return jsonNoCache(
        { error: 'Analysis service returned an invalid format.' },
        502,
      );
    }

    // Validate response structure
    if (!isAnalysisResult(results)) {
      return jsonNoCache(
        { error: 'Analysis service returned an unexpected structure.' },
        502,
      );
    }

    return jsonNoCache(results, 200);
  } catch (error) {
    console.error('Analysis error:', error);

    if (error instanceof OpenAI.APIError) {
      if (error.status === 401 || error.status === 403) {
        return jsonNoCache(
          { error: 'Analysis service authentication failed.' },
          502,
        );
      }

      if (error.status === 429) {
        return jsonNoCache(
          { error: 'Analysis service is busy. Try again shortly.' },
          503,
        );
      }

      if (typeof error.status === 'number' && error.status >= 500) {
        return jsonNoCache(
          { error: 'Analysis service temporarily unavailable.' },
          503,
        );
      }
    }

    if (error instanceof Error && error.name === 'AbortError') {
      return jsonNoCache(
        { error: 'Analysis request timed out. Try again.' },
        504,
      );
    }

    return jsonNoCache({ error: 'Failed to analyze code.' }, 500);
  }
}
