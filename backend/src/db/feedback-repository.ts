/**
 * [FUNC-FEEDBACK-1, FUNC-FEEDBACK-2, FUNC-FEEDBACK-3, FUNC-FEEDBACK-4]
 * Narrow, role-specific repository interface for the LLM Feedback Learning feature.
 * Follows ISP: callers of this interface depend only on feedback-related operations.
 */

export type CorrectionFieldName = 'merchant' | 'category' | 'paymentMethod' | 'transactionType';

export interface FeedbackSettings {
  isEnabled: boolean;
  maxExamples: number;
  similarityThreshold?: number;
}

export interface CorrectionExample {
  id: string;
  userId: string;
  bronzeInputId: string;
  fieldName: CorrectionFieldName;
  llmValue: string | null;
  correctedValue: string;
  emailSnippet: string | null;
  embedding?: string | null;
  createdAt?: string;
}

export interface IFeedbackRepository {
  /** Returns the user's feedback settings, defaulting to disabled with 10 examples. */
  getFeedbackSettings(userId: string): Promise<FeedbackSettings>;

  /** Persists or updates the user's feedback settings. */
  saveFeedbackSettings(userId: string, settings: FeedbackSettings): Promise<void>;

  /**
   * Upserts a correction example. If an example for the same
   * (user_id, bronze_input_id, field_name) already exists, it is replaced
   * so re-corrections always reflect the most recent ground truth.
   */
  upsertCorrectionExample(example: CorrectionExample): Promise<void>;

  /** Returns the N most-recent correction examples for a user, ordered by created_at DESC. */
  getRecentCorrectionExamples(userId: string, limit: number): Promise<CorrectionExample[]>;

  /** Returns all stored correction examples for a user (for the management UI). */
  listCorrectionExamples(userId: string): Promise<CorrectionExample[]>;

  /** Removes a single correction example by ID. */
  deleteCorrectionExample(id: string, userId: string): Promise<void>;

  /** Removes all correction examples for a user. */
  clearAllCorrectionExamples(userId: string): Promise<void>;

  /** Computes the feedback learning effectiveness metrics. */
  getFeedbackEffectiveness(userId: string): Promise<FeedbackEffectiveness>;
}

// ---------------------------------------------------------------------------
// Effectiveness / observability types
// ---------------------------------------------------------------------------

/** Per-field accuracy snapshot for a group of Gold transactions. */
export interface FieldAccuracySnapshot {
  merchantAccuracy: number;
  categoryAccuracy: number;
  paymentMethodAccuracy: number;
  totalRecords: number;
}

/** Accuracy figures for a single calendar week (ISO week string, e.g. "2026-W27"). */
export interface WeeklyAccuracyEntry {
  week: string;
  merchantAccuracy: number;
  categoryAccuracy: number;
  paymentMethodAccuracy: number;
  totalRecords: number;
}

/**
 * Complete effectiveness report returned by GET /api/feedback/effectiveness.
 * Designed to let the user observe whether their corrections are improving
 * LLM extraction accuracy over time.
 */
export interface FeedbackEffectiveness {
  /** Per-week accuracy trend, ordered chronologically. */
  weeklyTrend: WeeklyAccuracyEntry[];

  /**
   * Accuracy before the first correction was ever made vs. after.
   * `cutoffDate` is the ISO timestamp of the oldest correction example.
   * Both snapshots are null when no corrections exist yet.
   */
  beforeAfter: {
    cutoffDate: string | null;
    before: FieldAccuracySnapshot | null;
    after: FieldAccuracySnapshot | null;
  };

  /**
   * Coverage metrics — how many correction examples exist per field and
   * how many historical misses they potentially cover.
   */
  coverage: {
    totalExamples: number;
    byField: Record<string, number>;
    historicalMissesByField: Record<string, number>;
  };
}
