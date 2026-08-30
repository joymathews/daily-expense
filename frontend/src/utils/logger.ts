import log from 'loglevel';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getApiUrl } from './api-config';

const originalWarn = console.warn;
const originalError = console.error;

// Configure default log level based on environment variable or build mode
const defaultLogLevel = (import.meta.env.VITE_LOG_LEVEL || 
  (import.meta.env.MODE === 'production' ? 'warn' : 'debug')) as log.LogLevelDesc;

log.setLevel(defaultLogLevel);

const isForwardingEnabled = (): boolean => {
  const staticConfig = import.meta.env.VITE_ENABLE_LOG_FORWARDING === 'true';
  const dynamicConfig = localStorage.getItem('enableLogForwarding') === 'true';
  return staticConfig || dynamicConfig;
};

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

const sendLogToBackend = async (level: string, message: string, details?: any) => {
  if (!isForwardingEnabled()) return;

  try {
    const headers = await getAuthHeaders();
    // Use non-blocking fetch
    fetch(getApiUrl('/api/logs'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        level,
        message,
        details: details ? JSON.parse(JSON.stringify(details)) : undefined,
      }),
    }).catch((err) => {
      // Fail silently to prevent console log spirals (do not use console.error here)
      originalWarn('Failed to send log to backend:', err);
    });
  } catch (err) {
    // Fail silently
    originalWarn('Failed to get auth headers for logging:', err);
  }
};

export const logger = {
  trace: (msg: string, ...args: any[]) => {
    log.trace(msg, ...args);
    sendLogToBackend('trace', msg, args);
  },
  debug: (msg: string, ...args: any[]) => {
    log.debug(msg, ...args);
    sendLogToBackend('debug', msg, args);
  },
  info: (msg: string, ...args: any[]) => {
    log.info(msg, ...args);
    sendLogToBackend('info', msg, args);
  },
  warn: (msg: string, ...args: any[]) => {
    log.warn(msg, ...args);
    sendLogToBackend('warn', msg, args);
  },
  error: (msg: string, ...args: any[]) => {
    log.error(msg, ...args);
    sendLogToBackend('error', msg, args);
  },
  setLevel: (level: log.LogLevelDesc) => {
    log.setLevel(level);
  }
};

// Route standard console methods through our custom logging framework
export const enableConsoleOverride = () => {
  console.warn = (message?: any, ...optionalParams: any[]) => {
    originalWarn(message, ...optionalParams);
    try {
      const msgStr = typeof message === 'string' ? message : String(message);
      logger.warn(msgStr, optionalParams);
    } catch {
      // safe fallback
    }
  };

  console.error = (message?: any, ...optionalParams: any[]) => {
    originalError(message, ...optionalParams);
    try {
      const msgStr = typeof message === 'string' ? message : String(message);
      logger.error(msgStr, optionalParams);
    } catch {
      // safe fallback
    }
  };
};

