'use client';

import { useState } from 'react';

interface AnalysisResult {
  overall_score: number;
  architecture_score: number;
  readability_score: number;
  performance_score: number;
  summary: string;
  patterns_detected: string[];
  performance_concerns: string[];
  refactoring_suggestions: Array<{
    severity: 'high' | 'medium' | 'low';
    suggestion: string;
  }>;
}

interface HistoryItem {
  id: number;
  timestamp: string;
  score: number;
  preview: string;
}

export default function Home() {
  const [code, setCode] = useState('');
  const [results, setResults] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const analyzeCode = async () => {
    if (!code.trim()) {
      alert('Please paste some code first');
      return;
    }

    if (code.length > 50000) {
      alert('Code too large (max 50KB)');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        throw new Error('Failed to analyze code');
      }

      const data = await res.json();
      setResults(data);

      // Add to history
      setHistory(
        [
          {
            id: Date.now(),
            timestamp: new Date().toLocaleDateString(),
            score: data.overall_score,
            preview: code.substring(0, 50).replace(/\n/g, ' ') + '...',
          },
          ...history,
        ].slice(0, 10),
      ); // Keep only last 10
    } catch (error) {
      alert(
        'Error: ' + (error instanceof Error ? error.message : 'Unknown error'),
      );
    }
    setLoading(false);
  };

  return (
    <div className='min-h-screen bg-gradient-to-br from-gray-50 to-gray-100'>
      <div className='max-w-4xl mx-auto px-4 py-8'>
        {/* Header */}
        <div className='text-center mb-12'>
          <h1 className='text-4xl font-bold text-gray-900 mb-2'>
            Code Quality Dashboard
          </h1>
          <p className='text-gray-600'>Analyze your code using Claude AI</p>
        </div>

        {/* Input Section */}
        <div className='bg-white rounded-lg shadow-lg p-8 mb-8'>
          <h2 className='text-xl font-semibold text-gray-900 mb-4'>
            Paste Your Code
          </h2>

          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder='Paste your code here... (Max 50KB)'
            className='w-full h-64 p-4 border-2 border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:border-blue-500 resize-vertical'
          />

          <button
            onClick={analyzeCode}
            disabled={loading || !code.trim()}
            className='mt-4 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors'
          >
            {loading ? '⏳ Analyzing...' : '▶ Analyze Code'}
          </button>
        </div>

        {/* Results Section */}
        {results && (
          <div className='bg-white rounded-lg shadow-lg p-8 mb-8'>
            <h2 className='text-xl font-semibold text-gray-900 mb-6'>
              Analysis Results
            </h2>

            {/* Overall Score Card */}
            <div className='bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-lg p-8 mb-8'>
              <div className='flex items-center gap-6'>
                <div className='text-center'>
                  <div className='text-5xl font-bold text-blue-600'>
                    {results.overall_score}
                  </div>
                  <div className='text-sm text-blue-800 font-semibold mt-1'>
                    Overall Score
                  </div>
                </div>
                <div className='flex-1'>
                  <p className='text-gray-700 leading-relaxed'>
                    {results.summary}
                  </p>
                </div>
              </div>
            </div>

            {/* Score Breakdown */}
            <div className='grid grid-cols-3 gap-6 mb-8'>
              <ScoreBar
                label='Architecture'
                score={results.architecture_score}
              />
              <ScoreBar label='Readability' score={results.readability_score} />
              <ScoreBar
                label='Performance'
                score={results.performance_score || 0}
              />
            </div>

            {/* Patterns */}
            {results.patterns_detected &&
              results.patterns_detected.length > 0 && (
                <div className='mb-8'>
                  <h3 className='text-lg font-semibold text-gray-900 mb-4'>
                    🎯 Patterns Detected
                  </h3>
                  <div className='bg-gray-50 rounded-lg p-4'>
                    <ul className='space-y-2'>
                      {results.patterns_detected.map((pattern, i) => (
                        <li
                          key={i}
                          className='text-gray-700 flex items-start gap-3'
                        >
                          <span className='text-green-600 font-bold mt-0.5'>
                            ✓
                          </span>
                          {pattern}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

            {/* Performance Concerns */}
            {results.performance_concerns &&
              results.performance_concerns.length > 0 && (
                <div className='mb-8'>
                  <h3 className='text-lg font-semibold text-gray-900 mb-4'>
                    ⚠️ Performance Concerns
                  </h3>
                  <div className='bg-yellow-50 border-l-4 border-yellow-400 rounded-lg p-4'>
                    <ul className='space-y-2'>
                      {results.performance_concerns.map((concern, i) => (
                        <li
                          key={i}
                          className='text-gray-700 flex items-start gap-3'
                        >
                          <span className='text-yellow-600 font-bold mt-0.5'>
                            !
                          </span>
                          {concern}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

            {/* Refactoring Suggestions */}
            {results.refactoring_suggestions &&
              results.refactoring_suggestions.length > 0 && (
                <div>
                  <h3 className='text-lg font-semibold text-gray-900 mb-4'>
                    💡 Refactoring Suggestions
                  </h3>
                  <div className='space-y-3'>
                    {results.refactoring_suggestions.map((suggestion, i) => (
                      <div
                        key={i}
                        className='bg-gray-50 rounded-lg p-4 border-l-4 border-blue-400'
                      >
                        <div className='flex items-start gap-3'>
                          <span
                            className={`px-2 py-1 rounded text-xs font-bold text-white whitespace-nowrap mt-0.5 ${
                              suggestion.severity === 'high'
                                ? 'bg-red-500'
                                : suggestion.severity === 'medium'
                                  ? 'bg-orange-500'
                                  : 'bg-green-500'
                            }`}
                          >
                            {suggestion.severity.toUpperCase()}
                          </span>
                          <span className='text-gray-700'>
                            {suggestion.suggestion}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}

        {/* History Section */}
        {history.length > 0 && (
          <div className='bg-white rounded-lg shadow-lg p-8'>
            <h2 className='text-xl font-semibold text-gray-900 mb-4'>
              📋 Analysis History
            </h2>
            <div className='space-y-2'>
              {history.map((item) => (
                <div
                  key={item.id}
                  className='flex justify-between items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors'
                >
                  <div>
                    <div className='text-sm text-gray-600'>
                      {item.timestamp}
                    </div>
                    <div className='text-xs text-gray-500 truncate'>
                      {item.preview}
                    </div>
                  </div>
                  <div className='text-lg font-bold text-blue-600'>
                    {item.score}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const percentage = (score / 100) * 100;

  return (
    <div>
      <div className='flex justify-between mb-2'>
        <label className='text-sm font-semibold text-gray-700'>{label}</label>
        <span className='text-sm font-bold text-gray-900'>{score}/100</span>
      </div>
      <div className='w-full bg-gray-200 rounded-full h-2'>
        <div
          className='bg-gradient-to-r from-green-400 to-blue-500 h-2 rounded-full transition-all duration-300'
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
