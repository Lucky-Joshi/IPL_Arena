'use client';

import {
  cr,
  franchiseById,
  isOverseas,
  overseasCount,
  playerById,
  roleColour,
  roleCounts,
  roleLabel,
  ROLES,
  squadLimit,
} from '../lib/format';

export default function BreakOverlay({ state, onAction, busy }) {
  const me = franchiseById(state, state.userFranchiseId);
  if (!me) return null;

  const squad = (me.squad || [])
    .map((id) => playerById(state, id))
    .filter(Boolean);
  const counts = roleCounts(state, me);
  const benchmark = state.format === 'MINI'
    ? { BATTER: 2, BOWLER: 2, ALLROUNDER: 1, WICKETKEEPER: 1 }
    : { BATTER: 6, BOWLER: 6, ALLROUNDER: 4, WICKETKEEPER: 2 };
  const gaps = ROLES.filter((role) => counts[role] < benchmark[role]);
  const used = state.format === 'MINI' ? (me.purchases || []).length : squad.length;
  const limit = squadLimit(state, me);
  const slotsLeft = Math.max(0, limit - used);
  const reserve = slotsLeft * (Number(state.config?.minReservePerSlot) || 0);
  const spendable = Math.max(0, (Number(me.purse) || 0) - reserve);
  const overseas = overseasCount(state, me);
  const available = (state.players || []).filter((player) => player.availability === 'AVAILABLE');
  const upcoming = (state.proceedings || []).slice((state.stageIndex ?? 0) + 1).filter((stage) => stage.kind === 'SET' || stage.kind === 'ACCELERATED');
  const isStrategy = state.phase === 'STRATEGY_BREAK';

  return (
    <div className="break-backdrop" role="dialog" aria-modal="true" aria-label="Strategy break">
      <div className="break-card">
        <div className="break-header">
          <div>
            <span className="eyebrow">THE ROOM IS PAUSED · {state.phase.replace(/_/g, ' ')}</span>
            <h2>{isStrategy ? 'Strategy Break' : 'Set Break'}</h2>
            <p>Review your squad, protect your purse and plan the next set. Bidding is locked until you resume.</p>
          </div>
          <span className="break-mark">II</span>
        </div>

        <div className="break-grid">
          <section className="break-block">
            <h3>Squad review · {me.short}</h3>
            <div className="break-squad-counts">
              <span>{squad.length} players</span>
              <span>{used}/{limit} slots used</span>
              <span>{overseas}/{state.config?.maxOverseas ?? 0} overseas</span>
            </div>
            <div className="break-roles">
              {ROLES.map((role) => (
                <div key={role} style={{ '--role-colour': roleColour(role) }}>
                  <span>{roleLabel(role)}</span><strong>{counts[role]}</strong>
                </div>
              ))}
            </div>
            <div className="break-squad-list">
              {squad.length === 0 && <p>No players in the squad yet.</p>}
              {squad.map((player) => (
                <span key={player.id} className="break-player">
                  {player.name} <small>{isOverseas(player) ? 'OS' : roleLabel(player.role).slice(0, 3)}</small>
                </span>
              ))}
            </div>
          </section>

          <section className="break-block">
            <h3>Purse analysis</h3>
            <div className="break-money">
              <div><span>Remaining purse</span><strong>{cr(me.purse)}</strong></div>
              <div><span>Reserve for {slotsLeft} slot(s)</span><strong>{cr(reserve)}</strong></div>
              <div className="break-money-focus"><span>Available to spend</span><strong>{cr(spendable)}</strong></div>
            </div>
            <h4>Role gaps</h4>
            {gaps.length === 0
              ? <p className="break-ok">
                  All benchmark roles covered — this is guidance only. You can still bid while squad slots remain.
                </p>
              : (
                <ul className="break-gaps">
                  {gaps.map((role) => (
                    <li key={role}>{roleLabel(role)} — {counts[role]}/{benchmark[role]}</li>
                  ))}
                </ul>
              )}
          </section>

          <section className="break-block">
            <h3>Remaining pool</h3>
            <div className="break-pool-counts">
              {ROLES.map((role) => (
                <span key={role} style={{ '--role-colour': roleColour(role) }}>
                  {roleLabel(role)} <strong>{available.filter((player) => player.role === role).length}</strong>
                </span>
              ))}
            </div>
            <p className="break-pool-total">{available.length} player(s) still available.</p>
            <h4>Upcoming sets</h4>
            <ul className="break-upcoming">
              {upcoming.length === 0 && <li>No further sets — final review is next.</li>}
              {upcoming.map((stage, index) => (
                <li key={stage.id || index}>
                  {stage.title} <span>{stage.playerIds?.length || 0} lots</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="break-actions">
          <span>Clock is stopped. Nothing changes until you resume.</span>
          <button
            type="button"
            className="btn btn-primary btn-large"
            disabled={busy}
            onClick={() => onAction('RESUME_BREAK')}
          >
            {busy ? 'Resuming…' : 'Resume auction →'}
          </button>
        </div>
      </div>
    </div>
  );
}
