/**
 * Resolves API URL dynamically for development (relative/proxy) and production (direct backend ACA URL).
 * In local dev (npm run dev), VITE_BACKEND_API_URL is empty, so relative paths (/api/...) are used with Vite proxy.
 * In production builds (GitHub Actions), VITE_BACKEND_API_URL is set to the live Azure Container App URL.
 */
const backendTarget = (import.meta.env.VITE_BACKEND_API_URL || '').trim();

export const getApiUrl = (path: string): string => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!backendTarget) {
    return cleanPath;
  }
  const baseUrl = backendTarget.endsWith('/') ? backendTarget.slice(0, -1) : backendTarget;
  if (baseUrl.endsWith('/api') && cleanPath.startsWith('/api/')) {
    return `${baseUrl}${cleanPath.substring(4)}`;
  }
  return `${baseUrl}${cleanPath}`;
};
