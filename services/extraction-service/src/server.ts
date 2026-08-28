import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { config } from './config';
import { ProviderFactory } from './providers/provider-factory';
import { ExtractionRequest, ExtractionResponse } from './types';

const logger = pino({ level: config.logLevel });
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Rate limiting middleware: max 60 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// Authentication Middleware: Validates internal service secret
const validateServiceSecret = (req: Request, res: Response, next: NextFunction) => {
  // Allow unauthenticated access to health endpoint
  if (req.path === '/health') {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const serviceKey = req.headers['x-internal-service-key'];
  
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : serviceKey;

  if (!token || token !== config.serviceSecret) {
    logger.warn({ ip: req.ip, path: req.path }, 'Unauthorized request rejected');
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid internal service secret' });
  }

  next();
};

app.use(validateServiceSecret);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  const provider = ProviderFactory.createProvider();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'llm-extraction-service',
    activeProvider: provider.name
  });
});

// Primary Extraction Endpoint
app.post('/api/v1/extract', async (req: Request<{}, {}, ExtractionRequest>, res: Response<ExtractionResponse>) => {
  const startTime = Date.now();
  const { textBody, contextBlock } = req.body;

  if (!textBody || typeof textBody !== 'string' || textBody.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request: "textBody" must be a non-empty string.'
    });
  }

  try {
    const provider = ProviderFactory.createProvider();
    logger.info({ provider: provider.name, textLength: textBody.length }, 'Processing extraction request');

    const transaction = await provider.extractTransaction(textBody, contextBlock);
    const latencyMs = Date.now() - startTime;

    if (!transaction) {
      return res.status(500).json({
        success: false,
        error: 'Extraction failed: LLM provider returned empty or invalid JSON response.'
      });
    }

    return res.json({
      success: true,
      transaction,
      metadata: {
        provider: provider.name,
        model: provider.name === 'azure-openai' ? config.azureOpenAI.deployment : config.ollama.model,
        latencyMs
      }
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Unhandled error during extraction execution');
    return res.status(500).json({
      success: false,
      error: `Internal Server Error: ${error.message}`
    });
  }
});

// Start server if run directly
if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    const provider = ProviderFactory.createProvider();
    logger.info(`=======================================================`);
    logger.info(`🚀 LLM Extraction Service running on port ${config.port}`);
    logger.info(`🔒 Active Provider: ${provider.name}`);
    logger.info(`=======================================================`);
  });
}

export default app;
