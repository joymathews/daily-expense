import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import '@aws-amplify/ui-react/styles.css';

import { authConfig } from './auth-config';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import DataIngestion from './pages/DataIngestion';
import TransactionPipeline from './pages/TransactionPipeline';
import GoldTransactions from './pages/GoldTransactions';

Amplify.configure(authConfig);

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function App() {
  const renderLayout = (signOut: () => void, userEmail: string) => (
    <div className="min-h-screen bg-[#FDFDFF] flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900">
      <Navbar onSignOut={signOut} />
      <main className="flex-grow flex items-start justify-center px-4 sm:px-6 lg:px-8 py-10">
        <Routes>
          <Route path="/" element={<Dashboard userEmail={userEmail} />} />
          <Route path="/ingestion" element={<DataIngestion />} />
          <Route path="/pipeline" element={<TransactionPipeline />} />
          <Route path="/transactions" element={<GoldTransactions />} />
          <Route path="/gmail" element={<Navigate to="/ingestion" replace />} />
        </Routes>
      </main>
      
      <footer className="py-8 text-center text-gray-400 text-xs border-t border-gray-50 bg-white">
        <p>&copy; 2026 Daily Expense. Built with SOLID principles and Clean Code.</p>
      </footer>
    </div>
  );

  return (
    <BrowserRouter>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <Authenticator>
          {({ signOut, user }) => 
            renderLayout(signOut!, user?.signInDetails?.loginId || 'User')
          }
        </Authenticator>
      </GoogleOAuthProvider>
    </BrowserRouter>
  );
}

export default App;
