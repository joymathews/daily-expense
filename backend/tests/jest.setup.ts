/**
 * Global Jest Mocks for Backend Tests
 */
/// <reference types="jest" />

// Ensure unit tests run against SQLite by default regardless of local .env DB_PROVIDER settings
process.env.DB_PROVIDER = 'sqlite';

// Mock the authentication middleware globally to avoid ESM parsing issues with 'jose' and 'jwks-rsa'
jest.mock('../src/middleware/auth-middleware', () => ({
  checkJwt: (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (token === 'valid-token') {
        (req as any).auth = { sub: 'user-123' };
        return next();
      } else if (token === 'user-a-token') {
        (req as any).auth = { sub: 'user-a' };
        return next();
      } else if (token === 'user-b-token') {
        (req as any).auth = { sub: 'user-b' };
        return next();
      }
    }
    res.status(401).json({ error: 'Unauthorized' });
  }
}));
