import pino from 'pino';
import fs from 'fs';
import path from 'path';

const logFilePath = process.env.LOG_FILE_PATH || 'logs/app.log';
const logDir = path.dirname(logFilePath);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Write logs asynchronously to the central log file using buffering
const fileStream = pino.destination({
  dest: logFilePath,
  sync: false, // asynchronous write
});

// Configure console stream: use pino-pretty in non-production if available
let consoleStream: any = process.stdout;
if (process.env.NODE_ENV !== 'production') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pretty = require('pino-pretty');
    consoleStream = pretty({
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname',
    });
  } catch (err) {
    consoleStream = process.stdout;
  }
}

const activeLogLevel = (process.env.LOG_LEVEL || 'info') as pino.LevelWithSilent;

export const logger = pino(
  {
    level: activeLogLevel,
    base: { source: 'backend' },
    // Ensure timestamps are formatted cleanly
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    { level: activeLogLevel as pino.Level, stream: consoleStream },
    { level: activeLogLevel as pino.Level, stream: fileStream },
  ])
);

// Flush log stream on process exits to prevent losing buffered entries
const flushAndExit = (code: number) => {
  logger.info({ code }, 'Flush log buffer before exit');
  fileStream.flushSync();
  process.exit(code);
};

process.on('SIGINT', () => flushAndExit(0));
process.on('SIGTERM', () => flushAndExit(0));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception detected');
  fileStream.flushSync();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection detected');
  fileStream.flushSync();
});
