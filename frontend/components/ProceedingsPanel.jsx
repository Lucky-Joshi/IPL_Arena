'use client';

import { currentStage, phaseLabel, playerById } from '../lib/format';

export default function ProceedingsPanel({ state }) {
  const active = currentStage(state);
  const activePlayers = (active?.playerIds || [])
    .map((id) => playerById(state, id))
    .filter(Boolean);

  return (
    <div className="proceedings-panel">
      <section className="panel proceedings-head">
        <div>
          <span className="eyebrow">{state.format} PROCEEDINGS</span>
          <h2>{active?.title || phaseLabel(state.phase)}</h2>
          <p>Stage {(state.stageIndex ?? 0) + 1} of {state.proceedings?.length || 0} · {phaseLabel(state.phase)}</p>
        </div>
        <div className="proceedings-progress">
          <div style={{ width: `${Math.min(100, (((state.stageIndex ?? 0) + 1) / Math.max(1, state.proceedings?.length || 1)) * 100)}%` }} />
        </div>
      </section>

      <section className="panel proceedings-list-panel">
        <div className="panel-heading"><h3>Run of show</h3><span className="panel-tag">15 / 11 STAGES</span></div>
        <ol className="proceedings-list">
          {(state.proceedings || []).map((stage, index) => {
            const isActive = active?.id === stage.id || index === state.stageIndex;
            return (
              <li
                key={stage.id || index}
                className={`proceeding-item kind-${String(stage.kind || '').toLowerCase()} status-${String(stage.status || 'pending').toLowerCase()} ${isActive ? 'is-active' : ''}`}
              >
                <span className="proceeding-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="proceeding-body">
                  <strong>{stage.title}</strong>
                  <small>{stage.kind} · {stage.playerIds?.length || 0} player(s)</small>
                </div>
                <span className="proceeding-status">{isActive ? 'ACTIVE' : stage.status || 'PENDING'}</span>
              </li>
            );
          })}
        </ol>
      </section>

      {activePlayers.length > 0 && (
        <section className="panel proceedings-players">
          <div className="panel-heading"><h3>Players in this set</h3><span className="panel-tag">{activePlayers.length} LOTS</span></div>
          <div className="proceedings-player-grid">
            {activePlayers.map((player) => (
              <div key={player.id} className="proceedings-player" style={{ '--role-colour': player.role === 'BATTER' ? '#d4af37' : '#55b7e8' }}>
                <strong>{player.name}</strong>
                <small>{player.role} · {player.basePrice} Cr · {player.availability}</small>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
