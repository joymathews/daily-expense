import React, { useState, useEffect } from 'react';

export interface ServerWarmupGateProps {
  children: React.ReactNode;
  healthEndpoint?: string;
  getHealthUrl?: () => string;
}

let isServerReadyCached = false;

export const resetServerReadyCache = () => {
  isServerReadyCached = false;
};

export const ServerWarmupGate: React.FC<ServerWarmupGateProps> = ({
  children,
  healthEndpoint = '/api/health',
  getHealthUrl,
}) => {
  const initialReady =
    typeof globalThis !== 'undefined' && (globalThis as any).__SERVER_HEALTHY__ !== undefined
      ? !!(globalThis as any).__SERVER_HEALTHY__
      : isServerReadyCached;

  const [isReady, setIsReady] = useState<boolean>(initialReady);
  const [serverStep, setServerStep] = useState<'connecting' | 'server_up' | 'ready'>('connecting');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (isReady) return;

    let timer: any = null;
    let pollTimeout: any = null;
    let isMounted = true;

    // Elapsed seconds counter for transparency
    timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    const checkServerHealth = async () => {
      try {
        const targetUrl = getHealthUrl ? getHealthUrl() : healthEndpoint;
        const res = await fetch(targetUrl);
        if (!isMounted) return;

        if (res.status === 200) {
          const data = await res.json().catch(() => ({}));
          if (data.database !== 'disconnected' && data.server !== 'booting') {
            isServerReadyCached = true;
            setServerStep('ready');
            setIsReady(true);
            return;
          }
        } else if (res.status === 503) {
          setServerStep('server_up');
        } else {
          setServerStep('connecting');
        }
      } catch (_err: any) {
        if (!isMounted) return;
        setServerStep('connecting');
      }

      // Retry every 2.5 seconds (or 100ms in test environments) until ready
      const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
      const retryDelay = isTestEnv ? 100 : 2500;

      if (isMounted) {
        pollTimeout = setTimeout(checkServerHealth, retryDelay);
      }
    };

    checkServerHealth();

    return () => {
      isMounted = false;
      if (timer) clearInterval(timer);
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, [isReady, healthEndpoint, getHealthUrl]);

  if (isReady) {
    return <>{children}</>;
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950 text-slate-100 flex flex-col items-center justify-center p-6"
      data-testid="server-warmup-gate"
    >
      <div className="w-full max-w-sm bg-slate-850/80 backdrop-blur-xl border border-indigo-500/20 rounded-3xl p-7 shadow-2xl flex flex-col items-center text-center space-y-6">
        
        {/* Animated Pulsing Icon */}
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-2xl shadow-lg shadow-indigo-500/30">
            ⚡
          </div>
          <div className="absolute -inset-1 rounded-2xl bg-indigo-500/20 animate-ping opacity-75"></div>
        </div>

        <div>
          <h2 className="text-xl font-black tracking-tight text-white Outfit" data-testid="warmup-title">
            Resuming Cloud Services
          </h2>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
            The server and database are waking up from zero-cost sleep mode. This usually takes ~15–25 seconds.
          </p>
        </div>

        {/* Step-by-Step Progress Checklist */}
        <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-4 text-left space-y-3 text-xs">
          
          {/* Step 1: Container */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              {serverStep === 'connecting' ? (
                <div className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin"></div>
              ) : (
                <span className="text-emerald-400 font-bold">✓</span>
              )}
              <span className={serverStep === 'connecting' ? 'text-indigo-300 font-bold' : 'text-slate-300 font-medium'}>
                1. Container Server
              </span>
            </div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              {serverStep === 'connecting' ? 'Booting...' : 'Ready'}
            </span>
          </div>

          {/* Step 2: Database */}
          <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5">
            <div className="flex items-center space-x-2.5">
              {serverStep === 'server_up' ? (
                <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"></div>
              ) : serverStep === 'ready' ? (
                <span className="text-emerald-400 font-bold">✓</span>
              ) : (
                <span className="text-slate-600">○</span>
              )}
              <span className={serverStep === 'server_up' ? 'text-amber-300 font-bold' : serverStep === 'ready' ? 'text-slate-300 font-medium' : 'text-slate-500'}>
                2. SQL Database
              </span>
            </div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              {serverStep === 'ready' ? 'Connected' : serverStep === 'server_up' ? 'Resuming...' : 'Waiting'}
            </span>
          </div>
        </div>

        {/* Elapsed Timer Pill */}
        <div className="inline-flex items-center space-x-2 bg-indigo-950/60 border border-indigo-800/40 px-3.5 py-1.5 rounded-full text-3xs font-semibold text-indigo-300">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
          <span>Elapsed: {elapsedSeconds}s</span>
        </div>

      </div>
    </div>
  );
};
