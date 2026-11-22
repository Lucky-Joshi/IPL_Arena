'use client';

import { useState } from 'react';
import {
  BID_PHASES,
  countdownLabel,
  cr,
  currentStage,
  franchiseById,
  isOverseas,
  overseasCount,
  phaseLabel,
  phaseSecondsRemaining,
  projectedBid,
  squadLimit,
} from '../lib/format';

export default function BidPanel({ state, player, onAction, busy }) {
  const [error, setError] = useState('');
  const me = franchiseById(state, state.userFranchiseId);
  const stage = currentStage(state);

  if (!me) {
    return (
      <section className="panel bid-panel">
        <p>Your franchise could not be found in this auction.</p>
      </section>
    );
  }

  const amount = projectedBid(state);
  const withdrawn = state.withdrawnIds?.includes(me.id);
  const leading = state.leaderId === me.id;
  const bidOpen = BID_PHASES.includes(state.phase);
  const used = state.format === 'MINI' ? (me.purchases || []).length : (me.squad || []).length;
  const limit = squadLimit(state, me);
  const slotsLeft = Math.max(0, limit - used);
  const reserve = slotsLeft * (Number(state.config?.minReservePerSlot) || 0);
  const overseasFull = isOverseas(player) && overseasCount(state, me) >= (Number(state.config?.maxOverseas) || 0);
  const canAfford = (Number(me.purse) || 0) >= amount + reserve;
  const nominated = Boolean(player && state.nominations?.includes(player.id));

  let bidBlock = '';
  if (!bidOpen) {
    bidBlock = state.phase === 'OPENING' || state.phase === 'FINAL_REVIEW'
      ? 'Auctioneer is speaking — bids open with the next lot.'
      : 'Waiting for the next lot on the block.';
  } else if (withdrawn) bidBlock = 'You withdrew from this lot.';
  else if (leading) bidBlock = 'Your franchise is already leading.';
  else if (!player || player.availability === 'SOLD') bidBlock = 'No live lot available.';
  else if (slotsLeft === 0) {
    bidBlock = state.format === 'MINI'
      ? `Mini additions used (${used}/${limit}) — start a new auction with more additions`
      : `Squad full (${used}/${limit})`;
  }
  else if (overseasFull) bidBlock = 'Overseas player limit reached.';
  else if (!canAfford) bidBlock = 'Purse insufficient after slot reserve.';

  const activePhase = !['SETUP', 'COMPLETED', 'SET_BREAK', 'STRATEGY_BREAK'].includes(state.phase);
  const canWithdraw = bidOpen && !withdrawn && Boolean(state.activeBidderIds?.includes(me.id));
  const showContinue = stage?.kind === 'ANNOUNCEMENT' && state.phase !== 'COMPLETED';
  const secondsLeft = phaseSecondsRemaining(state);
  const countdown = countdownLabel(state);
  const urgent = state.phase === 'GOING_TWICE' || (secondsLeft > 0 && secondsLeft <= 2);
  const bidPrompt = bidBlock
    || (state.phase === 'PLAYER_INTRODUCTION' || state.phase === 'ACCELERATED_AUCTION'
      ? 'Bid now — the auctioneer will open the floor'
      : state.phase === 'BIDDING'
        ? 'Place the next legal bid'
        : `${phaseLabel(state.phase)} — raise your paddle`);

  const submit = async (action, payload = {}) => {
    setError('');
    const result = await onAction(action, { franchiseId: me.id, ...payload });
    if (!result.ok) setError(result.error || 'The backend rejected that action.');
  };

  return (
    <section className="panel bid-panel">
      <div className="panel-heading">
        <h3>Your command desk</h3>
        {countdown && (
          <span className={`bid-countdown ${urgent ? 'is-urgent' : ''}`} role="timer" aria-live="off">
            {countdown}
          </span>
        )}
        <span className="panel-tag" style={{ color: me.primary }}>{me.short}</span>
      </div>

      <div className="bid-summary">
        <div><span>YOUR PURSE</span><strong>{cr(me.purse)}</strong></div>
        <div><span>SLOTS LEFT</span><strong>{slotsLeft}</strong></div>
        <div><span>RESERVE</span><strong>{cr(reserve)}</strong></div>
        <div><span>STATUS</span><strong className={`status-${String(me.biddingStatus || 'IDLE').toLowerCase()}`}>{me.biddingStatus || 'IDLE'}</strong></div>
      </div>

      <button
        type="button"
        className={`btn btn-bid ${bidOpen && !bidBlock ? 'is-open' : ''} ${urgent ? 'is-urgent' : ''}`}
        disabled={busy || Boolean(bidBlock)}
        onClick={() => submit('BID', { amount })}
        title={bidBlock || `Bid ${cr(amount)}`}
      >
        <span>BID {cr(amount)}</span>
        <small>{bidPrompt}</small>
      </button>

      <div className="bid-action-grid">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || !canWithdraw}
          onClick={() => submit('WITHDRAW')}
        >
          Withdraw
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || state.phase !== 'PLAYER_INTRODUCTION'}
          onClick={() => submit('OPEN_BIDDING')}
        >
          Open Bidding
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || !activePhase}
          onClick={() => submit('CALL_BREAK')}
        >
          Call Strategy Break
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || !activePhase}
          onClick={() => submit(state.clockRunning ? 'PAUSE' : 'UNPAUSE')}
        >
          {state.clockRunning ? 'Pause Clock' : 'Resume Clock'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || !activePhase}
          onClick={() => submit('NEXT')}
        >
          Next →
        </button>
        {showContinue && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => submit('CONTINUE')}
          >
            Continue ceremony
          </button>
        )}
        {state.phase === 'ACCELERATED_AUCTION' && player && (
          <button
            type="button"
            className={`btn ${nominated ? 'btn-gold' : 'btn-ghost'}`}
            disabled={busy}
            onClick={() => submit('NOMINATE', { playerId: player.id, selected: !nominated })}
          >
            {nominated ? 'Remove nomination' : 'Nominate player'}
          </button>
        )}
      </div>

      {error && <div className="inline-error" role="alert">{error}</div>}
      <p className="bid-footnote">
        All bids pass through the same validation as AI bidders — purse, overseas slots, squad
        limits, reserve funds and lot status are enforced by the backend.
      </p>
    </section>
  );
}
