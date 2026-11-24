'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  activeTradeWindow,
  computeTradeDeal,
  cr,
  deadlineLabel,
  franchiseById,
  playerById,
  phaseLabel,
  roleLabel,
  tradeApprovalLabel,
  tradeBlockReason,
  tradeSalary,
  tradeStatusLabel,
  tradeTypeLabel,
  tradeWindowInfo,
} from '../lib/format';

const MODES = [
  { id: 'BUY', label: 'Buy player(s)' },
  { id: 'SELL', label: 'Sell player(s)' },
  { id: 'SWAP', label: 'Swap players' },
];

function statusTone(status) {
  if (status === 'APPROVED') return 'ok';
  if (status === 'REJECTED' || status === 'VETOED' || status === 'EXPIRED') return 'bad';
  return 'pending';
}

/** Chip-based picker over one franchise's tradeable contract roster. */
function PlayerPicker({ state, franchise, window, selected, onChange, excludeIds = [], label, disabled = false }) {
  // In SETUP, previous-season contracts are tradeable before retentions.
  const roster = state?.phase === 'SETUP'
    ? [...new Set([...(franchise?.previousSquad || []), ...(franchise?.squad || [])])]
    : (franchise?.squad || []);
  const options = roster
    .map((id) => playerById(state, id))
    .filter((player) => player
      && !selected.includes(player.id)
      && !excludeIds.includes(player.id)
      && !tradeBlockReason(state, franchise, player, window));
  return (
    <div className="trade-picker">
      <span className="filter-label">{label}</span>
      <div className="trade-chip-row">
        {selected.map((id) => {
          const player = playerById(state, id);
          return (
            <span key={id} className="trade-chip">
              {player?.name || id} · {cr(tradeSalary(state, id))}
              <button type="button" disabled={disabled} aria-label={`Remove ${player?.name || id}`} onClick={() => onChange(selected.filter((x) => x !== id))}>×</button>
            </span>
          );
        })}
        {!selected.length && <span className="trade-chip-empty">No players selected</span>}
      </div>
      <select
        value=""
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value) onChange([...selected, event.target.value]);
        }}
      >
        <option value="">Add player…</option>
        {options.map((player) => (
          <option key={player.id} value={player.id}>
            {player.name} · {roleLabel(player.role)} · {cr(tradeSalary(state, player.id))}
          </option>
        ))}
      </select>
    </div>
  );
}

function DealSummary({ state, giveIds, getIds, fromName, toName }) {
  const deal = computeTradeDeal(state, giveIds, getIds);
  if (!giveIds.length && !getIds.length) return null;
  const payer = deal.cashAdjustment > 0 ? fromName : toName;
  const payee = deal.cashAdjustment > 0 ? toName : fromName;
  return (
    <div className="trade-summary">
      <span className={`source-badge trade-type-${deal.type.toLowerCase()}`}>{tradeTypeLabel(deal.type)}</span>
      {deal.cashAdjustment !== 0 ? (
        <span><strong>{payer}</strong> pays <strong>{payee}</strong> exactly <strong>{cr(Math.abs(deal.cashAdjustment))}</strong> (fixed league fees — never renegotiated).</span>
      ) : (
        <span>Equal salaries — no cash moves between the purses.</span>
      )}
    </div>
  );
}

/** Injury replacements and withdrawals are backed by the existing LCB actions. */
function RppPanel({ state, mine, onAction, busy }) {
  const [withdrawId, setWithdrawId] = useState('');
  const [injuredId, setInjuredId] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [fee, setFee] = useState('');

  if (!mine) return null;

  const squad = (mine.squad || []).map((id) => playerById(state, id)).filter(Boolean);
  const activePlayers = squad.filter((player) => !player.injured && !player.withdrawn
    && player.availability !== 'INJURED' && player.availability !== 'WITHDRAWN');
  const injuredPlayers = squad.filter((player) => player.injured || player.availability === 'INJURED');
  const rppPlayers = (state.players || []).filter((player) => ['AVAILABLE', 'UNSOLD'].includes(player.availability)
    && !player.soldTo && !player.injured && !player.withdrawn);
  const injured = playerById(state, injuredId);
  const budget = Number(injured?.injuryReplacementBudget) || 0;
  const signed = (state.players || []).filter((player) => player.isRppReplacement && player.soldTo === mine.id);

  const act = (action, payload) => onAction(action, { franchiseId: mine.id, ...payload });
  const options = (players) => players.map((player) => (
    <option key={player.id} value={player.id}>
      {player.name} · {roleLabel(player.role)} · {cr(tradeSalary(state, player.id))}
    </option>
  ));

  return (
    <section className="panel">
      <div className="panel-heading">
        <h3>Reserve Player Pool &amp; withdrawals</h3>
        <span className="panel-tag">RPP</span>
      </div>
      <p className="balance-note">
        A certified injury lets you sign a replacement from the RPP within the outgoing salary, with no purse debit.
        An uncertified pre-season withdrawal removes the player and applies a two-season ban.
      </p>
      <div className="trade-form">
        <div className="trade-fee-fields">
          <label>
            Contracted player
            <select value={withdrawId} disabled={busy} onChange={(event) => setWithdrawId(event.target.value)}>
              <option value="">Select…</option>
              {options(activePlayers)}
            </select>
          </label>
        </div>
        <div className="trade-actions">
          <button type="button" className="btn btn-ghost" disabled={busy || !withdrawId}
            onClick={() => act('INJURE_PLAYER', { playerId: withdrawId })}>
            Report certified injury
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy || !withdrawId}
            onClick={() => act('PLAYER_WITHDRAW', { playerId: withdrawId })}>
            Uncertified withdrawal · 2-season ban
          </button>
        </div>
        <div className="trade-fee-fields">
          <label>
            Injured player
            <select value={injuredId} disabled={busy || !injuredPlayers.length}
              onChange={(event) => { setInjuredId(event.target.value); setReplacementId(''); setFee(''); }}>
              <option value="">Select…</option>
              {options(injuredPlayers)}
            </select>
          </label>
          <label>
            RPP replacement
            <select value={replacementId} disabled={busy || !injured || !rppPlayers.length}
              onChange={(event) => setReplacementId(event.target.value)}>
              <option value="">Select…</option>
              {options(rppPlayers)}
            </select>
          </label>
          <label>
            Fee (Cr){budget > 0 ? ` · max ${cr(budget)}` : ''}
            <input type="number" min="0" max={budget || undefined} step="0.05" value={fee}
              placeholder={budget > 0 ? String(budget) : '—'} disabled={busy || !injured || !replacementId}
              onChange={(event) => setFee(event.target.value)} />
          </label>
        </div>
        <div className="trade-actions">
          <button type="button" className="btn btn-primary" disabled={busy || !injured || !replacementId}
            onClick={() => act('SIGN_INJURY_REPLACEMENT', {
              injuredPlayerId: injuredId,
              replacementPlayerId: replacementId,
              ...(fee === '' ? {} : { fee: Number(fee) }),
            })}>
            Sign RPP replacement
          </button>
        </div>
      </div>
      {signed.length > 0 && (
        <div className="trade-list">
          {signed.map((player) => (
            <div key={player.id} className="trade-card">
              <div className="trade-card-head">
                <span className="trade-id">RPP</span>
                <span className="source-badge">SIGNED</span>
              </div>
              <p className="trade-route">
                <strong>{player.name}</strong> joined for {cr(Number(player.salary) || Number(player.soldPrice) || 0)}
                <small> · no purse debit</small>
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TradeCard({ state, trade, me, onAction, busy }) {
  const [amending, setAmending] = useState(false);
  const [amendGive, setAmendGive] = useState(trade.givePlayerIds || []);
  const [amendGet, setAmendGet] = useState(trade.getPlayerIds || []);
  const [amendFee, setAmendFee] = useState(trade.transferFee?.total ?? 0);
  const [amendShare, setAmendShare] = useState(trade.transferFee?.playerSharePct ?? 25);

  const from = franchiseById(state, trade.fromFranchiseId);
  const to = franchiseById(state, trade.toFranchiseId);
  const involved = trade.fromFranchiseId === me || trade.toFranchiseId === me;
  const iAmTarget = trade.toFranchiseId === me;
  const window = trade.window || activeTradeWindow(state);
  const pendingConsentIds = Object.entries(trade.consents || {})
    .filter(([id, verdict]) => {
      if (verdict !== 'PENDING') return false;
      const ownerIsFrom = (trade.givePlayerIds || []).includes(id);
      return ownerIsFrom ? trade.fromFranchiseId === me : trade.toFranchiseId === me;
    })
    .map(([id]) => id);

  const names = (ids) => ids.map((id) => playerById(state, id)?.name || id).join(', ') || '—';
  const cash = Number(trade.cashAdjustment) || 0;
  const deadline = trade.status === 'PENDING_48H' ? trade.respondBy : trade.status === 'AWAITING_CONSENT' ? trade.consentBy : null;

  const act = (action, payload) => onAction(action, { tradeId: trade.id, ...payload });

  return (
    <div className={`trade-card trade-card-${statusTone(trade.status)}`}>
      <div className="trade-card-head">
        <span className="trade-id">{trade.id}</span>
        <span className="source-badge">{tradeTypeLabel(trade.type)}</span>
        <span className={`trade-status trade-status-${statusTone(trade.status)}`}>{tradeStatusLabel(trade.status)}</span>
        <span className="trade-window-tag">{trade.window || '—'}</span>
        {deadline && <span className="trade-deadline">{deadlineLabel(deadline)}</span>}
      </div>
      <p className="trade-route">
        <strong style={{ color: from?.primary }}>{from?.name || trade.fromFranchiseId}</strong>
        {' ⇄ '}
        <strong style={{ color: to?.primary }}>{to?.name || trade.toFranchiseId}</strong>
        <small> · {tradeApprovalLabel(trade.approval)}</small>
      </p>
      <div className="trade-flows">
        <div>
          <span className="filter-label">{from?.short || trade.fromFranchiseId} sends</span>
          <p>{names(trade.givePlayerIds || [])}</p>
        </div>
        <div>
          <span className="filter-label">{to?.short || trade.toFranchiseId} sends</span>
          <p>{names(trade.getPlayerIds || [])}</p>
        </div>
      </div>
      <p className="trade-cashline">
        {cash === 0
          ? 'No cash adjustment.'
          : cash > 0
            ? `${from?.name} pays ${to?.name} ${cr(cash)}.`
            : `${to?.name} pays ${from?.name} ${cr(-cash)}.`}
        {trade.transferFee?.total > 0 && (
          <small>
            {' '}Off-purse transfer fee {cr(trade.transferFee.total)}
            {trade.transferFee.lcbCut !== undefined
              ? ` → LCB ${cr(trade.transferFee.lcbCut)} · player(s) ${cr(trade.transferFee.playerAmount)} · seller ${cr(trade.transferFee.sellerAmount)}`
              : ` · player share up to ${trade.transferFee.playerSharePct}% of the remainder`}
          </small>
        )}
      </p>
      {trade.rejectionReason && <p className="trade-reason">{trade.rejectionReason}</p>}

      {iAmTarget && trade.status === 'PENDING_48H' && (
        <div className="trade-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('RESPOND_TRADE', { accept: true })}>
            Accept EOI
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act('RESPOND_TRADE', { accept: false })}>
            Reject
          </button>
          <small>You have 48 hours to answer. Rejecting ends the approach.</small>
        </div>
      )}

      {trade.status === 'AWAITING_CONSENT' && pendingConsentIds.length > 0 && (
        <div className="trade-consents">
          {pendingConsentIds.map((id) => {
            const player = playerById(state, id);
            return (
              <div key={id} className="trade-consent-row">
                <span>Written consent required from <strong>{player?.name || id}</strong></span>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('PLAYER_TRADE_CONSENT', { playerId: id, consent: true })}>
                  Sign consent
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act('PLAYER_TRADE_CONSENT', { playerId: id, consent: false })}>
                  Veto
                </button>
              </div>
            );
          })}
        </div>
      )}

      {involved && trade.status === 'AWAITING_CONSENT' && (
        <div className="trade-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => {
            if (!amending) {
              setAmendGive(trade.givePlayerIds || []);
              setAmendGet(trade.getPlayerIds || []);
              setAmendFee(trade.transferFee?.total ?? 0);
              setAmendShare(trade.transferFee?.playerSharePct ?? 25);
            }
            setAmending((value) => !value);
          }}>
            {amending ? 'Close negotiation' : 'Renegotiate terms'}
          </button>
        </div>
      )}

      {amending && trade.status === 'AWAITING_CONSENT' && (
        <div className="trade-amend">
          <PlayerPicker state={state} franchise={from} window={window} label={`${from?.short || 'Proposer'} sends`}
            selected={amendGive} onChange={setAmendGive} excludeIds={amendGet} />
          <PlayerPicker state={state} franchise={to} window={window} label={`${to?.short || 'Counterparty'} sends`}
            selected={amendGet} onChange={setAmendGet} excludeIds={amendGive} />
          <DealSummary state={state} giveIds={amendGive} getIds={amendGet} fromName={from?.name} toName={to?.name} />
          {computeTradeDeal(state, amendGive, amendGet).type === 'ALL_CASH' && (
            <div className="trade-fee-fields">
              <label>
                Transfer fee (Cr, off-purse)
                <input type="number" min="0" step="0.05" value={amendFee} onChange={(event) => setAmendFee(event.target.value)} />
              </label>
              <label>
                Player share of remainder (%)
                <input type="number" min="0" max="50" step="5" value={amendShare} onChange={(event) => setAmendShare(event.target.value)} />
              </label>
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || (!amendGive.length && !amendGet.length)}
            onClick={async () => {
              const result = await act('AMEND_TRADE', {
                givePlayerIds: amendGive,
                getPlayerIds: amendGet,
                transferFee: Number(amendFee) || 0,
                playerSharePct: Number(amendShare) || 0,
              });
              if (result?.ok) setAmending(false);
            }}
          >
            Re-submit for consent
          </button>
          <small>Changing the player lists re-opens written consent. The salary cash stays fixed.</small>
        </div>
      )}

      {(trade.timeline || []).length > 0 && (
        <details className="trade-timeline">
          <summary>Audit trail ({trade.timeline.length})</summary>
          <ol>
            {trade.timeline.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <strong>{entry.status}</strong> {entry.note}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export default function TradeDesk({ state, onAction, busy }) {
  const me = state.userFranchiseId;
  const mine = franchiseById(state, me);
  const windowInfo = tradeWindowInfo(state);
  const window = windowInfo.window;
  const clawAvailable = Boolean(state.rules?.clawAvailable);
  const myClawCards = Number(mine?.clawCards || 0);

  const [counterpartyId, setCounterpartyId] = useState('');
  const [mode, setMode] = useState('BUY');
  const [giveIds, setGiveIds] = useState([]);
  const [getIds, setGetIds] = useState([]);
  const [transferFee, setTransferFee] = useState(0);
  const [playerSharePct, setPlayerSharePct] = useState(25);
  const [showAll, setShowAll] = useState(false);
  const [reportFranchise, setReportFranchise] = useState('');
  const [reportPlayer, setReportPlayer] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [rulings, setRulings] = useState({});

  const rivals = (state.franchises || []).filter((franchise) => franchise.id !== me);
  const counterparty = franchiseById(state, counterpartyId) || rivals[0] || null;

  // Reset selections whenever the counterparty changes so stale ids never leak.
  const effectiveCounterpartyId = counterparty?.id || '';
  const [lastCounterparty, setLastCounterparty] = useState(effectiveCounterpartyId);
  if (effectiveCounterpartyId !== lastCounterparty) {
    setLastCounterparty(effectiveCounterpartyId);
    setGiveIds([]);
    setGetIds([]);
  }

  const trades = state.trades || [];
  const visibleTrades = useMemo(() => {
    const list = showAll ? trades : trades.filter((trade) => trade.fromFranchiseId === me || trade.toFranchiseId === me);
    return [...list].reverse();
  }, [trades, showAll, me]);

  const incomingPending = trades.filter((trade) => trade.toFranchiseId === me && trade.status === 'PENDING_48H').length;
  const consentsNeeded = trades.filter((trade) => trade.status === 'AWAITING_CONSENT'
    && Object.entries(trade.consents || {}).some(([id, verdict]) => verdict === 'PENDING'
      && ((trade.givePlayerIds || []).includes(id) ? trade.fromFranchiseId === me : trade.toFranchiseId === me))).length;

  const deal = computeTradeDeal(state, mode === 'SELL' ? giveIds : mode === 'BUY' ? [] : giveIds,
    mode === 'BUY' ? getIds : mode === 'SELL' ? [] : getIds);
  const canSubmit = windowInfo.open && (giveIds.length > 0 || getIds.length > 0)
    && (mode !== 'SWAP' || (giveIds.length > 0 && getIds.length > 0));
  const formDisabled = busy || !windowInfo.open;

  const submitProposal = () => {
    const payload = {
      fromFranchiseId: me,
      toFranchiseId: counterparty.id,
      givePlayerIds: mode === 'BUY' ? [] : giveIds,
      getPlayerIds: mode === 'SELL' ? [] : getIds,
    };
    if (deal.type === 'ALL_CASH' && Number(transferFee) > 0) {
      payload.transferFee = Number(transferFee);
      payload.playerSharePct = Number(playerSharePct) || 0;
    }
    return onAction('PROPOSE_TRADE', payload);
  };

  const reportFranchiseObj = franchiseById(state, reportFranchise);
  const tamperingCases = state.tamperingCases || [];

  return (
    <div className="trade-desk">
      <section className={`panel trade-banner ${windowInfo.open ? 'is-open' : ''}`}>
        <div className="panel-heading">
          <h3>League Control Board Trade Desk</h3>
          <span className="panel-tag">{windowInfo.open ? window : 'CLOSED'}</span>
        </div>
        <p><strong>{windowInfo.label}.</strong> {windowInfo.detail}</p>
        <ol className="trade-protocol">
          <li>EOI filed with the League Control Board</li>
          <li>Current franchise answers within 48 hours</li>
          <li>Negotiation + written player consent (a veto voids the deal)</li>
          <li>The League Control Board vets salary caps, squad limits and anti-tampering, then approves</li>
        </ol>
        {mine && (
          <p className="trade-purse-line">
            Your purse: <strong>{cr(mine.purse)}</strong>
            {Number(mine.tradeCashDelta) !== 0 && <small> · net trade cash {Number(mine.tradeCashDelta) > 0 ? 'received' : 'paid'} {cr(Math.abs(Number(mine.tradeCashDelta)))}</small>}
            {Number(mine.transferFeeEarned) > 0 && <small> · transfer fees earned {cr(mine.transferFeeEarned)}</small>}
          </p>
        )}
      </section>

      <section className="panel claw-registry">
        <div className="panel-heading">
          <h3>Franchise Clawback (RTM)</h3>
          <span className="panel-tag">
            {clawAvailable ? `${myClawCards} CARD${myClawCards === 1 ? '' : 'S'}` : 'NOT AVAILABLE'}
          </span>
        </div>
        {clawAvailable ? (
          <p className="balance-note">
            Your right-to-match balance is <strong>{myClawCards}</strong>. When one of your former contract
            players is sold to a rival, the LCB offers you a claw at the current price. The decision appears on{' '}
            <Link className="inline-link" href="/auction">Auction Hall →</Link>.
          </p>
        ) : (
          <p className="balance-note">
            Clawback (RTM) is a <strong>2025 Mega</strong> rule. This is {state.season} {state.format}, so no cards
            are issued. <Link className="inline-link" href="/">Create a 2025 Mega auction →</Link>
          </p>
        )}
        {state.claw && (
          <p className="balance-note">
            <Link className="inline-link" href="/auction">A claw offer is live — open Auction Hall now →</Link>
          </p>
        )}
      </section>

      <section className={`panel ${windowInfo.open ? '' : 'is-closed'}`}>
        <div className="panel-heading">
          <h3>File an Expression of Interest</h3>
          <span className="panel-tag">{windowInfo.open ? 'STEP 1 · EOI' : 'CLOSED'}</span>
        </div>
        {!windowInfo.open && (
          <p className="balance-note">
            Trading is closed during <strong>{phaseLabel(state.phase)}</strong>. This form is shown for reference only:
            EOIs open in <strong>SETUP</strong> before START/retentions, and again in <strong>FINAL_REVIEW</strong> or{' '}
            <strong>COMPLETED</strong> after the auction.{' '}
            <Link className="inline-link" href="/">Create a fresh auction in SETUP →</Link>
          </p>
        )}
        <div className="trade-form">
          <label className="squad-select">
            <span>Counterparty</span>
            <select value={counterparty?.id || ''} disabled={formDisabled} onChange={(event) => setCounterpartyId(event.target.value)}>
              {rivals.map((franchise) => (
                <option key={franchise.id} value={franchise.id}>{franchise.name} ({franchise.short})</option>
              ))}
            </select>
          </label>
          <div className="filter-buttons">
            {MODES.map((option) => (
              <button key={option.id} type="button"
                className={`filter-chip ${mode === option.id ? 'is-active' : ''}`}
                aria-pressed={mode === option.id}
                disabled={formDisabled}
                onClick={() => { setMode(option.id); setGiveIds([]); setGetIds([]); }}>
                {option.label}
              </button>
            ))}
          </div>
          {mode !== 'BUY' && (
            <PlayerPicker state={state} franchise={mine} window={window} label="You send"
              selected={giveIds} onChange={setGiveIds} excludeIds={getIds} disabled={formDisabled} />
          )}
          {mode !== 'SELL' && (
            <PlayerPicker state={state} franchise={counterparty} window={window} label={`${counterparty?.short || 'They'} send`}
              selected={getIds} onChange={setGetIds} excludeIds={giveIds} disabled={formDisabled} />
          )}
          <DealSummary state={state}
            giveIds={mode === 'BUY' ? [] : giveIds}
            getIds={mode === 'SELL' ? [] : getIds}
            fromName={mine?.name} toName={counterparty?.name} />
          {deal.type === 'ALL_CASH' && (giveIds.length > 0 || getIds.length > 0) && (
            <div className="trade-fee-fields">
              <label>
                Optional transfer fee (Cr, off-purse)
                <input type="number" min="0" step="0.05" value={transferFee} disabled={formDisabled} onChange={(event) => setTransferFee(event.target.value)} />
              </label>
              <label>
                Player share of remainder (%, max 50)
                <input type="number" min="0" max="50" step="5" value={playerSharePct} disabled={formDisabled} onChange={(event) => setPlayerSharePct(event.target.value)} />
              </label>
              <small>The League Control Board takes 50% of any transfer fee; the player(s) may take up to half of the rest; the selling franchise keeps the balance. No purse is touched.</small>
            </div>
          )}
          <div className="trade-actions">
            <button type="button" className="btn btn-primary" disabled={busy || !canSubmit} onClick={submitProposal}>
              Submit EOI to the League Control Board
            </button>
            <button type="button" className="btn btn-ghost" disabled={formDisabled} onClick={() => onAction('RUN_AI_TRADES', { limit: 3 })}>
              Scout rival trade activity
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h3>Trade inbox &amp; ledger</h3>
          <span className="panel-tag">
            {incomingPending > 0 ? `${incomingPending} EOI${incomingPending === 1 ? '' : 'S'} TO ANSWER` : consentsNeeded > 0 ? `${consentsNeeded} CONSENT${consentsNeeded === 1 ? '' : 'S'} NEEDED` : `${visibleTrades.length} DEALS`}
          </span>
        </div>
        <div className="filter-buttons">
          <button type="button" className={`filter-chip ${!showAll ? 'is-active' : ''}`} aria-pressed={!showAll} onClick={() => setShowAll(false)}>
            My deals
          </button>
          <button type="button" className={`filter-chip ${showAll ? 'is-active' : ''}`} aria-pressed={showAll} onClick={() => setShowAll(true)}>
            League-wide
          </button>
        </div>
        <div className="trade-list">
          {visibleTrades.map((trade) => (
            <TradeCard key={trade.id} state={state} trade={trade} me={me} onAction={onAction} busy={busy} />
          ))}
          {!visibleTrades.length && (
            <p className="feed-empty">
              {windowInfo.open
                ? 'No trades yet. File an EOI above — or scout what the rival franchises are planning.'
                : 'No trades registered. The desk reopens in the next LCB window.'}
            </p>
          )}
        </div>
      </section>

      <RppPanel state={state} mine={mine} onAction={onAction} busy={busy} />

      <section className="panel">
        <div className="panel-heading"><h3>Integrity unit</h3><span className="panel-tag">ANTI-TAMPERING</span></div>
        <p className="balance-note">
          No franchise may contact a contracted player outside the official EOI channel. Upheld tampering
          brings a purse fine and can ban the player for up to a year.
        </p>
        <div className="trade-form">
          <div className="trade-fee-fields">
            <label>
              Offending franchise
              <select value={reportFranchise} onChange={(event) => { setReportFranchise(event.target.value); setReportPlayer(''); }}>
                <option value="">Select…</option>
                {(state.franchises || []).map((franchise) => (
                  <option key={franchise.id} value={franchise.id}>{franchise.name}</option>
                ))}
              </select>
            </label>
            <label>
              Player involved
              <select value={reportPlayer} onChange={(event) => setReportPlayer(event.target.value)} disabled={!reportFranchiseObj}>
                <option value="">Select…</option>
                {(reportFranchiseObj?.squad || []).map((id) => {
                  const player = playerById(state, id);
                  return player ? <option key={id} value={id}>{player.name}</option> : null;
                })}
              </select>
            </label>
          </div>
          <label className="trade-details">
            Details
            <input type="text" maxLength={240} value={reportDetails} placeholder="Informal contact before an EOI…"
              onChange={(event) => setReportDetails(event.target.value)} />
          </label>
          <div className="trade-actions">
            <button type="button" className="btn btn-ghost" disabled={busy || !reportFranchise || !reportPlayer}
              onClick={() => onAction('REPORT_TAMPERING', { franchiseId: reportFranchise, playerId: reportPlayer, details: reportDetails })}>
              Report to the League Control Board
            </button>
          </div>
        </div>
        <div className="trade-list">
          {tamperingCases.map((record) => {
            const ruling = rulings[record.id] || { fine: 0.5, ban: true };
            const franchise = franchiseById(state, record.franchiseId);
            const player = playerById(state, record.playerId);
            return (
              <div key={record.id} className="trade-card">
                <div className="trade-card-head">
                  <span className="trade-id">{record.id}</span>
                  <span className={`trade-status trade-status-${record.status === 'UPHELD' ? 'bad' : record.status === 'DISMISSED' ? 'ok' : 'pending'}`}>
                    {record.status}
                  </span>
                </div>
                <p className="trade-route">
                  <strong>{franchise?.name || record.franchiseId}</strong> contacted <strong>{player?.name || record.playerId}</strong>
                  <small> · {record.details}</small>
                </p>
                {record.status === 'REPORTED' && (
                  <div className="trade-actions">
                    <label className="trade-inline-field">
                      Fine (Cr)
                      <input type="number" min="0" step="0.25" value={ruling.fine}
                        onChange={(event) => setRulings((current) => ({ ...current, [record.id]: { ...ruling, fine: event.target.value } }))} />
                    </label>
                    <label className="trade-inline-field trade-inline-check">
                      <input type="checkbox" checked={ruling.ban}
                        onChange={(event) => setRulings((current) => ({ ...current, [record.id]: { ...ruling, ban: event.target.checked } }))} />
                      Ban player 1 season
                    </label>
                    <button type="button" className="btn btn-primary" disabled={busy}
                      onClick={() => onAction('RULE_TAMPERING', { caseId: record.id, upheld: true, fine: Number(ruling.fine) || 0, banSeasons: ruling.ban ? 1 : 0 })}>
                      Uphold
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={busy}
                      onClick={() => onAction('RULE_TAMPERING', { caseId: record.id, upheld: false })}>
                      Dismiss
                    </button>
                  </div>
                )}
                {record.ruling?.upheld && (
                  <p className="trade-reason">
                    Ruling: fine {cr(record.ruling.fine || 0)}
                    {record.ruling.banSeasons > 0 ? ` · player banned through ${player?.banUntilSeason || 'next season'}` : ''}
                  </p>
                )}
              </div>
            );
          })}
          {!tamperingCases.length && <p className="feed-empty">No tampering allegations on file.</p>}
        </div>
      </section>
    </div>
  );
}
