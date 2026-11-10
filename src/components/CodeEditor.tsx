import React, { useState } from 'react';
import {
  Play,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  HardDrive,
  RotateCcw,
  Sparkles,
  Terminal,
  Code2,
  ChevronDown,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { SAMPLE_CODING_PROBLEMS } from '../data/assessmentData';
import { executeCodeOnServer } from '../services/api';
import { CodingProblem } from '../types';

interface CodeEditorProps {
  initialProblem?: CodingProblem;
  onSolve?: (score: number) => void;
  standalone?: boolean;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  initialProblem = SAMPLE_CODING_PROBLEMS.twoSum,
  onSolve,
  standalone = true,
}) => {
  const [selectedProblemKey, setSelectedProblemKey] = useState<string>('twoSum');
  const problem = standalone ? SAMPLE_CODING_PROBLEMS[selectedProblemKey] || initialProblem : initialProblem;

  const [language, setLanguage] = useState<'python' | 'javascript' | 'java' | 'cpp' | 'c'>('python');
  const [code, setCode] = useState<string>(problem.templates.python);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'testcases' | 'terminal'>('testcases');
  const [customInput, setCustomInput] = useState<string>('');
  const [useCustomInput, setUseCustomInput] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [executionError, setExecutionError] = useState('');

  // Switch problem
  const handleProblemChange = (key: string) => {
    setSelectedProblemKey(key);
    const newProblem = SAMPLE_CODING_PROBLEMS[key];
    if (newProblem) {
      setCode(newProblem.templates[language] || newProblem.templates.python);
      setExecutionResult(null);
    }
  };

  // Switch language
  const handleLanguageChange = (newLang: 'python' | 'javascript' | 'java' | 'cpp' | 'c') => {
    setLanguage(newLang);
    setCode(problem.templates[newLang] || '');
  };

  // Reset code to template
  const handleReset = () => {
    setCode(problem.templates[language] || '');
    setExecutionResult(null);
  };

  // Run Code on sample test cases
  const handleRunCode = async () => {
    setIsRunning(true);
    setExecutionError('');
    setActiveTab('terminal');
    try {
      const visibleCases = problem.testCases.filter((tc) => !tc.hidden);
      const res = await executeCodeOnServer({
        code,
        language,
        input: useCustomInput ? customInput : undefined,
        testCases: visibleCases,
      });
      setExecutionResult(res);
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : 'Code execution failed.');
    } finally {
      setIsRunning(false);
    }
  };

  // Submit Code on full test suite (including hidden test cases)
  const handleSubmitCode = async () => {
    setIsSubmitting(true);
    setExecutionError('');
    setActiveTab('terminal');
    try {
      const res = await executeCodeOnServer({
        code,
        language,
        testCases: problem.testCases,
      });
      setExecutionResult(res);
      if (onSolve) {
        onSolve(res.score);
      }
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : 'Submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      {standalone && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                <Code2 className="w-5 h-5" />
              </span>
              <div>
                <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                  Interactive Multi-Language Coding Sandbox
                </h1>
                <p className="text-xs text-slate-500">
                  Practice company-specific DSA problems with real-time test case verification.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Select Problem:</span>
            <select
              id="sandbox-problem-selector"
              value={selectedProblemKey}
              onChange={(e) => handleProblemChange(e.target.value)}
              className="text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="twoSum">Two Sum - Arrays & Hashing</option>
              <option value="longestSubstring">Longest Substring Without Repeating - Sliding Window</option>
              <option value="subarraySumK">Subarray Sum Equals K - Prefix Sum</option>
            </select>
          </div>
        </div>
      )}

      {executionError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{executionError}</p>}

      {/* Editor & Problem Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Col: Problem Description & Constraints (5 Cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 space-y-4 overflow-y-auto max-h-[700px]">
          <div className="flex items-center justify-between">
            <span
              className={`text-[10px] font-extrabold px-2.5 py-1 rounded-md ${
                problem.difficulty === 'Easy'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : problem.difficulty === 'Medium'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
              }`}
            >
              {problem.difficulty}
            </span>
            <span className="text-xs font-semibold text-slate-400">{problem.category}</span>
          </div>

          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">{problem.title}</h2>
            <div className="mt-2 text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed font-sans">
              {problem.description}
            </div>
          </div>

          {/* Examples */}
          <div className="space-y-3 pt-2">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Examples
            </h3>
            {problem.examples.map((ex, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1 font-mono text-xs"
              >
                <div>
                  <span className="text-slate-400 font-sans font-bold">Input: </span>
                  <span className="text-slate-800 dark:text-slate-200">{ex.input}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-sans font-bold">Output: </span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{ex.output}</span>
                </div>
                {ex.explanation && (
                  <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400 pt-1">
                    <span className="font-semibold">Explanation: </span>
                    {ex.explanation}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Constraints */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Constraints
            </h3>
            <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 font-mono">
              {problem.constraints.map((c, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <span className="text-indigo-500">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right Col: Code Editor + Output Panel (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-4">
          {/* Editor Header Bar */}
          <div className="bg-slate-900 text-white rounded-t-2xl px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
            {/* Language Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium hidden sm:inline">Language:</span>
              <select
                id="code-language-select"
                value={language}
                onChange={(e) => handleLanguageChange(e.target.value as any)}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="python">Python 3</option>
                <option value="javascript">JavaScript (Node.js)</option>
                <option value="java">Java 17</option>
                <option value="cpp">C++ (GCC 11)</option>
                <option value="c">C (GCC)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Reset to starter template"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Code Textarea Area */}
          <div className="relative bg-slate-950 text-slate-100 font-mono text-xs rounded-b-2xl border border-slate-800 overflow-hidden shadow-inner flex-1 flex flex-col">
            <textarea
              id="code-editor-textarea"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full min-h-[300px] p-4 bg-transparent resize-y text-slate-100 font-mono text-xs leading-relaxed focus:outline-none border-none selection:bg-indigo-500/40"
              spellCheck={false}
              placeholder="// Write your solution here..."
            />

            {/* Bottom Action Footer */}
            <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomInput}
                    onChange={(e) => setUseCustomInput(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Custom Test Input</span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="run-code-btn"
                  onClick={handleRunCode}
                  disabled={isRunning || isSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{isRunning ? 'Running...' : 'Run Code'}</span>
                </button>

                <button
                  id="submit-code-btn"
                  onClick={handleSubmitCode}
                  disabled={isRunning || isSubmitting}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Evaluating...' : 'Submit Solution'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Custom Input Field if toggled */}
          {useCustomInput && (
            <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Custom Stdin Input:
              </label>
              <textarea
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="e.g. nums = [2,7,11,15], target = 9"
                rows={2}
                className="w-full text-xs font-mono p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
              />
            </div>
          )}

          {/* Output & Test Cases Tab Container */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="flex items-center border-b border-slate-200 dark:border-slate-800 px-4 pt-2 gap-4">
              <button
                onClick={() => setActiveTab('testcases')}
                className={`pb-2 text-xs font-bold border-b-2 transition-colors ${
                  activeTab === 'testcases'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Sample Test Cases
              </button>
              <button
                onClick={() => setActiveTab('terminal')}
                className={`pb-2 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 ${
                  activeTab === 'terminal'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Execution Verdict & Metrics</span>
                {executionResult && (
                  <span
                    className={`w-2 h-2 rounded-full ${
                      executionResult.success ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                  />
                )}
              </button>
            </div>

            <div className="p-4">
              {activeTab === 'testcases' ? (
                <div className="space-y-2">
                  {problem.testCases
                    .filter((tc) => !tc.hidden)
                    .map((tc, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs font-mono"
                      >
                        <div>
                          <span className="text-slate-400 font-sans font-semibold">Case {idx + 1}: </span>
                          <span className="text-slate-800 dark:text-slate-200">{tc.input}</span>
                        </div>
                        <div className="text-emerald-600 dark:text-emerald-400 font-bold">
                          Expected: {tc.expected}
                        </div>
                      </div>
                    ))}
                  <p className="text-[11px] text-slate-400 pt-1 font-sans">
                    + {problem.testCases.filter((tc) => tc.hidden).length} Hidden Stress Test Cases verified upon Submit.
                  </p>
                </div>
              ) : (
                <div>
                  {!executionResult ? (
                    <div className="text-center py-6 text-xs text-slate-400 font-mono">
                      Run or Submit code to see execution stdout, test verdicts, time & memory benchmarks.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Verdict Banner */}
                      <div
                        className={`p-3 rounded-xl flex items-center justify-between ${
                          executionResult.success
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {executionResult.success ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                          )}
                          <div>
                            <p className="text-xs font-extrabold">
                              {executionResult.success ? 'Accepted - All Test Cases Passed!' : 'Wrong Answer / Runtime Exception'}
                            </p>
                            <p className="text-[11px] opacity-90">
                              Score: {executionResult.score}% ({executionResult.passedTestCases}/{executionResult.totalTestCases} Test Cases Passed)
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-xs font-mono">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{executionResult.executionTimeMs} ms</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <HardDrive className="w-3.5 h-3.5" />
                            <span>{Math.round(executionResult.memoryKb / 1024)} MB</span>
                          </div>
                        </div>
                      </div>

                      {/* Detailed test case result rows */}
                      <div className="space-y-1.5">
                        {executionResult.results?.map((res: any, idx: number) => (
                          <div
                            key={idx}
                            className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs font-mono"
                          >
                            <div className="flex items-center gap-2">
                              {res.passed ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-rose-500" />
                              )}
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                Test Case #{res.testCaseId} {res.hidden && '(Hidden)'}
                              </span>
                            </div>

                            <div className="flex items-center gap-3 text-[11px]">
                              <span>{res.executionTimeMs} ms</span>
                              <span
                                className={`font-bold ${
                                  res.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                                }`}
                              >
                                {res.passed ? 'Passed' : 'Failed'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
