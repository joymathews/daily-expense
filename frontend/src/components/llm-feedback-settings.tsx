import React, { useState, useEffect, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

interface FeedbackSettings {
  isEnabled: boolean;
  maxExamples: number;
  similarityThreshold: number;
}

interface CorrectionExample {
  id: string;
  userId: string;
  bronzeInputId: string;
  fieldName: 'merchant' | 'category' | 'paymentMethod' | 'transactionType';
  llmValue: string | null;
  correctedValue: string;
  emailSnippet: string | null;
  createdAt: string;
}

interface FieldAccuracySnapshot {
  merchantAccuracy: number;
  categoryAccuracy: number;
  paymentMethodAccuracy: number;
  totalRecords: number;
}

interface WeeklyAccuracyEntry {
  week: string;
  merchantAccuracy: number;
  categoryAccuracy: number;
  paymentMethodAccuracy: number;
  totalRecords: number;
}

interface FeedbackEffectiveness {
  weeklyTrend: WeeklyAccuracyEntry[];
  beforeAfter: {
    cutoffDate: string | null;
    before: FieldAccuracySnapshot | null;
    after: FieldAccuracySnapshot | null;
  };
  coverage: {
    totalExamples: number;
    byField: Record<string, number>;
    historicalMissesByField: Record<string, number>;
  };
}

const FIELD_LABELS: Record<string, string> = {
  merchant: 'Merchant',
  category: 'Category',
  paymentMethod: 'Payment Method',
  transactionType: 'Transaction Type',
};

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

/**
 * [FUNC-FEEDBACK-2, FUNC-FEEDBACK-3, FUNC-FEEDBACK-4]
 * Self-contained settings panel for the LLM Feedback Learning feature.
 * Manages its own state and API calls; no props required beyond standard React.
 */
const LlmFeedbackSettings: React.FC = () => {
  const [settings, setSettings] = useState<FeedbackSettings>({ isEnabled: false, maxExamples: 10, similarityThreshold: 0.3 });
  const [examples, setExamples] = useState<CorrectionExample[]>([]);
  const [effectiveness, setEffectiveness] = useState<FeedbackEffectiveness | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isLoadingExamples, setIsLoadingExamples] = useState(true);
  const [isLoadingEffectiveness, setIsLoadingEffectiveness] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 4000);
  };

  const loadSettings = useCallback(async () => {
    setIsLoadingSettings(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/feedback/settings', { headers });
      if (!response.ok) throw new Error('Failed to load settings');
      const data = await response.json();
      setSettings(data.settings);
    } catch (err: any) {
      showError(err.message || 'Failed to load feedback settings');
    } finally {
      setIsLoadingSettings(false);
    }
  }, []);

  const loadExamples = useCallback(async () => {
    setIsLoadingExamples(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/feedback/examples', { headers });
      if (!response.ok) throw new Error('Failed to load examples');
      const data = await response.json();
      setExamples(data.examples || []);
    } catch (err: any) {
      showError(err.message || 'Failed to load correction examples');
    } finally {
      setIsLoadingExamples(false);
    }
  }, []);

  const loadEffectiveness = useCallback(async () => {
    setIsLoadingEffectiveness(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/feedback/effectiveness', { headers });
      if (!response.ok) throw new Error('Failed to load effectiveness report');
      const data = await response.json();
      setEffectiveness(data.effectiveness);
    } catch (err: any) {
      console.warn('Failed to load feedback effectiveness report:', err);
    } finally {
      setIsLoadingEffectiveness(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadExamples();
    loadEffectiveness();
  }, [loadSettings, loadExamples, loadEffectiveness]);

  const saveSettings = async (updatedSettings: FeedbackSettings) => {
    setIsSaving(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/feedback/settings', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings),
      });
      if (!response.ok) throw new Error('Failed to save settings');
      const data = await response.json();
      setSettings(data.settings);
      showSuccess('Settings saved successfully.');
      loadEffectiveness();
    } catch (err: any) {
      showError(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = () => {
    const updated = { ...settings, isEnabled: !settings.isEnabled };
    setSettings(updated);
    saveSettings(updated);
  };

  const handleMaxExamplesChange = (value: number) => {
    setSettings(prev => ({ ...prev, maxExamples: value }));
  };

  const handleMaxExamplesBlur = () => {
    saveSettings(settings);
  };

  const handleThresholdChange = (value: number) => {
    setSettings(prev => ({ ...prev, similarityThreshold: value }));
  };

  const handleThresholdBlur = () => {
    saveSettings(settings);
  };

  const deleteExample = async (id: string) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/feedback/examples/${id}`, { method: 'DELETE', headers });
      if (!response.ok) throw new Error('Failed to delete example');
      setExamples(prev => prev.filter(ex => ex.id !== id));
      showSuccess('Correction example deleted.');
      loadEffectiveness();
    } catch (err: any) {
      showError(err.message || 'Failed to delete example');
    }
  };

  const clearAllExamples = async () => {
    if (!window.confirm('Are you sure you want to delete ALL correction examples? This cannot be undone.')) return;
    setIsClearing(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/feedback/examples', { method: 'DELETE', headers });
      if (!response.ok) throw new Error('Failed to clear examples');
      setExamples([]);
      showSuccess('All correction examples cleared.');
      loadEffectiveness();
    } catch (err: any) {
      showError(err.message || 'Failed to clear examples');
    } finally {
      setIsClearing(false);
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="space-y-6">
      {/* Status messages */}
      {successMessage && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-medium animate-fade-in">
          <span>✓</span> {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-medium animate-fade-in">
          <span>✕</span> {errorMessage}
        </div>
      )}

      {/* Explainer card */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🧠</span>
          <div>
            <h3 className="text-sm font-bold text-indigo-900 mb-1">How LLM Feedback Learning Works</h3>
            <p className="text-xs text-indigo-700 leading-relaxed">
              When enabled, every time you correct a merchant name, category, payment method, or transaction type
              at the Silver or Gold stage, the system captures the correction as a learning example. On the next
              extraction, your most recent corrections are injected into the LLM prompt so it can learn your
              preferences and improve accuracy over time — <strong>no model fine-tuning required</strong>.
            </p>
            <ul className="mt-2 text-xs text-indigo-600 space-y-0.5 list-disc list-inside">
              <li>Only genuine corrections are captured (unchanged approvals are ignored)</li>
              <li>Amount and currency are excluded — only inference-based fields are tracked</li>
              <li>Examples are user-isolated and automatically removed when source emails are deleted</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Settings card */}
      <div className="bg-white border border-gray-150/60 rounded-2xl p-5 shadow-sm space-y-5">
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Configuration</h3>

        {isLoadingSettings ? (
          <div className="text-sm text-gray-400 animate-pulse">Loading settings...</div>
        ) : (
          <>
            {/* Enable/Disable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">Enable LLM Feedback Learning</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {settings.isEnabled
                    ? 'Corrections are being captured and injected into extractions.'
                    : 'Feature is off. No corrections captured or injected.'}
                </p>
              </div>
              <button
                id="feedback-toggle"
                onClick={handleToggleEnabled}
                disabled={isSaving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 cursor-pointer disabled:opacity-50 ${
                  settings.isEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    settings.isEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Max examples slider */}
            <div className={`space-y-2 transition-opacity duration-200 ${settings.isEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <div className="flex items-center justify-between">
                <label htmlFor="max-examples-input" className="text-sm font-semibold text-gray-800">
                  Max Correction Examples to Inject
                </label>
                <span className="text-sm font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-lg">
                  {settings.maxExamples}
                </span>
              </div>
              <input
                id="max-examples-input"
                type="range"
                min={1}
                max={50}
                step={1}
                value={settings.maxExamples}
                onChange={e => handleMaxExamplesChange(parseInt(e.target.value, 10))}
                onMouseUp={handleMaxExamplesBlur}
                onTouchEnd={handleMaxExamplesBlur}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>1 (minimal)</span>
                <span>50 (maximum)</span>
              </div>
              <p className="text-xs text-gray-500">
                The {settings.maxExamples} most semantically relevant corrections will be included in the LLM prompt at extraction time.
              </p>
            </div>

            {/* Similarity threshold slider */}
            <div className={`space-y-2 transition-opacity duration-200 ${settings.isEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <div className="flex items-center justify-between">
                <label htmlFor="similarity-threshold-input" className="text-sm font-semibold text-gray-800">
                  Minimum Semantic Similarity Threshold
                </label>
                <span className="text-sm font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-lg">
                  {settings.similarityThreshold}
                </span>
              </div>
              <input
                id="similarity-threshold-input"
                type="range"
                min={0.0}
                max={1.0}
                step={0.05}
                value={settings.similarityThreshold}
                onChange={e => handleThresholdChange(parseFloat(e.target.value))}
                onMouseUp={handleThresholdBlur}
                onTouchEnd={handleThresholdBlur}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>0.00 (inject all)</span>
                <span>1.00 (strict match only)</span>
              </div>
              <p className="text-xs text-gray-500">
                Only corrections with a similarity score equal to or higher than this threshold will be injected.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Feedback Learning Effectiveness observability */}
      <div className="bg-white border border-gray-150/60 rounded-2xl p-5 shadow-sm space-y-6">
        <div>
          <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">📈 Feedback Learning Effectiveness</h3>
          <p className="text-xs text-gray-500 mt-0.5">Observe how corrections improve LLM extraction accuracy over time.</p>
        </div>

        {isLoadingEffectiveness ? (
          <div className="text-sm text-gray-400 animate-pulse">Loading effectiveness metrics...</div>
        ) : !effectiveness ? (
          <div className="text-xs text-gray-400">Failed to load effectiveness data.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-left">
            
            {/* Left: Before/After & Coverage */}
            <div className="space-y-5">
              {/* Coverage Metrics */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Correction & Miss Coverage</h4>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Merchant</p>
                    <p className="text-base font-extrabold text-indigo-650 mt-1">{effectiveness.coverage.byField.merchant || 0}</p>
                    <p className="text-[9px] text-gray-400 mt-0.5">({effectiveness.coverage.historicalMissesByField.merchant || 0} misses)</p>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Category</p>
                    <p className="text-base font-extrabold text-indigo-650 mt-1">{effectiveness.coverage.byField.category || 0}</p>
                    <p className="text-[9px] text-gray-400 mt-0.5">({effectiveness.coverage.historicalMissesByField.category || 0} misses)</p>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Method</p>
                    <p className="text-base font-extrabold text-indigo-650 mt-1">{effectiveness.coverage.byField.paymentMethod || 0}</p>
                    <p className="text-[9px] text-gray-400 mt-0.5">({effectiveness.coverage.historicalMissesByField.paymentMethod || 0} misses)</p>
                  </div>
                </div>
              </div>

              {/* Before/After Split */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Before vs After Learning Split</h4>
                {effectiveness.beforeAfter.before && effectiveness.beforeAfter.after ? (
                  <div className="space-y-2.5">
                    <div className="flex justify-between items-center text-[10px] text-gray-400">
                      <span>Cutoff Date (First Correction):</span>
                      <span className="font-bold text-gray-600">{new Date(effectiveness.beforeAfter.cutoffDate || '').toLocaleDateString()}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Before */}
                      <div className="bg-white p-3 rounded-lg border border-gray-100">
                        <p className="text-[10px] font-bold text-red-650 uppercase">Before Learning</p>
                        <div className="mt-2 space-y-1 text-xs">
                          <div className="flex justify-between"><span>Merchant:</span> <span className="font-semibold text-gray-700">{effectiveness.beforeAfter.before.merchantAccuracy}%</span></div>
                          <div className="flex justify-between"><span>Category:</span> <span className="font-semibold text-gray-700">{effectiveness.beforeAfter.before.categoryAccuracy}%</span></div>
                          <div className="flex justify-between"><span>Method:</span> <span className="font-semibold text-gray-700">{effectiveness.beforeAfter.before.paymentMethodAccuracy}%</span></div>
                        </div>
                      </div>
                      {/* After */}
                      <div className="bg-white p-3 rounded-lg border border-gray-100">
                        <p className="text-[10px] font-bold text-emerald-650 uppercase">After Learning</p>
                        <div className="mt-2 space-y-1 text-xs">
                          <div className="flex justify-between"><span>Merchant:</span> <span className="font-bold text-gray-800">{effectiveness.beforeAfter.after.merchantAccuracy}%</span></div>
                          <div className="flex justify-between"><span>Category:</span> <span className="font-bold text-gray-800">{effectiveness.beforeAfter.after.categoryAccuracy}%</span></div>
                          <div className="flex justify-between"><span>Method:</span> <span className="font-bold text-gray-800">{effectiveness.beforeAfter.after.paymentMethodAccuracy}%</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 leading-relaxed italic">
                    Add corrections and ingest new emails to generate comparison metrics.
                  </p>
                )}
              </div>
            </div>

            {/* Right: Weekly trend list */}
            <div className="bg-gray-50 rounded-xl p-4 flex flex-col">
              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">Weekly Accuracy Trend</h4>
              {effectiveness.weeklyTrend.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-xs text-gray-400 italic">
                  No historical trend data.
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto max-h-[220px] space-y-2 pr-1">
                  {effectiveness.weeklyTrend.map(entry => (
                    <div key={entry.week} className="bg-white p-2.5 rounded-lg border border-gray-100 flex items-center justify-between text-xs">
                      <div>
                        <p className="font-bold text-gray-700">{entry.week}</p>
                        <p className="text-[9px] text-gray-400">{entry.totalRecords} records approved</p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-1">
                        <span className={`px-2 py-0.5 rounded font-semibold text-[9px] text-center ${
                          entry.merchantAccuracy >= 90 ? 'bg-emerald-50 text-emerald-700' : entry.merchantAccuracy >= 70 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                        }`}>
                          Merch: {entry.merchantAccuracy}%
                        </span>
                        <span className={`px-2 py-0.5 rounded font-semibold text-[9px] text-center ${
                          entry.categoryAccuracy >= 90 ? 'bg-emerald-50 text-emerald-700' : entry.categoryAccuracy >= 70 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                        }`}>
                          Cat: {entry.categoryAccuracy}%
                        </span>
                        <span className={`px-2 py-0.5 rounded font-semibold text-[9px] text-center ${
                          entry.paymentMethodAccuracy >= 90 ? 'bg-emerald-50 text-emerald-700' : entry.paymentMethodAccuracy >= 70 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                        }`}>
                          Method: {entry.paymentMethodAccuracy}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* Correction examples table */}
      <div className="bg-white border border-gray-150/60 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">
              Stored Correction Examples
              <span className="ml-2 text-xs font-normal text-gray-400 normal-case">
                ({isLoadingExamples ? '…' : examples.length} total)
              </span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">These examples are injected into future LLM extraction prompts.</p>
          </div>
          {examples.length > 0 && (
            <button
              id="clear-all-examples-btn"
              onClick={clearAllExamples}
              disabled={isClearing}
              className="text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-3 py-1.5 transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              {isClearing ? 'Clearing…' : '🗑 Clear All'}
            </button>
          )}
        </div>

        {isLoadingExamples ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400 animate-pulse">Loading examples…</div>
        ) : examples.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-2xl mb-2">📭</p>
            <p className="text-sm font-medium text-gray-500">No correction examples yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              {settings.isEnabled
                ? 'Correct a field in a Silver or Gold record and it will appear here.'
                : 'Enable the feature above to start capturing corrections.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Field</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">LLM Said</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Corrected To</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Email Snippet</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {examples.map(ex => (
                  <tr key={ex.id} className="hover:bg-gray-50/60 transition-colors duration-100">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold text-xs">
                        {FIELD_LABELS[ex.fieldName] ?? ex.fieldName}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 italic max-w-[140px] truncate" title={ex.llmValue ?? '—'}>
                      {ex.llmValue || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-emerald-700 font-semibold max-w-[140px] truncate" title={ex.correctedValue}>
                      {ex.correctedValue}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 max-w-[200px] truncate" title={ex.emailSnippet ?? '—'}>
                      {ex.emailSnippet || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">
                      {formatDate(ex.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => deleteExample(ex.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors duration-150 cursor-pointer"
                        title="Delete this example"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default LlmFeedbackSettings;
