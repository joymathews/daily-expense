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

  // [NFR-SEC-4] Input Validation
  if (!filters || !Array.isArray(filters.sender) || filters.sender.length === 0) {
    return res.status(400).json({ error: 'At least one sender email is required' });
  }

  if (!filters.startDate || !filters.endDate) {
    return res.status(400).json({ error: 'Start date and end date are required' });
  }

  try {
    const emails = await gmailService.fetchEmails(accessToken, filters);
    res.status(200).json({ emails });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch emails' });
  }
});

export default router;
