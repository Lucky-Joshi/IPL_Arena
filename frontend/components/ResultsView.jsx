'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { postAction } from '../lib/api';
import { cappedLabel, cr, formatDateTime, isOverseas, roleColour, roleLabel, ROLES, seasonLabel, tradeStatusLabel, tradeTypeLabel } from '../lib/format';

function SummaryCard({ label, value, detail }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export default function ResultsView({ results }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const franchises = [...(results.franchises || [])].sort(
    (a, b) => (Number(a.rank) || 99) - (Number(b.rank) || 99)
  );
  const ranked = franchises.filter((entry) => entry.rank);
  const topSpender = [...franchises].sort((a, b) => b.purseSpent - a.purseSpent)[0];
  const bestBalance = [...franchises].sort((a, b) => (b.balanceScore || 0) - (a.balanceScore || 0))[0];

  const reset = async (navigate) => {
    setBusy(true);
    setError('');
    try {
      await postAction('RESET');
      if (navigate) {
        router.push('/');
      } else {
        setMessage('Saved auction cleared. Set up a new one whenever you are ready.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="results-view">
      <section className="results-hero">
        <div>
          <span className="eyebrow">FINAL REPORT · {seasonLabel(results)} · {results.format} AUCTION</span>
          <h1>Auction results</h1>
          <p>Generated {formatDateTime(results.generatedAt)} · every squad, purse and ranking verified.</p>
          {results.rules?.auctionNote && <p className="results-rule-note">{results.rules.auctionNote}</p>}
        </div>
        <div className="results-hero-badge">COMPLETE</div>
      </section>

      {error && <div className="inline-error" role="alert">{error}</div>}
      {message && <div className="notice notice-gold">{message} <Link className="inline-link" href="/">Go to setup →</Link></div>}

      <section className="summary-grid">
        <SummaryCard label="TOTAL SPEND" value={cr(results.totalAuctionSpending)} detail="Across all ten franchises" />
        <SummaryCard label="PLAYERS SOLD" value={results.soldCount ?? 0} detail="Hammered in the room" />
        <SummaryCard label="UNSOLD" value={results.unsoldCount ?? 0} detail="Left in the pool" />
        <SummaryCard label="FRANCHISES" value={franchises.length} detail="Fully audited squads" />
        <SummaryCard label="WELFARE FUND" value={cr(results.welfareFund)} detail="Overseas bids above the ₹18 Cr salary cap" />
        <SummaryCard label="MATCH FEES" value={cr(results.matchFeeProjection)} detail="Playing XI + Impact Player, league stage" />
        <SummaryCard label="RTM USED" value={results.rtmUsed ?? 0} detail="Right to Match cards exercised" />
        <SummaryCard label="RETENTIONS" value={`${results.cappedRetentions ?? 0} / ${results.uncappedRetentions ?? 0}`} detail="Capped / uncapped" />
      </section>

      <section className="panel ranking-panel">
        <div className="panel-heading"><h3>Final rankings</h3><span className="panel-tag">SQUAD STRENGTH</span></div>
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Rank</th><th>Franchise</th><th>Spent</th><th>Remaining</th>
                <th>Squad</th><th>Overseas</th><th>Cap left</th><th>Welfare</th><th>RTM</th>
                <th>Score</th><th>Assessment</th>
              </tr>
            </thead>
            <tbody>
              {franchises.map((entry) => (
                <tr key={entry.id} className={entry.rank === 1 ? 'is-winner' : ''} style={{ '--team-primary': entry.primary }}>
                  <td><span className="rank-chip">#{entry.rank ?? '—'}</span></td>
                  <td><strong style={{ color: entry.primary }}>{entry.name}</strong><small>{entry.short} · {entry.owner}</small></td>
                  <td>{cr(entry.purseSpent)}</td>
                  <td>{cr(entry.purseRemaining)}</td>
                  <td>{entry.playerCount} <small>({entry.purchasedCount} new)</small></td>
                  <td>{entry.overseasCount} <small>/ 8</small></td>
                  <td>{cr(entry.salaryHeadroom)} <small>of {cr(entry.salaryCap)}</small></td>
                  <td>{cr(entry.welfareContribution)}</td>
                  <td>{entry.rtmCards ?? 0} left · {entry.rtmUsed ?? 0} used</td>
                  <td><strong>{entry.balanceScore ?? '—'}</strong></td>
                  <td><span className="rank-reason">{entry.rankReason || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="report-columns">
        <section className="panel">
          <div className="panel-heading"><h3>Biggest purchases</h3><span className="panel-tag">TOP PRICE</span></div>
          <ol className="report-list">
            {(results.biggestPurchases || []).slice(0, 10).map((item) => (
              <li key={`${item.playerId}-${item.franchiseId}`}>
                <span className="report-list-main"><strong>{item.name}</strong><small>{item.franchiseName}</small></span>
                <strong className="gold-text">{cr(item.price)}</strong>
              </li>
            ))}
            {!results.biggestPurchases?.length && <li className="report-empty">No purchases recorded.</li>}
          </ol>
        </section>

        <section className="panel">
          <div className="panel-heading"><h3>Best value</h3><span className="panel-tag">VALUE SCORE</span></div>
          <ol className="report-list">
            {(results.bestValue || []).slice(0, 10).map((item) => (
              <li key={`${item.playerId}-${item.franchiseId}`}>
                <span className="report-list-main">
                  <strong>{item.name}</strong>
                  <small>{cr(item.price)} · rating {item.rating} · {item.franchiseId}</small>
                </span>
                <strong className="gold-text">{item.valueScore ?? '—'}</strong>
              </li>
            ))}
            {!results.bestValue?.length && <li className="report-empty">No valuations available.</li>}
          </ol>
        </section>
      </div>

      <section className="panel squad-report">
        <div className="panel-heading"><h3>All ten squads</h3><span className="panel-tag">EXISTING / PURCHASED</span></div>
        <div className="squad-report-grid">
          {franchises.map((entry) => (
            <details key={entry.id} className="squad-report-card" style={{ '--team-primary': entry.primary }}>
              <summary>
                <span className="squad-report-title"><strong>{entry.short}</strong> {entry.name}</span>
                <span className="squad-report-meta">
                  #{entry.rank} · {entry.playerCount} players · {cr(entry.purseSpent)} spent
                </span>
              </summary>
              <div className="squad-report-body">
                <div className="squad-report-stats">
                  <span>Remaining {cr(entry.purseRemaining)}</span>
                  <span>Cap left {cr(entry.salaryHeadroom)} / {cr(entry.salaryCap)}</span>
                  <span>Overseas salary {cr(entry.overseasSalarySpend)} / {entry.overseasSalaryCap ? cr(entry.overseasSalaryCap) : 'no cap'}</span>
                  <span>Retained {entry.retentionCappedCount} capped · {entry.retentionUncappedCount} uncapped</span>
                  <span>RTM {entry.rtmCards} left · {entry.rtmUsed} used</span>
                  <span>Welfare fund {cr(entry.welfareContribution)}</span>
                  <span>Overseas {entry.overseasCount}</span>
                  <span>Score {entry.balanceScore}</span>
                </div>
                <div className="role-distribution">
                  {ROLES.map((role) => (
                    <span key={role} style={{ '--role-colour': roleColour(role) }}>
                      {roleLabel(role)} <strong>{entry.roleCounts?.[role] || 0}</strong>
                    </span>
                  ))}
                </div>
                <div className="table-wrap">
                  <table className="report-table compact">
                    <thead><tr><th>Player</th><th>Role</th><th>Country</th><th>Status</th><th>Source</th><th>Price</th><th>Salary</th></tr></thead>
                    <tbody>
                      {(entry.squad || []).map((player) => (
                        <tr key={player.id}>
                          <td><strong>{player.name}</strong><small>rating {player.rating}</small></td>
                          <td>{roleLabel(player.role)}</td>
                          <td>{player.nationality}{isOverseas(player) ? ' (OS)' : ''}</td>
                          <td>{cappedLabel(player)}</td>
                          <td>
                            <span className={`source-badge source-${String(player.source || 'EXISTING').toLowerCase()}`}>
                              {player.source || 'EXISTING'}
                            </span>
                          </td>
                          <td>{player.source === 'PURCHASED' || player.source === 'TRADED' ? cr(player.price) : '—'}</td>
                          <td>{cr(player.salary ?? player.price ?? 0)}{Number(player.welfareContribution) > 0 && <small> + {cr(player.welfareContribution)} welfare</small>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="squad-report-reason">{entry.rankReason}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="panel unsold-panel">
        <div className="panel-heading"><h3>Unsold players</h3><span className="panel-tag">{results.unsold?.length || 0} PLAYERS</span></div>
        <div className="table-wrap">
          <table className="report-table compact">
            <thead><tr><th>Player</th><th>Role</th><th>Country</th><th>Rating</th><th>Base price</th></tr></thead>
            <tbody>
              {(results.unsold || []).map((player) => (
                <tr key={player.id}>
                  <td><strong>{player.name}</strong></td>
                  <td>{roleLabel(player.role)}</td>
                  <td>{player.nationality}</td>
                  <td>{player.rating}</td>
                  <td>{cr(player.basePrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!results.unsold?.length && <p className="report-empty">Every player found a home.</p>}
        </div>
      </section>

      <div className="report-columns">
        <section className="panel">
          <div className="panel-heading"><h3>Trade windows &amp; deals</h3><span className="panel-tag">{results.trades?.length || 0} DEALS</span></div>
          <ul className="report-list">
            {(results.tradeWindows || []).map((window) => (
              <li key={window.id}>
                <span className="report-list-main"><strong>{window.label}</strong><small>{window.detail}</small></span>
              </li>
            ))}
            {(results.trades || []).map((trade) => (
              <li key={trade.id}>
                <span className="report-list-main">
                  <strong>{trade.fromName || trade.fromFranchiseId} ⇄ {trade.toName || trade.toFranchiseId}</strong>
                  <small>
                    {tradeTypeLabel(trade.type)} · {trade.window || '—'}
                    {trade.givePlayers?.length ? ` · ${trade.fromName || trade.fromFranchiseId} sends ${trade.givePlayers.map((p) => p.name).join(', ')}` : ''}
                    {trade.getPlayers?.length ? ` · ${trade.toName || trade.toFranchiseId} sends ${trade.getPlayers.map((p) => p.name).join(', ')}` : ''}
                    {Number(trade.cash) > 0 ? ` · ${cr(trade.cash)} cash` : ''}
                    {trade.transferFee?.total > 0 ? ` · transfer fee ${cr(trade.transferFee.total)}` : ''}
                  </small>
                </span>
                <span className={`trade-status trade-status-${trade.status === 'APPROVED' ? 'ok' : ['REJECTED', 'VETOED', 'EXPIRED'].includes(trade.status) ? 'bad' : 'pending'}`}>
                  {tradeStatusLabel(trade.status)}
                </span>
              </li>
            ))}
            {!results.trades?.length && <li className="report-empty">No trades were registered.</li>}
          </ul>
          {Number(results.bcciTradeRevenue) > 0 && (
            <p className="balance-note">BCCI transfer-fee revenue: <strong>{cr(results.bcciTradeRevenue)}</strong></p>
          )}
          {(results.tamperingCases || []).length > 0 && (
            <ul className="report-list">
              {results.tamperingCases.map((record) => (
                <li key={record.id}>
                  <span className="report-list-main">
                    <strong>Tampering · {record.franchiseId}</strong>
                    <small>{record.playerId} · {record.status}{record.ruling?.upheld ? ` · fine ${cr(record.ruling.fine || 0)}` : ''}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-heading"><h3>Injuries &amp; withdrawals</h3><span className="panel-tag">RAPP / BAN</span></div>
          <ul className="report-list">
            {(results.injuries || []).map((player) => (
              <li key={player.playerId}>
                <span className="report-list-main">
                  <strong>{player.name}</strong>
                  <small>{player.status}{player.banUntilSeason ? ` · banned through ${player.banUntilSeason}` : ''}{player.replacedBy ? ` · replaced by ${player.replacedBy}` : ''}</small>
                </span>
              </li>
            ))}
            {!results.injuries?.length && <li className="report-empty">No injury replacements or withdrawals.</li>}
          </ul>
        </section>
      </div>

      <section className="panel final-summary">
        <div className="panel-heading"><h3>Final summary</h3><span className="panel-tag">THE CALL</span></div>
        <p>
          Ten franchises spent <strong>{cr(results.totalAuctionSpending)}</strong> to sign
          <strong> {results.soldCount}</strong> players, while <strong>{results.unsoldCount}</strong>
          players left the room unsold.
          {ranked[0] && <> <strong>{ranked[0].name}</strong> tops the rankings — {ranked[0].rankReason || 'the best-balanced squad in the room'}.</>}
          {topSpender && <> The biggest spender was <strong>{topSpender.name}</strong> at {cr(topSpender.purseSpent)}.</>}
          {bestBalance && <> The highest balance score went to <strong>{bestBalance.name}</strong> ({bestBalance.balanceScore}).</>}
          {' '}Right to Match was exercised <strong>{results.rtmUsed ?? 0}</strong> time{results.rtmUsed === 1 ? '' : 's'}, and{' '}
          <strong>{cr(results.welfareFund)}</strong> reached the BCCI player welfare fund from overseas bids above the salary cap.
        </p>
      </section>

      <div className="results-actions">
        <button type="button" className="btn btn-primary btn-large" onClick={() => reset(true)} disabled={busy}>
          {busy ? 'Working…' : 'New auction →'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => reset(false)} disabled={busy}>
          Clear save
        </button>
        <Link className="btn btn-ghost" href="/auction">Back to live room</Link>
      </div>
    </div>
  );
}
