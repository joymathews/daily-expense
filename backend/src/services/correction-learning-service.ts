import crypto from 'crypto';
import { IFeedbackRepository, CorrectionExample, CorrectionFieldName } from '../db/feedback-repository';

const CORRECTABLE_FIELDS: CorrectionFieldName[] = ['merchant', 'category', 'paymentMethod', 'transactionType'];
const EMAIL_SNIPPET_MAX_CHARS = 300;

export interface LlmLogValues {
  extractedMerchant: string | null;
  extractedCategory: string | null;
  extractedPaymentMethod: string | null;
  extractedTransactionType: string | null;
}

export interface SavedFieldValues {
  merchant?: string | null;
  category?: string | null;
  paymentMethod?: string | null;
  transactionType?: string | null;
}

export interface CaptureCorrectionsParams {
  userId: string;
  bronzeInputId: string;
  emailBody: string;
  llmLog: LlmLogValues;
  savedValues: SavedFieldValues;
  repository: IFeedbackRepository;
}

/**
 * [FUNC-FEEDBACK-1, FUNC-FEEDBACK-2]
 * Self-contained service for the LLM Feedback Learning feature.
 * All correction capture and few-shot prompt enrichment logic lives here.
 * Callers only need two public methods; the feature is completely transparent
 * when disabled.
 */
export class CorrectionLearningService {

  /**
   * Called after any Silver or Gold save. Checks if the feature is enabled,
   * computes the diff between the saved values and the original LLM log, and
   * upserts a correction example for each field that genuinely changed.
   *
   * This method is designed to be called fire-and-forget (no await at call site)
   * so it never blocks or alters the response of the calling route.
   */
  async captureCorrectionsIfEnabled(params: CaptureCorrectionsParams): Promise<void> {
    const { userId, bronzeInputId, emailBody, llmLog, savedValues, repository } = params;

    const settings = await repository.getFeedbackSettings(userId);
    if (!settings.isEnabled) {
      return;
    }

    const emailSnippet = emailBody?.slice(0, EMAIL_SNIPPET_MAX_CHARS) || null;

    const fieldMap: Array<{ field: CorrectionFieldName; llmValue: string | null; savedValue: string | null | undefined }> = [
      { field: 'merchant',         llmValue: llmLog.extractedMerchant,       savedValue: savedValues.merchant },
      { field: 'category',         llmValue: llmLog.extractedCategory,       savedValue: savedValues.category },
      { field: 'paymentMethod',    llmValue: llmLog.extractedPaymentMethod,  savedValue: savedValues.paymentMethod },
      { field: 'transactionType',  llmValue: llmLog.extractedTransactionType,savedValue: savedValues.transactionType },
    ];

    for (const { field, llmValue, savedValue } of fieldMap) {
      if (!savedValue) continue;
      const valueChanged = this.isGenuineCorrection(llmValue, savedValue);
      if (!valueChanged) continue;

      const example: CorrectionExample = {
        id: crypto.randomUUID(),
        userId,
        bronzeInputId,
        fieldName: field,
        llmValue: llmValue ?? null,
        correctedValue: savedValue,
        emailSnippet,
      };
      await repository.upsertCorrectionExample(example);
    }
  }

  /**
   * [FUNC-FEEDBACK-1, FUNC-FEEDBACK-3]
   * Fetches the N most-recent correction examples and formats them into a
   * structured prompt block to be prepended to the LLM system instruction.
   * Returns an empty string when disabled or when no examples exist.
   */
  async buildFewShotPromptBlock(userId: string, repository: IFeedbackRepository): Promise<string> {
    const settings = await repository.getFeedbackSettings(userId);
    if (!settings.isEnabled) {
      return '';
    }

    const examples = await repository.getRecentCorrectionExamples(userId, settings.maxExamples);
    if (examples.length === 0) {
      return '';
    }

    const exampleLines = examples.map((ex, index) => {
      const snippet = ex.emailSnippet ? `"${ex.emailSnippet.replace(/\n/g, ' ').slice(0, 120)}..."` : '(no snippet)';
      return `Example ${index + 1} [${ex.fieldName}]: Email starting with ${snippet} | LLM extracted: "${ex.llmValue ?? 'null'}" → Correct value: "${ex.correctedValue}"`;
    });

    return [
      '--- Correction History (learn from these past corrections to improve accuracy) ---',
      ...exampleLines,
      '--- End of Correction History ---',
    ].join('\n');
  }

  /**
   * A correction is genuine only when the saved value differs from the LLM value
   * (case-insensitive trim). If the user approved the LLM output unchanged, we
   * do not capture it to avoid polluting the example pool with noise.
   */
  private isGenuineCorrection(llmValue: string | null, savedValue: string): boolean {
    const normalizedLlm = (llmValue ?? '').trim().toLowerCase();
    const normalizedSaved = savedValue.trim().toLowerCase();
    return normalizedLlm !== normalizedSaved;
  }
}
