import express from 'express';

const app = express();

app.use(express.json());

// [FUNC-SKEL-BE-3] Health-check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

export { app };
