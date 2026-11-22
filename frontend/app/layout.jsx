import './globals.css';
import TopBar from '../components/TopBar';
import { NarrationProvider } from '../lib/narration';

export const metadata = {
  title: 'IPL Auction Arena',
  description: 'A broadcast-style IPL franchise auction — ten teams, one room, every decision yours.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <NarrationProvider>
          <div className="app-shell">
            <TopBar />
            <main className="app-main">{children}</main>
            <footer className="app-footer">
              <span>IPL Auction Arena</span>
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
