import { Suspense } from 'react';
import './globals.css';
import TopBar from '../components/TopBar';
import { NarrationProvider } from '../lib/narration';

export const metadata = {
  title: 'T20 Dynasty — Build Your Team. Command the Game.',
  description: 'A premium T20 franchise auction simulator — ten franchises, one hall, every decision yours.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <NarrationProvider>
          <div className="app-shell">
            <Suspense fallback={<div className="top-bar"><div className="top-bar-inner" /></div>}>
              <TopBar />
            </Suspense>
            <main className="app-main">{children}</main>
            <footer className="app-footer">
              <span>T20 Dynasty</span>
              <span className="footer-sep">/</span>
              <span>Broadcast control room</span>
              <span className="footer-sep">/</span>
              <span>Backend powered by the authoritative auction engine</span>
            </footer>
          </div>
        </NarrationProvider>
      </body>
    </html>
  );
}
