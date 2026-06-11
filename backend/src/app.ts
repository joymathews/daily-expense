import express from 'express';
import { checkJwt } from './middleware/auth-middleware';
import gmailRoutes from './routes/gmail-routes';

const app = express();

app.use(express.json());

// [FUNC-GMAIL-4] Register Gmail routes
app.use('/api/gmail', checkJwt, gmailRoutes);

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
