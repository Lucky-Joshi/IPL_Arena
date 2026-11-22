'use client';

import { categoryLabel, cr, franchiseById, isOverseas, roleColour, roleLabel } from '../lib/format';

const STAT_FIELDS = [
  ['matches', 'Matches'],
  ['runs', 'Runs'],
  ['average', 'Bat average'],
  ['strikeRate', 'Strike rate'],
  ['highestScore', 'Highest score'],
  ['hundreds', 'Hundreds'],
  ['fifties', 'Fifties'],
  ['wickets', 'Wickets'],
  ['bowlingAverage', 'Bowling average'],
  ['economy', 'Economy'],
  ['bestFigures', 'Best figures'],
];

export default function PlayerCard({ player, state }) {
  if (!player) {
    return (
      <section className="panel player-card is-empty">
        <div className="panel-heading">
          <h3>Player on the podium</h3>
          <span className="panel-tag">LOT</span>
        </div>
        <div className="empty-lot">
          <span className="empty-lot-mark">◆</span>
          <p>No lot is currently on the table. The next player will appear here automatically.</p>
        </div>
      </section>
    );
  }

  const owner = franchiseById(state, player.soldTo);
  const nominated = Boolean(state.nominations?.includes(player.id));

  return (
    <section className="panel player-card" style={{ '--role-colour': roleColour(player.role) }}>
      <div className="panel-heading">
        <h3>Player on the podium</h3>
        <span className="panel-tag">LOT {player.id}</span>
      </div>

      <div className="player-identity">
        <div className="player-avatar">{player.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div>
        <div>
          <h2>{player.name}</h2>
          <div className="player-badges">
            <span className="role-badge">{roleLabel(player.role)}</span>
            <span className="soft-badge">{categoryLabel(player.category)}</span>
            <span className="soft-badge">{player.nationality}</span>
            <span className="soft-badge">{player.age} yrs</span>
            {isOverseas(player) && <span className="soft-badge overseas-badge">OVERSEAS</span>}
            {nominated && <span className="soft-badge gold-badge">NOMINATED</span>}
          </div>
        </div>
      </div>

      <div className="player-quick">
        <div><span>BASE PRICE</span><strong>{cr(player.basePrice)}</strong></div>
        <div><span>RATING</span><strong>{player.rating}</strong></div>
        <div><span>EXPERIENCE</span><strong>{player.experience || '—'}</strong></div>
      </div>

      <div className="rating-track" aria-label={`Rating ${player.rating} out of 100`}>
        <div style={{ width: `${Math.min(100, Math.max(0, Number(player.rating) || 0))}%` }} />
      </div>

      <div className="player-styles">
        {player.battingStyle && <span>Batting: {player.battingStyle}</span>}
        {player.bowlingStyle && <span>Bowling: {player.bowlingStyle}</span>}
        {player.subtype && <span>Speciality: {player.subtype}</span>}
      </div>

      <div className="stat-grid">
        {STAT_FIELDS.filter(([key]) => player.stats?.[key] !== null && player.stats?.[key] !== undefined).map(([key, label]) => (
          <div key={key} className="stat-cell">
            <span>{label}</span>
            <strong>{player.stats[key]}</strong>
          </div>
        ))}
      </div>

      {player.availability === 'SOLD' && (
        <div className="sold-banner">
          SOLD to {owner?.name || player.soldTo} · {cr(player.soldPrice)} · {player.soldRound || 'MAIN'}
        </div>
      )}
      {player.availability === 'UNSOLD' && <div className="unsold-banner">UNSOLD — available in the accelerated round</div>}
    </section>
  );
}
