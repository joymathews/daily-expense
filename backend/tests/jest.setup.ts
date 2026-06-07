/**
 * Global Jest Mocks for Backend Tests
 */

// Mock the authentication middleware globally to avoid ESM parsing issues with 'jose' and 'jwks-rsa'
jest.mock('../src/middleware/auth-middleware', () => ({
  checkJwt: (req: any, res: any, next: any) => {
    if (req.headers.authorization === 'Bearer valid-token') {
      (req as any).auth = { sub: 'user-123' };
      return next();
    }
    // Most routes expect 401 for missing/invalid token
    res.status(401).json({ error: 'Unauthorized' });
  }
}));
