import express from 'express';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { checkJwt } from './middleware/auth-middleware';
import ingestionRoutes from './routes/ingestion-routes';
import pipelineRoutes from './routes/pipeline-routes';
import feedbackRoutes from './routes/feedback-routes';
import { logger } from './utils/logger';

const app = express();

app.use(compression());
app.use(pinoHttp({
  logger,
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      query: req.query,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
}));

app.use(express.json());

// Ingestion and Pipeline routes
app.use('/api/ingestion', checkJwt, ingestionRoutes);
app.use('/api/pipeline', checkJwt, pipelineRoutes);

// LLM Feedback Learning routes (fully decoupled from pipeline and ingestion)
app.use('/api/feedback', checkJwt, feedbackRoutes);

// Backward compatibility routes for testing
app.use('/api/gmail', checkJwt, ingestionRoutes);
app.use('/api/gmail', checkJwt, pipelineRoutes);

// [FUNC-SKEL-SYS-1] Health-check endpoint (Public)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * [FUNC-AUTH-2] The system must remain inaccessible to unauthenticated users.
 * This route is protected and requires a valid Cognito JWT.
 */
app.get('/api/private', checkJwt, (req, res) => {
  res.status(200).json({ 
    message: 'This is a private route, only for authenticated users.',
    user: (req as any).auth 
  });
});

// [FUNC-SYS-4] Endpoint for frontend logs ingestion
app.post('/api/logs', checkJwt, (req, res) => {
  const { level, message, details } = req.body;
  if (!level || !message) {
    res.status(400).json({ error: 'Missing log level or message' });
    return;
  }

  // Map loglevel client levels to pino levels
  const lowerLevel = level.toLowerCase();
  const logMethod = (logger as any)[lowerLevel];
  if (typeof logMethod === 'function') {
    logMethod.call(logger, { source: 'frontend', clientDetails: details }, message);
  } else {
    logger.info({ source: 'frontend', clientDetails: details, clientLevel: level }, message);
  }

  res.status(200).json({ status: 'ok' });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.name === 'UnauthorizedError') {
    logger.warn({ ip: req.ip, url: req.originalUrl, error: err.message }, 'Unauthorized API access attempt');
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  logger.error({ err, url: req.originalUrl }, 'Unhandled backend server error');
  res.status(500).json({ error: 'Internal Server Error' });
});

export { app };
