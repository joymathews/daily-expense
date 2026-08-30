import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ServerWarmupGate } from '@daily-expense/financial-core';
import { getApiUrl } from './api-config';
import { NavigationDrawer } from './components/NavigationDrawer';
import { SummaryCompass } from './pages/SummaryCompass';
import { IngestionTriage } from './pages/IngestionTriage';
import { GoldLedger } from './pages/GoldLedger';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'dummy-google-client-id';

export const App: React.FC = () => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <Authenticator>
        {({ signOut, user }) => (
          <ServerWarmupGate getHealthUrl={() => getApiUrl('/api/health')}>
            <BrowserRouter>
              <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col justify-between selection:bg-indigo-100 selection:text-indigo-900">
                
                {/* Top Minimal Brand Bar with Hamburger Menu */}
                <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-slate-200/80 px-4 py-3 pt-safe flex items-center justify-between shadow-xs">
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => setIsDrawerOpen(true)}
                      className="p-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 active:scale-95 transition-all shadow-2xs cursor-pointer flex items-center justify-center text-base"
                      data-testid="hamburger-menu-btn"
                      aria-label="Open Navigation Menu"
                    >
                      ☰
                    </button>
                    <div className="flex items-center space-x-2">
                      <span className="text-lg font-black tracking-tight text-indigo-600 Outfit">
                        DAILY EXPENSE
                      </span>
                      <span className="bg-indigo-50 border border-indigo-200/80 text-indigo-700 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md shadow-2xs">
                        Mobile
                      </span>
                    </div>
                  </div>
                  
                  {user && (
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={signOut}
                        className="text-3xs font-bold text-slate-600 hover:text-rose-600 hover:bg-rose-50 px-2.5 py-1 rounded-lg bg-white border border-slate-200 transition-colors active:scale-95 shadow-2xs"
                        data-testid="mobile-signout-btn"
                      >
                        Log Out
                      </button>
                    </div>
                  )}
                </header>

                {/* Navigation Drawer */}
                <NavigationDrawer
                  isOpen={isDrawerOpen}
                  onClose={() => setIsDrawerOpen(false)}
                  user={user}
                  onSignOut={signOut}
                />

                {/* Main Content Area */}
                <main className="flex-1 w-full max-w-md mx-auto">
                  <Routes>
                    <Route path="/" element={<SummaryCompass />} />
                    <Route path="/triage" element={<IngestionTriage />} />
                    <Route path="/ledger" element={<GoldLedger />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </main>

              </div>
            </BrowserRouter>
          </ServerWarmupGate>
        )}
      </Authenticator>
    </GoogleOAuthProvider>
  );
};

export default App;
