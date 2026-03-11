import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const requestCounts: { [key: string]: { count: number; resetTime: number } } =
  {};

function getRateLimitKey(request: NextRequest): string {
  return request.headers.get('x-forwarded-for') || 'unknown';
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = requestCounts[key];

  // Reset or initialize the counter if missing or expired
  if (!entry || now > entry.resetTime) {
    requestCounts[key] = { count: 1, resetTime: now + 60_000 }; // 1 minute
    return true;
  }

  // Max 10 requests per minute
  if (entry.count >= 10) {
    return false;
  }

  entry.count++;
  return true;
}

export async function POST(request: NextRequest) {
  const rateLimitKey = getRateLimitKey(request);
  if (!checkRateLimit(rateLimitKey)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Max 10 requests per minute.' },
      { status: 429 },
    );
  }

  try {
    const { code } = await request.json();

    // Validation
    if (!code || code.length === 0) {
      return NextResponse.json({ error: 'No code provided' }, { status: 400 });
    }

    if (code.length > 50000) {
      return NextResponse.json(
        { error: 'Code too large (max 50KB)' },
        { status: 400 },
      );
    }

    // Create the prompt
    const prompt = `You are a code quality analyzer. Analyze the following code and return ONLY valid JSON. No markdown, no explanation, no extra text. Just pure JSON.

Code to analyze:
\`\`\`
${code}
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
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text from response
    const responseText = message.choices[0].message.content || '';

    // Parse JSON response
    let results;
    try {
      results = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', responseText);
      return NextResponse.json(
        { error: 'Failed to parse analysis results' },
        { status: 500 },
      );
    }

    // Validate response structure
    if (!results.overall_score || !results.architecture_score) {
      return NextResponse.json(
        { error: 'Invalid analysis response structure' },
        { status: 500 },
      );
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('Analysis error:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    if (
      errorMessage.includes('authentication') ||
      errorMessage.includes('401')
    ) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured or invalid' },
        { status: 401 },
      );
    }

    if (errorMessage.includes('insufficient_quota')) {
      return NextResponse.json(
        { error: 'OpenAI account has insufficient quota. Add payment method.' },
        { status: 402 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to analyze code: ' + errorMessage },
      { status: 500 },
    );
  }
}
