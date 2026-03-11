import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
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

    // Call Claude API
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text from response
    const responseText =
      message.content[0].type === 'text' ? message.content[0].text : '';

    // Parse JSON response
    let results;
    try {
      results = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', responseText);
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

    if (errorMessage.includes('authentication')) {
      return NextResponse.json(
        { error: 'Claude API key not configured' },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to analyze code: ' + errorMessage },
      { status: 500 },
    );
  }
}
