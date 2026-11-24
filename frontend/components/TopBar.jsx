'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { getHealth } from '../lib/api';
import { useNarrationControls } from '../lib/narration';

const LINKS = [
  { href: '/', label: 'Setup' },
  { href: '/auction', label: 'Auction Hall', path: '/auction' },
  { href: '/auction?tab=trades', label: 'Trade Desk', path: '/auction', tab: 'trades' },
  { href: '/results', label: 'Results' },
];

export default function TopBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab');
  const narration = useNarrationControls();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const value = await getHealth();
        if (active) setHealth(value);
      } catch {
        if (active) setHealth({ ok: false, ai: { ok: false }, hasSave: false });
      }
    };
    check();
    const timer = setInterval(check, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const serverOk = Boolean(health?.ok);
  const isLinkActive = (link) => (
    link.path
      ? pathname === link.path && (activeTab || null) === (link.tab || null)
      : pathname === link.href
  );

  return (
    <header className="top-bar">
      <div className="top-bar-inner">
        <Link className="brand" href="/" aria-label="T20 Dynasty home">
          <span className="brand-mark">T20</span>
          <span className="brand-text">
            <strong>DYNASTY</strong>
            <small>Dynasty auction hall</small>
          </span>
        </Link>

        <nav className="top-nav" aria-label="Main navigation">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`top-nav-link ${isLinkActive(link) ? 'is-active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="top-bar-right">
          <div className={`health-pill ${serverOk ? 'is-ok' : 'is-down'}`} title="Backend connection">
            <span className="health-dot" />
            <span>{serverOk ? 'ENGINE ONLINE' : 'ENGINE OFFLINE'}</span>
          </div>
          <div className="narration-controls">
            <button
              type="button"
              className={`mini-toggle ${narration.enabled ? 'is-on' : ''}`}
              onClick={narration.toggleEnabled}
              aria-pressed={narration.enabled}
              title="Turn lead auctioneer narration on or off"
            >
              {narration.enabled ? 'VOICE ON' : 'VOICE OFF'}
            </button>
            <button
              type="button"
              className={`mini-toggle ${narration.muted ? 'is-muted' : ''}`}
              onClick={narration.toggleMuted}
              aria-pressed={narration.muted}
              title="Mute or unmute lead auctioneer narration"
              disabled={!narration.enabled}
            >
              {narration.muted ? 'MUTED' : 'UNMUTED'}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
