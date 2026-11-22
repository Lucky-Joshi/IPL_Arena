'use client';

import { cr, overseasCount, playerById, squadLimit, statusLabel, strategyLabel } from '../lib/format';

export default function FranchiseFloor({ state }) {
  return (
    <section className="panel franchise-floor">
      <div className="panel-heading">
        <h3>Franchise floor</h3>
        <span className="panel-tag">10 TEAMS · LIVE</span>
      </div>
      <div className="franchise-grid">
        {(state.franchises || []).map((franchise) => {
          const isUser = franchise.id === state.userFranchiseId;
          const isLeader = state.leaderId === franchise.id;
          const isWithdrawn = state.withdrawnIds?.includes(franchise.id);
          const isActive = state.activeBidderIds?.includes(franchise.id);
          const recent = franchise.purchases?.length
            ? franchise.purchases[franchise.purchases.length - 1]
            : null;
          const recentPlayer = recent ? playerById(state, recent.playerId) : null;
          const count = (franchise.squad || []).length;
          const limit = squadLimit(state, franchise);
          const overseas = overseasCount(state, franchise);

          return (
            <article
              key={franchise.id}
              className={`franchise-card ${isUser ? 'is-user' : ''} ${isLeader ? 'is-leading' : ''} ${isWithdrawn ? 'is-withdrawn' : ''} ${isActive ? 'is-active' : ''}`}
              style={{ '--team-primary': franchise.primary, '--team-secondary': franchise.secondary }}
            >
              <div className="franchise-card-head">
                <span className="team-swatch">{franchise.short}</span>
                <div>
                  <strong>{franchise.name}</strong>
                  <small>{strategyLabel(franchise.strategy)}</small>
                </div>
                {isUser && <span className="you-chip">YOU</span>}
              </div>

              <div className="franchise-numbers">
                <div><span>PURSE</span><strong>{cr(franchise.purse)}</strong></div>
                <div><span>SQUAD</span><strong>{count}/{limit}</strong></div>
                <div><span>OVERSEAS</span><strong>{overseas}/{state.config?.maxOverseas ?? 0}</strong></div>
              </div>

              <div className="franchise-progress" aria-hidden="true">
                <div style={{ width: `${Math.min(100, (count / Math.max(1, limit)) * 100)}%` }} />
              </div>

              <div className="franchise-card-foot">
                <span className={`status-pill status-${String(franchise.biddingStatus || 'IDLE').toLowerCase()}`}>
                  {isWithdrawn ? 'WITHDRAWN' : statusLabel(franchise.biddingStatus)}
                </span>
                <span className="recent-purchase">
                  {recentPlayer
                    ? `${recentPlayer.name} · ${cr(recent.price)}`
                    : 'No purchases yet'}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
