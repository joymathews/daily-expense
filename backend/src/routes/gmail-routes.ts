import { Router } from 'express';
import { GmailService } from '../services/gmail-service';

const router = Router();
const gmailService = new GmailService();

/**
 * [FUNC-GMAIL-4] POST /api/gmail/fetch
 * Accepts an ephemeral Google access token and filters to fetch emails.
 */
router.post('/fetch', async (req, res) => {
  const { accessToken, filters } = req.body;

  if (!accessToken) {
    return res.status(400).json({ error: 'Google Access Token is required' });
  }

  try {
    const emails = await gmailService.fetchEmails(accessToken, filters || {});
    res.status(200).json({ emails });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch emails' });
  }
});

export default router;
