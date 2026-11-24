'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getState, postAction } from '../lib/api';
import { catalogueFromState } from '../lib/franchises';
import {
  cappedLabel,
  cr,
  formatDateTime,
  isUncapped,
  phaseLabel,
  retentionLimit,
  retentionPlan,
  roleColour,
  roleLabel,
  ROLES,
  SEASON_OPTIONS,
  seasonOption,
  strategyLabel,
} from '../lib/format';

// Only these four values are tunable. Purse, squad, salary and retention
// limits come from the authoritative LCB season registry on the backend.
const DEFAULT_CONFIG = {
  minReservePerSlot: 0.2,
  maxAdditions: 6,
  tickMs: 1000,
  pace: 'BROADCAST',
};

const DIFFICULTIES = [
  { id: 'RELAXED', label: 'RELAXED', detail: 'Conservative rival bids — room to build your squad.' },
  { id: 'BALANCED', label: 'BALANCED', detail: 'Rivals weigh role gaps, value and purse discipline.' },
  { id: 'HARD', label: 'HARD', detail: 'Sharp competition analysis and tight financial control.' },
];

const PACES = [
  {
    id: 'FAST',
    label: 'FAST',
    detail: 'One call per second. Best for testing, not for a human bidder.',
  },
  {
    id: 'BROADCAST',
    label: 'BROADCAST',
    detail: 'Real auction rhythm — roughly 5 seconds per call, with pauses before rivals answer. Recommended.',
  },
  {
    id: 'CINEMATIC',
    label: 'CINEMATIC',
    detail: 'Longer 7–8 second calls and extra breathing room between bids.',
  },
];

function NumberField({ label, value, onChange, min, max, step, hint, disabled }) {
  return (
    <label className="config-field">
      <span className="config-label">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function SetupScreen() {
  const router = useRouter();
  const [season, setSeason] = useState('2025');
  const [difficulty, setDifficulty] = useState('BALANCED');
  const [selectedId, setSelectedId] = useState('F1');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(null);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retentionStep, setRetentionStep] = useState('pick');
  const [selectedRetentionIds, setSelectedRetentionIds] = useState([]);
  const [retentionRole, setRetentionRole] = useState('ALL');
  const [retentionFeedback, setRetentionFeedback] = useState('');

  const seasonDetails = seasonOption(season);
  const format = seasonDetails.format;

  useEffect(() => {
    let active = true;
    getState()
      .then((snapshot) => {
        if (!active) return;
        setSaved(snapshot);
        const savedState = snapshot.state;
        if (savedState?.userFranchiseId) setSelectedId(savedState.userFranchiseId);
        if (savedState?.phase === 'SETUP') {
          setCreated(savedState);
          const mine = savedState.franchises?.find((entry) => entry.id === savedState.userFranchiseId);
          const retained = (mine?.retentions || []).map((entry) => entry.playerId);
          setSelectedRetentionIds(retained);
          setRetentionStep(retained.length ? 'review' : 'pick');
        }
      })
      .catch(() => {
        // Setup must remain usable when the backend is not running yet.
      });
    return () => {
      active = false;
    };
  }, []);

  const catalogue = useMemo(() => catalogueFromState(saved?.state), [saved?.state]);
  const selected = catalogue.find((entry) => entry.id === selectedId) || catalogue[0];

  // Retentions can only come from this franchise's own previous-season
  // contracts. Show the full pool regardless of availability so "Change
  // retentions" can re-pick any of them after a reset.
  const retentionPool = useMemo(() => {
    if (!created) return [];
    return (created.players || []).filter((player) => (
      Boolean(player.retentionCandidate) && player.previousFranchiseId === created.userFranchiseId
    ));
  }, [created]);

  // Capped retention slabs are assigned in selection order, so put the best
  // players first. The same ordered list is sent to the backend and used for
  // the live cost preview.
  const orderedSelection = useMemo(() => {
    const byRating = new Map((created?.players || []).map((player) => [player.id, Number(player.rating) || 0]));
    return [...selectedRetentionIds].sort((a, b) => (byRating.get(b) || 0) - (byRating.get(a) || 0));
  }, [created, selectedRetentionIds]);

  const setConfigValue = (key, raw) => {
    const value = key === 'pace' ? raw : raw === '' ? '' : Number(raw);
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const validate = () => {
    const values = config;
    if (!SEASON_OPTIONS.some((option) => option.key === season)) return 'Choose a League Control Board season.';
    if (format === 'MINI') {
      if (Number(values.maxAdditions) < 1 || Number(values.maxAdditions) > seasonDetails.maxRetentions) {
        return 'Mini additions must be between 1 and the maximum squad size.';
      }
    }
    if (Number(values.minReservePerSlot) < 0) return 'Reserve per slot cannot be negative.';
    if (!PACES.some((item) => item.id === values.pace)) return 'Choose an auction pace.';
    if (!selectedId) return 'Choose a franchise.';
    return '';
  };

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      const result = await postAction(action, {
        season,
        format,
        difficulty,
        userFranchiseId: selectedId,
        config: {
          tickMs: Number(config.tickMs) || 1000,
          pace: config.pace,
          minReservePerSlot: Number(config.minReservePerSlot) || 0,
          maxAdditions: format === 'MINI' ? Number(config.maxAdditions) || 6 : 25,
        },
      });
      if (action === 'CREATE') {
        setCreated(result.state);
        setRetentionStep('pick');
        setSelectedRetentionIds([]);
        setRetentionRole('ALL');
        setRetentionFeedback('');
      }
      if (action === 'START') router.push('/auction');
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    await run('CREATE');
  };

  const handleStart = async () => {
    setBusy(true);
    setError('');
    try {
      await postAction('START');
      router.push('/auction');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const retentionProblem = (ids) => {
    const plan = retentionPlan(created, ids);
    const rules = created?.rules || seasonOption(created?.season);
    if (plan.overLimit) return `You can retain at most ${retentionLimit(created)} players.`;
    if (plan.overCapped) return `A Mega Auction allows at most ${rules.maxCappedRetentions || 5} capped retentions.`;
    if (plan.overUncapped) return `A Mega Auction allows at most ${rules.maxUncappedRetentions || 2} uncapped retentions.`;
    const overseas = plan.entries.filter((entry) => isUncapped(entry.player) === false && entry.player.nationality && entry.player.nationality !== 'India').length;
    if (overseas > (Number(created?.config?.maxOverseas) || 8)) return `Retentions would exceed the overseas limit of ${created?.config?.maxOverseas || 8}.`;
    return '';
  };

  const toggleRetention = (id) => {
    setRetentionFeedback('');
    if (selectedRetentionIds.includes(id)) {
      setSelectedRetentionIds((current) => current.filter((entry) => entry !== id));
      return;
    }
    const nextIds = [...selectedRetentionIds, id];
    const problem = retentionProblem(nextIds);
    if (problem) {
      setRetentionFeedback(problem);
      return;
    }
    setSelectedRetentionIds(nextIds);
  };

  const handleConfirmRetentions = async () => {
    const problem = retentionProblem(orderedSelection);
    if (problem) {
      setRetentionFeedback(problem);
      return;
    }
    setBusy(true);
    setError('');
    setRetentionFeedback('');
    try {
      const result = await postAction('SET_RETENTIONS', { playerIds: orderedSelection });
      setCreated(result.state);
      setRetentionStep('review');
    } catch (err) {
      setRetentionFeedback(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleChangeRetentions = () => {
    setSelectedRetentionIds((createdMine?.retentions || []).map((entry) => entry.playerId));
    setRetentionStep('pick');
    setRetentionFeedback('');
  };

  const createdMine = created?.franchises?.find((entry) => entry.id === created.userFranchiseId);
  const plan = retentionPlan(created, orderedSelection);
  const retentionMax = retentionLimit(created);
  const runningCost = plan.total;
  const isMegaAuction = (created?.rules?.format || created?.format || format) === 'MEGA';
  const maxCapped = Number(created?.rules?.maxCappedRetentions) || 5;
  const maxUncapped = Number(created?.rules?.maxUncappedRetentions) || 2;
  // On first pick the purse is untouched; after "Change retentions" it already
  // has the previous spend removed, so add it back before projecting the new cost.
  const basePurse = Number(createdMine?.purse ?? created?.config?.startingPurse ?? 0)
    + Number(createdMine?.retentionSpent || 0);
  const projectedPurse = Math.round((basePurse - runningCost) * 100) / 100;
  const visibleCandidates = retentionPool
    .filter((player) => retentionRole === 'ALL' || player.role === retentionRole)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const confirmedRetentions = (createdMine?.retentions || []).map((entry) => ({
    ...entry,
    player: created?.players?.find((player) => player.id === entry.playerId) || null,
  }));

  return (
    <div className="setup-screen">
      <section className="setup-hero">
        <div className="hero-copy">
          <span className="eyebrow">SPORTS MANAGEMENT SIMULATOR · TEN FRANCHISES · ONE HALL</span>
          <h1>T20 Dynasty</h1>
          <p className="hero-tagline">Build your squad. Manage your purse. Compete for glory.</p>
          <p>
            You run one franchise. Nine autonomous management teams evaluate every lot against
            their own squads, purses and strategies. Set the rules, take a seat on the floor,
            and make every bid count.
          </p>
          <div className="hero-tags">
            <span>Live bidding</span>
            <span>AI war rooms</span>
            <span>Full auction proceedings</span>
            <span>Voice commentary</span>
          </div>
        </div>
        <div className="hero-board" aria-hidden="true">
          <div className="hero-board-title">AUCTION CONTROL</div>
          <div className="hero-board-line"><span>SEASON</span><strong>{seasonDetails.label}</strong></div>
          <div className="hero-board-line"><span>FORMAT</span><strong>{format}</strong></div>
          <div className="hero-board-line"><span>DIFFICULTY</span><strong>{difficulty}</strong></div>
          <div className="hero-board-line"><span>PACE</span><strong>{config.pace}</strong></div>
          <div className="hero-board-line"><span>PURSE</span><strong>{cr(seasonDetails.startingPurse)}</strong></div>
          <div className="hero-board-line"><span>YOUR TEAM</span><strong>{selected?.short || '—'}</strong></div>
          <div className="hero-board-glow" />
        </div>
      </section>

      {saved?.saveError && (
        <div className="notice notice-error">
          <strong>Save file warning:</strong> {saved.saveError}
        </div>
      )}

      {saved?.state && (
        <section className="resume-panel">
          <div>
            <span className="eyebrow">SAVED AUCTION FOUND</span>
            <h2>Pick up where you left off</h2>
            <p>
              {saved.state.rules?.label || `T20 Dynasty ${saved.state.season || '2025'}`} · {saved.state.difficulty} · {phaseLabel(saved.state.phase)} ·
              last saved {formatDateTime(saved.state.savedAt)}
            </p>
          </div>
          <div className="resume-actions">
            {saved.state.phase === 'COMPLETED' ? (
              <a className="btn btn-primary" href="/results">View final results</a>
            ) : (
              <a className="btn btn-primary" href="/auction">Resume auction →</a>
            )}
            <span className="resume-note">
              Your franchise: {saved.state.franchises?.find((f) => f.id === saved.state.userFranchiseId)?.name || '—'}
            </span>
          </div>
        </section>
      )}

      <section className="setup-section">
        <div className="section-heading">
          <span className="step-number">01</span>
          <div>
            <h2>Choose a League Control Board season</h2>
            <p>One Mega followed by two Mini Auctions. Financial and squad limits are fixed by the regulations.</p>
          </div>
        </div>
        <div className="format-grid">
          {SEASON_OPTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`format-card ${season === item.key ? 'is-selected' : ''}`}
              onClick={() => setSeason(item.key)}
              aria-pressed={season === item.key}
            >
              <span className="format-kicker">{item.kicker}</span>
              <strong>{item.label}</strong>
              <ul>
                {item.rules.map((rule) => <li key={rule}>{rule}</li>)}
              </ul>
              <span className="selection-mark">{season === item.key ? 'SELECTED' : 'SELECT'}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="setup-section">
        <div className="section-heading">
          <span className="step-number">02</span>
          <div>
            <h2>Set the difficulty</h2>
            <p>Controls how sharply the nine rival franchises evaluate players.</p>
          </div>
        </div>
        <div className="difficulty-grid">
          {DIFFICULTIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`difficulty-card ${difficulty === item.id ? 'is-selected' : ''}`}
              onClick={() => setDifficulty(item.id)}
              aria-pressed={difficulty === item.id}
            >
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="setup-section">
        <div className="section-heading">
          <span className="step-number">03</span>
          <div>
            <h2>Set the auction pace</h2>
            <p>BROADCAST gives you time to read the room and raise a paddle before the hammer falls.</p>
          </div>
        </div>
        <div className="difficulty-grid">
          {PACES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`difficulty-card ${config.pace === item.id ? 'is-selected' : ''}`}
              onClick={() => setConfigValue('pace', item.id)}
              aria-pressed={config.pace === item.id}
            >
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="setup-section">
        <div className="section-heading">
          <span className="step-number">04</span>
          <div>
            <h2>Take a franchise</h2>
            <p>Ten teams, each with its own colours, ownership and management strategy.</p>
          </div>
        </div>
        <div className="franchise-picker">
          {catalogue.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`franchise-option ${selectedId === entry.id ? 'is-selected' : ''}`}
              style={{ '--team-primary': entry.primary, '--team-secondary': entry.secondary }}
              onClick={() => setSelectedId(entry.id)}
              aria-pressed={selectedId === entry.id}
            >
              <span className="franchise-swatch">{entry.short}</span>
              <span className="franchise-option-body">
                <strong>{entry.name}</strong>
                <small>{entry.city} · {entry.owner}</small>
                <small className="strategy-tag">Strategy: {strategyLabel(entry.strategy)}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="setup-section">
        <div className="section-heading">
          <span className="step-number">05</span>
          <div>
            <h2>Authorised rules &amp; pace controls</h2>
            <p>Financial limits are set by the fictional League Control Board season registry and enforced for human and AI bidders alike.</p>
          </div>
        </div>
        <div className="rules-board">
          <div><span>SEASON</span><strong>{seasonDetails.label}</strong></div>
          <div><span>STARTING PURSE</span><strong>{cr(seasonDetails.startingPurse)}</strong></div>
          <div><span>TOTAL SALARY CAP</span><strong>{cr(seasonDetails.totalSalaryCap)}</strong></div>
          <div><span>OVERSEAS SALARY CAP</span><strong>{seasonDetails.overseasSalaryCap ? cr(seasonDetails.overseasSalaryCap) : 'No ceiling (Mega)'}</strong></div>
          <div><span>SQUAD</span><strong>18–25 · max 8 overseas</strong></div>
          <div><span>RETENTIONS / CLAWBACK</span><strong>{format === 'MEGA' ? '6 max · 6 − retentions Clawback cards' : 'At contract fee · no Clawback'}</strong></div>
          <div><span>MARQUEE SETS</span><strong>{format === 'MEGA' ? 2 : 0}</strong></div>
          <div><span>MATCH FEE</span><strong>₹7.5 lakh per Playing XI member incl. X-Factor Substitute</strong></div>
        </div>
        <div className="config-grid">
          <NumberField label="Mini additions" value={config.maxAdditions} min={1} max={25} step={1}
            disabled={format !== 'MINI'}
            onChange={(value) => setConfigValue('maxAdditions', value)}
            hint={format === 'MINI' ? 'New players allowed in MINI' : 'Fixed at 25 for MEGA'} />
          <NumberField label="Reserve per slot (₹ Cr)" value={config.minReservePerSlot} min={0} step={0.1}
            onChange={(value) => setConfigValue('minReservePerSlot', value)}
            hint="Money held back for empty slots" />
        </div>
      </section>

      <section className="setup-launch">
        <div>
          <h2>Ready for the call?</h2>
          <p>
            Creating the auction saves it in SETUP. You will retain only players from your own
            previous-season contract list, then review every squad before the first player is introduced.
          </p>
        </div>
        <div className="launch-actions">
          {error && <div className="inline-error">{error}</div>}
          <button type="button" className="btn btn-primary btn-large" onClick={handleCreate} disabled={busy}>
            {busy ? 'Creating…' : `Create ${format} auction →`}
          </button>
        </div>
      </section>

      {created && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose retentions before start">
          <div className="modal-card retention-modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">AUCTION CREATED · PHASE: SETUP</span>
                <h2>{retentionStep === 'pick' ? 'Choose your retentions' : 'Retentions locked in'}</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setCreated(null)} aria-label="Close preview">
                ×
              </button>
            </div>

            {retentionStep === 'pick' ? (
              <div className="modal-body">
                <p className="modal-lead">
                  <strong>{createdMine?.name || 'Your franchise'}</strong> can only retain players from its
                  own previous-season contract list.{' '}
                  {isMegaAuction ? (
                    <>
                      Up to <strong>{retentionMax}</strong> in total — at most <strong>{maxCapped}</strong> capped
                      (₹18/14/11/18/14 Cr in selection order) and <strong>{maxUncapped}</strong> uncapped (₹4 Cr each).
                      Every unused slot leaves a Franchise Clawback card.
                    </>
                  ) : (
                    <>Keep as many as you like at their existing contract fees. There is no Franchise Clawback in a Mini Auction.</>
                  )}
                </p>
                <div className="retention-meter">
                  <div><span>SELECTED</span><strong>{plan.entries.length}{isMegaAuction ? `/${retentionMax}` : ''}</strong></div>
                  {isMegaAuction && (
                    <div><span>CAPPED / UNCAPPED</span><strong>{plan.cappedCount}/{maxCapped} · {plan.uncappedCount}/{maxUncapped}</strong></div>
                  )}
                  <div><span>RETENTION COST</span><strong>{cr(runningCost)}</strong></div>
                  <div><span>CLAWBACK CARDS</span><strong>{plan.clawCards}</strong></div>
                  <div><span>PURSE AFTER</span><strong>{cr(projectedPurse)}</strong></div>
                </div>

                <div className="retention-toolbar">
                  <div className="filter-buttons">
                    <button type="button" className={`filter-chip ${retentionRole === 'ALL' ? 'is-active' : ''}`}
                      onClick={() => setRetentionRole('ALL')} aria-pressed={retentionRole === 'ALL'}>
                      All roles
                    </button>
                    {ROLES.map((role) => (
                      <button key={role} type="button" className={`filter-chip ${retentionRole === role ? 'is-active' : ''}`}
                        onClick={() => setRetentionRole(role)} aria-pressed={retentionRole === role}>
                        {roleLabel(role)}s
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelectedRetentionIds([])}>
                    Clear selection
                  </button>
                </div>

                {retentionFeedback && <div className="inline-error">{retentionFeedback}</div>}

                <div className="retention-list">
                  {visibleCandidates.map((player) => {
                    const picked = selectedRetentionIds.includes(player.id);
                    const maxed = !picked && selectedRetentionIds.length >= retentionMax;
                    const indicative = plan.entries.find((entry) => entry.playerId === player.id)
                      || retentionPlan(created, [...orderedSelection, player.id]).entries
                        .find((entry) => entry.playerId === player.id);
                    return (
                      <button
                        key={player.id}
                        type="button"
                        className={`retention-player ${picked ? 'is-selected' : ''}`}
                        onClick={() => toggleRetention(player.id)}
                        disabled={maxed}
                        aria-pressed={picked}
                      >
                        <span className="retention-check">{picked ? '✓' : ''}</span>
                        <span className="retention-name">
                          <strong>{player.name}</strong>
                          <small>{player.id} · {player.nationality} · fee {cr(player.contractFee)}</small>
                        </span>
                        <span className="retention-status">{cappedLabel(player)}</span>
                        <span className="retention-role" style={{ '--role-colour': roleColour(player.role) }}>
                          {roleLabel(player.role)}
                        </span>
                        <span className="retention-rating">{player.rating}</span>
                        <span className="retention-price">{cr(indicative?.cost || 0)}</span>
                      </button>
                    );
                  })}
                  {!visibleCandidates.length && <p className="feed-empty">No eligible players for this role.</p>}
                </div>
              </div>
            ) : (
              <div className="modal-body">
                <p className="modal-lead">
                  Your <strong>{confirmedRetentions.length}</strong> retention
                  {confirmedRetentions.length === 1 ? '' : 's'} cost{' '}
                  <strong>{cr(Number(createdMine?.retentionSpent || 0))}</strong>. The nine rivals have
                  locked their own picks from what remained. Remaining purse:{' '}
                  <strong>{cr(createdMine?.purse)}</strong>.{' '}
                  {isMegaAuction && <>You hold <strong>{Number(createdMine?.clawCards) || 0}</strong> Franchise Clawback card{Number(createdMine?.clawCards) === 1 ? '' : 's'}.</>}
                </p>

                <h3 className="modal-subhead">Your retained squad</h3>
                <div className="preview-players">
                  {ROLES.map((role) => {
                    const rows = confirmedRetentions.filter((row) => row.player?.role === role);
                    if (!rows.length) return null;
                    return (
                      <div key={role} className="preview-role" style={{ '--role-colour': roleColour(role) }}>
                        <strong>{roleLabel(role)} · {rows.length}</strong>
                        <div>
                          {rows.map((row) => (
                            <span key={row.playerId} className="preview-player">
                              {row.player?.name || row.playerId}{' '}
                              <small>{row.capped === false ? 'Uncapped · ' : 'Capped · '}{cr(row.cost)}</small>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {!confirmedRetentions.length && <p>No retentions — every player goes into the auction pool.</p>}
                </div>

                <h3 className="modal-subhead">All ten franchises</h3>
                <div className="preview-summary">
                  {created.franchises?.map((entry) => (
                    <div key={entry.id} className="preview-team" style={{ '--team-primary': entry.primary }}>
                      <strong>{entry.short}</strong>
                      <span>{(entry.retentions || []).length} retained · {cr(entry.retentionSpent || 0)}</span>
                      <span>{cr(entry.purse)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="inline-error modal-error">{error}</div>}
            <div className="modal-actions">
              {retentionStep === 'pick' ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => setCreated(null)}>
                    Keep in setup
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleConfirmRetentions} disabled={busy}>
                    {busy
                      ? 'Saving…'
                      : selectedRetentionIds.length
                        ? `Confirm ${selectedRetentionIds.length} retention${selectedRetentionIds.length === 1 ? '' : 's'} →`
                        : 'Start with 0 retentions →'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost" onClick={handleChangeRetentions}>
                    Change retentions
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleStart} disabled={busy}>
                    {busy ? 'Starting…' : 'START auction →'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
