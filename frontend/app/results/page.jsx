'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getResults } from '../../lib/api';
import ResultsView from '../../components/ResultsView';

export default function ResultsPage() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const report = await getResults();
      setResults(report);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="screen-state">
        <div className="loader" />
        <h1>Compiling the final report…</h1>
        <p>Checking every squad, purse and valuation.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen-state">
        <h1>Results unavailable</h1>
        <p>{error}</p>
        <div className="state-actions">
          <button type="button" className="btn btn-primary" onClick={load}>Try again</button>
          <Link className="btn btn-ghost" href="/">Set up an auction</Link>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="screen-state">
        <h1>No completed auction yet</h1>
        <p>Finish an auction to unlock the full report.</p>
        <Link className="btn btn-primary" href="/auction">Return to the live room</Link>
      </div>
    );
  }

  return <ResultsView results={results} />;
}
