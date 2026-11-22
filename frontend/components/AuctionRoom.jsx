'use client';

import { currentStage, phaseLabel, playerById } from '../lib/format';
import AuctioneerPodium from './AuctioneerPodium';
import PlayerCard from './PlayerCard';
import BidPanel from './BidPanel';
import FranchiseFloor from './FranchiseFloor';
import EventFeed from './EventFeed';

export default function AuctionRoom({ state, onAction, busy }) {
  const player = playerById(state, state.currentPlayerId);
  const stage = currentStage(state);
  const soldCount = state.players?.filter((item) => item.availability === 'SOLD').length || 0;

  return (
    <div className="room-grid">
      <div className="room-main">
        <div className="stage-strip">
          <div>
            <span className="eyebrow">NOW IN PROCEEDINGS</span>
            <strong>{stage?.title || phaseLabel(state.phase)}</strong>
          </div>
          <span className="stage-kind">{stage?.kind || '—'}</span>
          <span className="stage-count">
            Stage {(state.stageIndex ?? 0) + 1} / {state.proceedings?.length || 0}
          </span>
          <span className="stage-count">{soldCount} sold</span>
        </div>

        <AuctioneerPodium state={state} player={player} />

        <div className="lot-grid">
          <PlayerCard player={player} state={state} />
          <BidPanel state={state} player={player} onAction={onAction} busy={busy} />
        </div>

        <FranchiseFloor state={state} />
      </div>

      <aside className="room-side">
        <EventFeed state={state} />
        <section className="panel rules-panel">
          <div className="panel-heading">
            <h3>Bid increments</h3>
            <span className="panel-tag">RULE BOOK</span>
          </div>
          <ul className="rules-list">
            <li><span>Under ₹2 Cr</span><strong>+ ₹0.25 Cr</strong></li>
            <li><span>₹2 Cr – ₹5 Cr</span><strong>+ ₹0.5 Cr</strong></li>
            <li><span>₹5 Cr – ₹10 Cr</span><strong>+ ₹0.5 Cr</strong></li>
            <li><span>Above ₹10 Cr</span><strong>+ ₹1 Cr</strong></li>
          </ul>
          <p className="rules-foot">
            First bid on a lot must match the base price. Withdrawn franchises cannot re-enter.
          </p>
        </section>
      </aside>
    </div>
  );
}
