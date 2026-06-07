import React from 'react';
import { Amplify } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { authConfig } from './auth-config';

Amplify.configure(authConfig);

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold text-blue-600">
                Welcome to Daily Expense
              </h1>
              <button
                onClick={signOut}
                className="bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded text-sm transition-colors"
              >
                Sign Out
              </button>
            </div>
            <p className="text-gray-600 mb-2">
              Hello, <span className="font-semibold text-gray-800">{user?.signInDetails?.loginId || 'User'}</span>!
            </p>
            <p className="text-gray-600">
              Your skeleton is ready. Start building your financial future!
            </p>
          </div>
        </div>
      )}
    </Authenticator>
  );
}

export default App;
