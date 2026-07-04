import express from 'express';
import { checkJwt } from './middleware/auth-middleware';
import ingestionRoutes from './routes/ingestion-routes';
import pipelineRoutes from './routes/pipeline-routes';
import feedbackRoutes from './routes/feedback-routes';

const app = express();

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

export { app };
