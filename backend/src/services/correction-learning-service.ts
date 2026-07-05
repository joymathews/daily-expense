import crypto from 'crypto';
import { IFeedbackRepository, CorrectionExample, CorrectionFieldName } from '../db/feedback-repository';

const CORRECTABLE_FIELDS: CorrectionFieldName[] = ['merchant', 'category', 'paymentMethod', 'transactionType'];
const EMAIL_SNIPPET_MAX_CHARS = 300;

const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'http://localhost:11434';
const LLM_EMBEDDING_MODEL = process.env.LLM_EMBEDDING_MODEL || 'nomic-embed-text';

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
  draftValues?: SavedFieldValues; // The values in the draft/entry before user saved or approved them
  repository: IFeedbackRepository;
}

/**
 * [FUNC-FEEDBACK-1, FUNC-FEEDBACK-2]
 * Self-contained service for the LLM Feedback Learning feature.
 * Features semantic embedding-based routing using cosine similarity and
 * automatic background backfill of legacy correction examples.
 */
export class CorrectionLearningService {

  /**
   * Called after any Silver or Gold save. Checks if the feature is enabled,
   * computes the diff, requests a local embedding vector, and upserts a correction.
   *
   * Designed to be fire-and-forget so DB/Ollama operations never block route completion.
   */
  async captureCorrectionsIfEnabled(params: CaptureCorrectionsParams): Promise<void> {
    const { userId, bronzeInputId, emailBody, llmLog, savedValues, draftValues, repository } = params;

    const settings = await repository.getFeedbackSettings(userId);
    if (!settings.isEnabled) {
      return;
    }

    const emailSnippet = emailBody?.slice(0, EMAIL_SNIPPET_MAX_CHARS) || null;

    const fieldMap: Array<{
      field: CorrectionFieldName;
      llmValue: string | null;
      draftValue: string | null | undefined;
      savedValue: string | null | undefined;
    }> = [
      { field: 'merchant',         llmValue: llmLog.extractedMerchant,       draftValue: draftValues?.merchant,       savedValue: savedValues.merchant },
      { field: 'category',         llmValue: llmLog.extractedCategory,       draftValue: draftValues?.category,       savedValue: savedValues.category },
      { field: 'paymentMethod',    llmValue: llmLog.extractedPaymentMethod,  draftValue: draftValues?.paymentMethod,  savedValue: savedValues.paymentMethod },
      { field: 'transactionType',  llmValue: llmLog.extractedTransactionType,draftValue: draftValues?.transactionType,savedValue: savedValues.transactionType },
    ];

    // Compute diffs:
    // A correction is captured only if the finalized saved value differs from the original LLM log,
    // AND (if a draft state exists) the user explicitly made a manual edit (savedValue !== draftValue).
    const genuineCorrections = fieldMap.filter(({ llmValue, draftValue, savedValue }) => {
      if (!savedValue) return false;

      // If draft values are provided, ignore changes that were automatically applied by rules
      // (where savedValue is identical to the automated draftValue)
      if (draftValue !== undefined) {
        const userChangedIt = this.isGenuineCorrection(draftValue, savedValue);
        if (!userChangedIt) return false;
      }

      return this.isGenuineCorrection(llmValue, savedValue);
    });

    if (genuineCorrections.length === 0) {
      return;
    }

    // Call Ollama endpoint to generate vector
    const vector = await this.generateEmbedding(emailBody);
    const vectorStr = vector ? JSON.stringify(vector) : null;

    for (const { field, llmValue, savedValue } of genuineCorrections) {
      const example: CorrectionExample = {
        id: crypto.randomUUID(),
        userId,
        bronzeInputId,
        fieldName: field,
        llmValue: llmValue ?? null,
        correctedValue: savedValue!,
        emailSnippet,
        embedding: vectorStr,
      };
      await repository.upsertCorrectionExample(example);
    }
  }

  /**
   * [FUNC-FEEDBACK-1, FUNC-FEEDBACK-3]
   * Fetches, semantically ranks, and filters correction examples using cosine similarity.
   * Returns a formatted system instruction few-shot context block.
   *
   * Falls back gracefully to recency ordering if Ollama is offline or model is not pulled.
   */
  async buildFewShotPromptBlock(userId: string, repository: IFeedbackRepository, emailBody?: string): Promise<string> {
    const settings = await repository.getFeedbackSettings(userId);
    if (!settings.isEnabled) {
      return '';
    }

    const examples = await repository.listCorrectionExamples(userId);
    if (examples.length === 0) {
      return '';
    }

    // Trigger background auto-backfill for any NULL embedding rows
    this.triggerBackgroundBackfill(userId, examples, repository);

    let finalMatches = examples;

    if (emailBody) {
      const targetVector = await this.generateEmbedding(emailBody);
      if (targetVector) {
        // Calculate similarity scores
        const scored = examples.map(ex => {
          let score = 0;
          if (ex.embedding) {
            try {
              const vector = JSON.parse(ex.embedding);
              score = this.cosineSimilarity(targetVector, vector);
            } catch {
              score = 0;
            }
          }
          return { ex, score };
        });

        // Filter by threshold and sort by similarity score descending
        const threshold = settings.similarityThreshold ?? 0.3;
        finalMatches = scored
          .filter(s => s.score >= threshold || !s.ex.embedding) // keep non-embedded ones as lower fallback
          .sort((a, b) => b.score - a.score)
          .map(s => s.ex);
      }
    }

    // Slice to capacity (maxExamples)
    const selected = finalMatches.slice(0, settings.maxExamples);
    if (selected.length === 0) {
      return '';
    }

    const exampleLines = selected.map((ex, index) => {
      const snippet = ex.emailSnippet ? `"${ex.emailSnippet.replace(/\n/g, ' ').slice(0, 120)}..."` : '(no snippet)';
      return `Example ${index + 1} [${ex.fieldName}]: Email starting with ${snippet} | LLM extracted: "${ex.llmValue ?? 'null'}" → Correct value: "${ex.correctedValue}"`;
    });

    return [
      '--- Correction History (learn from these past corrections to improve accuracy) ---',
      ...exampleLines,
      '--- End of Correction History ---',
    ].join('\n');
  }

  /** Fetch embedding float coordinates from Ollama. Returns null if offline or not pulled. */
  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      const cleanText = text.replace(/\s+/g, ' ').slice(0, 1000).trim();
      if (!cleanText) return null;

      const response = await fetch(`${LLM_ENDPOINT}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LLM_EMBEDDING_MODEL,
          prompt: cleanText,
        }),
      });

      if (!response.ok) {
        throw new Error(`Embedding request failed with code ${response.status}`);
      }

      const data: any = await response.json();
      return data.embedding || null;
    } catch (err) {
      console.warn('Ollama embedding service not available or model not pulled:', err);
      return null;
    }
  }

  /** Compute cosine similarity between two float coordinate vectors. */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    const len = Math.min(vecA.length, vecB.length);
    for (let i = 0; i < len; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /** Automatically generates and updates embeddings for any legacy NULL records in the background. */
  private triggerBackgroundBackfill(userId: string, examples: CorrectionExample[], repository: IFeedbackRepository): void {
    const missing = examples.filter(ex => !ex.embedding);
    if (missing.length === 0) return;

    (async () => {
      for (const ex of missing) {
        const textToEmbed = ex.emailSnippet || 'Transaction correction example';
        const vector = await this.generateEmbedding(textToEmbed);
        if (vector) {
          ex.embedding = JSON.stringify(vector);
          await repository.upsertCorrectionExample(ex).catch(() => {});
        }
      }
    })().catch(() => {});
  }

  /** Case-insensitive trimmed check to determine if a correction is genuine. */
  private isGenuineCorrection(llmValue: string | null, savedValue: string): boolean {
    const normalizedLlm = (llmValue ?? '').trim().toLowerCase();
    const normalizedSaved = savedValue.trim().toLowerCase();
    return normalizedLlm !== normalizedSaved;
  }
}
