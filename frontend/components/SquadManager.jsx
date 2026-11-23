'use client';

import { useMemo, useState } from 'react';
import {
  cr,
  isOverseas,
  playerById,
  roleColour,
  roleCounts,
  retentionCost,
  roleLabel,
  ROLES,
  squadLimit,
} from '../lib/format';

const FILTERS = [
  { id: 'role', options: [
    { id: 'ALL', label: 'All roles' },
    ...ROLES.map((role) => ({ id: role, label: `${roleLabel(role)}s` })),
  ] },
  { id: 'origin', options: [
    { id: 'ALL', label: 'Indian + overseas' },
    { id: 'INDIAN', label: 'Indian' },
    { id: 'OVERSEAS', label: 'Overseas' },
  ] },
  { id: 'source', options: [
    { id: 'ALL', label: 'Retained + purchased + traded' },
    { id: 'EXISTING', label: 'Retained' },
    { id: 'PURCHASED', label: 'Purchased' },
    { id: 'TRADED', label: 'Traded in' },
  ] },
];

export default function SquadManager({ state }) {
  const [franchiseId, setFranchiseId] = useState(state.userFranchiseId || state.franchises?.[0]?.id);
  const [filters, setFilters] = useState({ role: 'ALL', origin: 'ALL', source: 'ALL' });
  const franchise = state.franchises?.find((entry) => entry.id === franchiseId) || state.franchises?.[0];

  const entries = useMemo(() => {
    if (!franchise || !state) return [];
    const map = new Map();
    const squadSet = new Set(franchise.squad || []);
    const retentionByPlayer = new Map((franchise.retentions || []).map((entry) => [entry.playerId, Number(entry.cost) || 0]));
    for (const id of franchise.existing || []) {
      const player = playerById(state, id);
      if (player && squadSet.has(id)) {
        const price = retentionByPlayer.get(id) ?? Number(player.retentionCost) ?? retentionCost(player);
        map.set(id, { ...player, source: 'EXISTING', price, round: null });
      }
    }
    for (const purchase of franchise.purchases || []) {
      const player = playerById(state, purchase.playerId);
      if (player && squadSet.has(purchase.playerId)) {
        map.set(purchase.playerId, {
          ...player,
          source: 'PURCHASED',
          price: purchase.price,
          round: purchase.round,
        });
      }
    }
    for (const entry of franchise.tradedIn || []) {
      const player = playerById(state, entry.playerId);
      if (player && (franchise.squad || []).includes(entry.playerId)) {
        map.set(entry.playerId, {
          ...player,
          source: 'TRADED',
          price: Number(entry.fee) || Number(player.salary) || 0,
          round: null,
        });
      }
    }
    return [...map.values()];
  }, [franchise, state]);

  if (!franchise) return <div className="panel">No squad data available.</div>;

  const visible = entries.filter((player) => {
    if (filters.role !== 'ALL' && player.role !== filters.role) return false;
    if (filters.origin === 'INDIAN' && isOverseas(player)) return false;
    if (filters.origin === 'OVERSEAS' && !isOverseas(player)) return false;
    if (filters.source !== 'ALL' && player.source !== filters.source) return false;
    return true;
  }).sort((a, b) => a.role.localeCompare(b.role) || (b.rating || 0) - (a.rating || 0));

  const counts = roleCounts(state, franchise);
  const overseas = entries.filter(isOverseas).length;
  const existingCount = entries.filter((player) => player.source === 'EXISTING').length;
  const purchasedCount = entries.filter((player) => player.source === 'PURCHASED').length;
  const tradedCount = entries.filter((player) => player.source === 'TRADED').length;
  const auctionSpent = (franchise.purchases || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const retentionSpent = Number(franchise.retentionSpent) || 0;
  const spent = retentionSpent + auctionSpent - (Number(franchise.tradeCashDelta) || 0);
  const limit = squadLimit(state, franchise);
  const battingDepth = counts.BATTER + counts.WICKETKEEPER;
  const bowlingDepth = counts.BOWLER + counts.ALLROUNDER;
  const avgRating = entries.length
    ? Math.round(entries.reduce((sum, player) => sum + (Number(player.rating) || 0), 0) / entries.length)
    : 0;

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="squad-manager">
      <section className="panel squad-header">
        <div>
          <span className="eyebrow">SQUAD INSPECTOR</span>
          <h2 style={{ color: franchise.primary }}>{franchise.name}</h2>
          <p>Owner {franchise.owner} · Strategy {String(franchise.strategy || '').toLowerCase()}</p>
        </div>
        <label className="squad-select">
          <span>View franchise</span>
          <select value={franchiseId} onChange={(event) => setFranchiseId(event.target.value)}>
            {(state.franchises || []).map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name} ({entry.short})</option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel balance-panel">
        <div className="panel-heading"><h3>Balance assessment</h3><span className="panel-tag">SQUAD HEALTH</span></div>
        <div className="balance-grid">
          <div><span>PLAYERS</span><strong>{entries.length}/{limit}</strong></div>
          <div><span>EXISTING</span><strong>{existingCount}</strong></div>
          <div><span>PURCHASED</span><strong>{purchasedCount}</strong></div>
          <div><span>TRADED IN</span><strong>{tradedCount}</strong></div>
          <div><span>OVERSEAS</span><strong>{overseas}/{state.config?.maxOverseas ?? 0}</strong></div>
          <div><span>SPEND</span><strong>{cr(spent)}</strong></div>
          <div><span>AVG RATING</span><strong>{avgRating}</strong></div>
        </div>
        <div className="balance-roles">
          {ROLES.map((role) => (
            <div key={role} style={{ '--role-colour': roleColour(role) }}>
              <span>{roleLabel(role)}</span>
              <strong>{counts[role]}</strong>
              <div className="balance-track"><div style={{ width: `${Math.min(100, counts[role] * 12)}%` }} /></div>
            </div>
          ))}
        </div>
        <p className="balance-note">
          Batting depth (batters + keepers): <strong>{battingDepth}</strong> ·
          Bowling depth (bowlers + all-rounders): <strong>{bowlingDepth}</strong> ·
          {entries.length < (Number(state.config?.minSquad) || 0)
            ? ` ${(Number(state.config?.minSquad) || 0) - entries.length} more player(s) needed to reach the minimum squad.`
            : ' Minimum squad requirement met.'}
        </p>
      </section>

      <section className="panel roster-panel">
        <div className="panel-heading"><h3>Squad roster</h3><span className="panel-tag">{visible.length} SHOWN</span></div>
        <div className="filter-groups">
          {FILTERS.map((group) => (
            <div key={group.id} className="filter-group">
              <span className="filter-label">{group.id}</span>
              <div className="filter-buttons">
                {group.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`filter-chip ${filters[group.id] === option.id ? 'is-active' : ''}`}
                    onClick={() => setFilter(group.id, option.id)}
                    aria-pressed={filters[group.id] === option.id}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="roster-table-wrap">
          <table className="roster-table">
            <thead>
              <tr><th>Player</th><th>Role</th><th>Country</th><th>Rating</th><th>Source</th><th>Price</th></tr>
            </thead>
            <tbody>
              {visible.map((player) => (
                <tr key={player.id} style={{ '--role-colour': roleColour(player.role) }}>
                  <td><strong>{player.name}</strong><small>{player.id} · {player.age} yrs</small></td>
                  <td><span className="role-badge">{roleLabel(player.role)}</span></td>
                  <td>{player.nationality}</td>
                  <td>{player.rating}</td>
                  <td>
                    <span className={`source-badge source-${player.source.toLowerCase()}`}>
                      {player.source === 'EXISTING' ? 'RETAINED'
                        : player.source === 'TRADED' ? 'TRADED IN'
                          : `PURCHASED${player.round ? ` · ${player.round}` : ''}`}
                    </span>
                  </td>
                  <td>{player.price > 0 ? cr(player.price) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p className="feed-empty">No players match these filters.</p>}
        </div>
      </section>
    </div>
  );
}
