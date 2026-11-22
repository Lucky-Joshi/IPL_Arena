'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getState, postAction } from '../../lib/api';
import AuctionRoom from '../../components/AuctionRoom';
import ManagementRoom from '../../components/ManagementRoom';
import SquadManager from '../../components/SquadManager';
import ProceedingsPanel from '../../components/ProceedingsPanel';
import BreakOverlay from '../../components/BreakOverlay';
import { BID_PHASES, cr, phaseLabel } from '../../lib/format';
import { useAuctioneerVoice } from '../../lib/narration';

const POLL_MS = 800;
const TABS = [
  { id: 'room', label: 'Auction Room' },
  { id: 'war', label: 'My War Room' },
  { id: 'squads', label: 'Squads' },
  { id: 'proceedings', label: 'Proceedings' },
];

export default function AuctionPage() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState('connecting');
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('room');
  const inFlight = useRef(0);
  const alive = useRef(true);
  const toastCounter = useRef(0);
  const toastTimers = useRef([]);

  useAuctioneerVoice(state);

  const notify = useCallback((message, kind = 'error') => {
    const id = ++toastCounter.current;
    setToasts((current) => [...current, { id, message, kind }]);
    const timer = setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5500);
    toastTimers.current.push(timer);
  }, []);

  const refresh = useCallback(
    async (silent = false) => {
      try {
        const snapshot = await getState();
        if (!alive.current) return snapshot;
        setState(snapshot.state);
        setConnection('online');
        if (snapshot.saveError) notify(snapshot.saveError, 'warning');
        return snapshot;
      } catch (error) {
        if (!alive.current) return null;
        setConnection('offline');
        if (!silent) notify(error.message);
        return null;
      }
    },
    [notify]
  );

  useEffect(() => {
    alive.current = true;
    refresh().finally(() => {
      if (alive.current) setLoading(false);
    });
    const timer = setInterval(() => {
      if (inFlight.current > 0) return; // don't race an action in progress
      refresh(true);
    }, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
      toastTimers.current.forEach(clearTimeout);
    };
  }, [refresh]);

  const runAction = useCallback(
    async (action, payload = {}) => {
      inFlight.current += 1;
      setBusy(true);
      try {
        const result = await postAction(action, payload);
        if (result.state && alive.current) setState(result.state);
        if (alive.current) setConnection('online');
        if (action === 'BID' && result.ok && result.state?.leaderId === result.state?.userFranchiseId) {
          notify(`Bid accepted — you lead at ${cr(result.state.currentBid)}.`, 'success');
        }
        return { ok: true, state: result.state };
      } catch (error) {
        if (alive.current) notify(error.message);
        return { ok: false, error: error.message, state: error.state || null };
      } finally {
        inFlight.current -= 1;
        if (alive.current) setBusy(false);
        refresh(true);
      }
    },
    [notify, refresh]
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!state || busy || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (key !== 'b' && key !== 'w') return;
      if (['SETUP', 'COMPLETED', 'SET_BREAK', 'STRATEGY_BREAK'].includes(state.phase)) return;
      const mine = state.franchises?.find((franchise) => franchise.id === state.userFranchiseId);
      if (!mine) return;

      if (key === 'b') {
        if (!state.currentPlayerId || !BID_PHASES.includes(state.phase)) return;
        if (state.leaderId === mine.id || state.withdrawnIds?.includes(mine.id)) return;
        event.preventDefault();
        void runAction('BID', { franchiseId: mine.id });
      } else {
        if (!state.activeBidderIds?.includes(mine.id) || state.withdrawnIds?.includes(mine.id)) return;
        event.preventDefault();
        void runAction('WITHDRAW', { franchiseId: mine.id });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, busy, runAction]);

  if (loading) {
    return (
      <div className="screen-state">
        <div className="loader" />
        <h1>Connecting to the auction room…</h1>
        <p>Opening a live channel to the auction engine.</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="screen-state">
        <h1>No auction in progress</h1>
        <p>Create an auction on the setup screen to open the live room.</p>
        <Link className="btn btn-primary" href="/">Go to setup</Link>
      </div>
    );
  }

  const isBreak = state.phase === 'STRATEGY_BREAK' || state.phase === 'SET_BREAK';
  const isCompleted = state.phase === 'COMPLETED';

  return (
    <div className="auction-page">
      <div className="live-ribbon">
        <span className={`live-dot ${connection === 'online' ? 'is-online' : ''}`} />
        <span>{connection === 'online' ? 'LIVE FEED CONNECTED' : 'RECONNECTING…'}</span>
        <span className="ribbon-divider">|</span>
        <span>{state.format} AUCTION</span>
        <span className="ribbon-divider">|</span>
        <span>{phaseLabel(state.phase)}</span>
        <span className="ribbon-spacer" />
        <span className="ribbon-hint">B = bid · W = withdraw</span>
        <span className="ribbon-divider">|</span>
        <span className="ribbon-clock">{state.clockRunning ? 'CLOCK RUNNING' : 'CLOCK PAUSED'}</span>
      </div>

      {isCompleted && (
        <div className="notice notice-gold">
          <strong>The auction is complete.</strong> All squads and rankings are final.{' '}
          <Link className="inline-link" href="/results">Open the full results report →</Link>
        </div>
      )}

      <nav className="tab-bar" aria-label="Auction sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tab-button ${tab === item.id ? 'is-active' : ''}`}
            onClick={() => setTab(item.id)}
            aria-pressed={tab === item.id}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="tab-content">
        {tab === 'room' && (
          <AuctionRoom state={state} onAction={runAction} busy={busy} />
        )}
        {tab === 'war' && (
          <ManagementRoom state={state} onAction={runAction} busy={busy} />
        )}
        {tab === 'squads' && <SquadManager state={state} />}
        {tab === 'proceedings' && <ProceedingsPanel state={state} />}
      </div>

      {isBreak && (
        <BreakOverlay state={state} onAction={runAction} busy={busy} />
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span className="toast-icon">
              {toast.kind === 'error' ? '!' : toast.kind === 'success' ? '✓' : 'i'}
            </span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
