'use client';

import { useState } from 'react';
import {
  cr,
  currentStage,
  formatTime,
  franchiseById,
  overseasCount,
  playerById,
  roleColour,
  roleCounts,
  roleLabel,
  ROLES,
  squadLimit,
} from '../lib/format';

const BENCHMARKS = {
  MEGA: { BATTER: 6, BOWLER: 6, ALLROUNDER: 4, WICKETKEEPER: 2 },
  MINI: { BATTER: 2, BOWLER: 2, ALLROUNDER: 1, WICKETKEEPER: 1 },
};

export default function ManagementRoom({ state, onAction, busy }) {
  const [error, setError] = useState('');
  const me = franchiseById(state, state.userFranchiseId);

  if (!me) return <div className="panel">Your management room is unavailable.</div>;

  const counts = roleCounts(state, me);
  const benchmark = BENCHMARKS[state.format] || BENCHMARKS.MEGA;
  const gaps = ROLES.filter((role) => counts[role] < benchmark[role]);
  const pool = (state.players || [])
    .filter((player) => player.availability === 'AVAILABLE')
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const targetPool = pool.filter((player) => (me.targets || []).includes(player.role)).slice(0, 8);
  const displayedPool = targetPool.length ? targetPool : pool.slice(0, 8);
  const currentPlayer = playerById(state, state.currentPlayerId);
  const overseas = overseasCount(state, me);
  const maxOverseas = Number(state.config?.maxOverseas) || 0;
  const used = state.format === 'MINI' ? (me.purchases || []).length : (me.squad || []).length;
  const limit = squadLimit(state, me);
  const slotsLeft = Math.max(0, limit - used);
  const reserve = slotsLeft * (Number(state.config?.minReservePerSlot) || 0);
  const spendable = Math.max(0, (Number(me.purse) || 0) - reserve);
  const meetingAllowed = !busy && !['SETUP', 'COMPLETED', 'SET_BREAK', 'STRATEGY_BREAK'].includes(state.phase);

  const discussions = [
    ...(state.conversations || []),
    ...(me.discussions || []).map((entry) => ({ ...entry, internal: true })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  const recommendations = [];
  if (gaps.length) {
    recommendations.push(`Fill the ${gaps.map(roleLabel).join(', ')} gap${gaps.length > 1 ? 's' : ''} before the remaining sets close.`);
  }
  if (overseas >= maxOverseas) {
    recommendations.push('Overseas quota is full — prioritise Indian players from here on.');
  } else if (maxOverseas - overseas <= 2) {
    recommendations.push(`Only ${maxOverseas - overseas} overseas slot(s) left; spend them on genuine match-winners.`);
  }
  if (spendable < 5) {
    recommendations.push('Purse is tight after the slot reserve — look for value rather than marquee names.');
  }
  if (currentPlayer && (me.targets || []).includes(currentPlayer.role)) {
    recommendations.push(`${currentPlayer.name} fits a declared target role (${roleLabel(currentPlayer.role)}).`);
  }
  if (pool.length < 15) {
    recommendations.push('The available pool is thinning — the accelerated round will decide the leftovers.');
  }
  if (!recommendations.length) {
    recommendations.push('Squad shape looks balanced. Stay disciplined and react to price, not noise.');
  }

  const callMeeting = async () => {
    setError('');
    const result = await onAction('MEETING', { franchiseId: me.id });
    if (!result.ok) setError(result.error || 'The meeting could not be called.');
  };

  return (
    <div className="war-room">
      <section className="panel war-hero">
        <div>
          <span className="eyebrow">MY WAR ROOM · {me.short}</span>
          <h2>{me.name}</h2>
          <p>
            Owner {me.owner} · Strategy {String(me.strategy || '').toLowerCase()} ·
            Current stage: {currentStage(state)?.title || '—'}
          </p>
        </div>
        <div className="war-hero-stats">
          <div><span>PURSE</span><strong>{cr(me.purse)}</strong></div>
          <div><span>SQUAD</span><strong>{used}/{limit}</strong></div>
          <div><span>OVERSEAS</span><strong>{overseas}/{maxOverseas}</strong></div>
          <div><span>SLOTS LEFT</span><strong>{slotsLeft}</strong></div>
        </div>
        <button type="button" className="btn btn-gold" onClick={callMeeting} disabled={!meetingAllowed}>
          Call Management Meeting
        </button>
      </section>

      {error && <div className="inline-error" role="alert">{error}</div>}

      <div className="war-grid">
        <section className="panel">
          <div className="panel-heading"><h3>Discussion feed</h3><span className="panel-tag">PUBLIC + INTERNAL</span></div>
          <div className="discussion-list">
            {discussions.length === 0 && <p className="feed-empty">No discussions recorded yet. Call a meeting to bring the room in.</p>}
            {discussions.map((entry, index) => (
              <div key={entry.id || `${entry.at}-${index}`} className={`discussion-row ${entry.internal ? 'is-internal' : ''}`}>
                <div className="discussion-avatar">{String(entry.author || '?' ).slice(0, 2).toUpperCase()}</div>
                <div>
                  <div className="discussion-meta">
                    <strong>{entry.author || 'Management'}</strong>
                    <time>{formatTime(entry.at)}</time>
                    {entry.internal && <span className="soft-badge">INTERNAL</span>}
                  </div>
                  <p>{entry.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading"><h3>Squad analysis</h3><span className="panel-tag">ROLE GAPS</span></div>
          <div className="gap-list">
            {ROLES.map((role) => {
              const short = counts[role] < benchmark[role];
              return (
                <div key={role} className={`gap-row ${short ? 'is-gap' : ''}`} style={{ '--role-colour': roleColour(role) }}>
                  <div className="gap-head">
                    <strong>{roleLabel(role)}</strong>
                    <span>{counts[role]} / {benchmark[role]} benchmark</span>
                  </div>
                  <div className="gap-track">
                    <div style={{ width: `${Math.min(100, (counts[role] / Math.max(1, benchmark[role])) * 100)}%` }} />
                  </div>
                  {short && <small>Priority area</small>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading"><h3>Purse allocation</h3><span className="panel-tag">BUDGET</span></div>
          <div className="allocation">
            <div><span>Starting purse</span><strong>{cr(state.config?.startingPurse)}</strong></div>
            <div><span>Spent so far</span><strong>{cr((Number(state.config?.startingPurse) || 0) - (Number(me.purse) || 0))}</strong></div>
            <div><span>Remaining</span><strong>{cr(me.purse)}</strong></div>
            <div><span>Reserved for {slotsLeft} slot(s)</span><strong>{cr(reserve)}</strong></div>
            <div className="allocation-focus"><span>Available to bid</span><strong>{cr(spendable)}</strong></div>
          </div>
          <div className="allocation-bar">
            <div style={{ width: `${Math.min(100, ((Number(state.config?.startingPurse) || 0) ? (1 - (Number(me.purse) || 0) / (Number(state.config.startingPurse))) * 100 : 0))}%` }} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading"><h3>Current targets & pool</h3><span className="panel-tag">SCOUTING</span></div>
          <div className="target-tags">
            {(me.targets || []).length === 0 && <span className="soft-badge">No declared targets</span>}
            {(me.targets || []).map((role) => (
              <span key={role} className="target-chip" style={{ '--role-colour': roleColour(role) }}>{roleLabel(role)}</span>
            ))}
          </div>
          <div className="pool-list">
            {displayedPool.map((player) => (
              <div key={player.id} className="pool-row" style={{ '--role-colour': roleColour(player.role) }}>
                <span className="pool-rating">{player.rating}</span>
                <div>
                  <strong>{player.name}</strong>
                  <small>{roleLabel(player.role)} · {player.nationality} · base {cr(player.basePrice)}</small>
                </div>
                {(me.targets || []).includes(player.role) && <span className="gold-badge">TARGET</span>}
              </div>
            ))}
            {displayedPool.length === 0 && <p className="feed-empty">No available players remain in the pool.</p>}
          </div>
          <p className="pool-count">{pool.length} player(s) still available</p>
        </section>
      </div>

      <section className="panel recommendations">
        <div className="panel-heading"><h3>Recommendations</h3><span className="panel-tag">FROM YOUR ANALYSTS</span></div>
        <ol>
          {recommendations.map((item) => <li key={item}>{item}</li>)}
        </ol>
      </section>
    </div>
  );
}
