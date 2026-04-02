import React from 'react';
import { Navbar } from './Layout';

export const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <Navbar />
      
      <main className="flex-1 pt-20 min-h-screen transition-all duration-300">
        <div className="p-4 sm:p-6 md:p-10 max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};
