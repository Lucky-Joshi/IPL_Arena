'use client';

import { useNarrationControls } from '../lib/narration';
import {
  cr,
  currentStage,
  franchiseById,
  nextIncrement,
  phaseLabel,
  phaseStatus,
  projectedBid,
  roleLabel,
} from '../lib/format';

export default function AuctioneerPodium({ state, player }) {
  const narration = useNarrationControls();
  const leader = franchiseById(state, state.leaderId);
  const latestBid = state.bidHistory?.length ? state.bidHistory[state.bidHistory.length - 1] : null;
  const latestBidder = franchiseById(state, latestBid?.franchiseId);
  const stage = currentStage(state);
  const hammerDown = state.phase === 'SOLD';

  return (
    <section className="podium" aria-label="Auctioneer podium">
      <div className="podium-topline">
        <span className={`on-air ${state.clockRunning ? '' : 'is-paused'}`}>
          <span className="on-air-dot" /> {state.clockRunning ? 'ON AIR' : 'CLOCK PAUSED'}
        </span>
        <span className="podium-phase">{phaseLabel(state.phase)}</span>
        <span className="podium-stage">{stage?.title || 'Awaiting proceedings'}</span>
      </div>

      <div className="podium-core">
        <div className="podium-bid-block">
          <span className="podium-caption">
            {state.currentBid ? 'CURRENT BID' : player ? 'OPENING BID' : 'NO LOT ON THE TABLE'}
          </span>
          <div
            key={`${state.currentBid || 0}-${state.bidHistory?.length || 0}-${state.phase}`}
            className={`podium-amount ${state.currentBid ? 'is-recognised' : ''} ${hammerDown ? 'is-hammered' : ''}`}
          >
            {cr(state.currentBid || (player ? player.basePrice : 0))}
          </div>
          <div className="podium-next">
            <span>
              {state.currentBid ? 'NEXT BID' : 'FIRST BID'} <strong>{cr(projectedBid(state))}</strong>
            </span>
            <span className="podium-increment">
              Increment <strong>{cr(nextIncrement(state.currentBid))}</strong>
            </span>
          </div>
        </div>

        <div className="podium-info">
          <div className="podium-info-row">
            <span>LOT</span>
            <strong>{player ? `${player.name} · ${roleLabel(player.role)}` : '—'}</strong>
          </div>
          <div className="podium-info-row">
            <span>LEADING FRANCHISE</span>
            <strong className={leader ? 'leader-name' : ''}>
              {leader ? `${leader.short} — ${leader.name}` : 'No bids yet'}
            </strong>
          </div>
          <div className="podium-info-row">
            <span>LAST BID</span>
            <strong>
              {latestBid
                ? `${latestBidder?.short || latestBid.franchiseId} · ${cr(latestBid.amount)}`
                : 'Awaiting the first bid'}
            </strong>
          </div>
          <div className="podium-info-row">
            <span>BIDS THIS LOT</span>
            <strong>{state.bidsThisLot ?? 0}</strong>
          </div>
        </div>
      </div>

      <div className="podium-status">
        <span className="status-beacon" />
        <span>{phaseStatus(state)}</span>
        {hammerDown && <span className="hammer-mark">HAMMER DOWN ✦</span>}
      </div>

      <div className="podium-commentary" aria-live="polite">
        <div>
          <span className="eyebrow">AUCTIONEER COMMENTARY</span>
          <p>{state.announcement?.text || 'The auctioneer is preparing the next lot.'}</p>
        </div>
        <div className="podium-voice">
          <span className="eyebrow">VOICE FEED</span>
          <div className="voice-buttons">
            <button
              type="button"
              className={`mini-toggle ${narration.enabled ? 'is-on' : ''}`}
              onClick={narration.toggleEnabled}
              aria-pressed={narration.enabled}
            >
              {narration.enabled ? 'NARRATION ON' : 'NARRATION OFF'}
            </button>
            <button
              type="button"
              className={`mini-toggle ${narration.muted ? 'is-muted' : ''}`}
              onClick={narration.toggleMuted}
              aria-pressed={narration.muted}
              disabled={!narration.enabled}
            >
              {narration.muted ? 'UNMUTE' : 'MUTE'}
            </button>
          </div>
          <small>{narration.supported ? 'Speech synthesis available' : 'Speech not supported in this browser'}</small>
        </div>
      </div>
    </section>
  );
}
