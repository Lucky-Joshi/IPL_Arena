'use client';

import { useEffect, useRef } from 'react';
import { eventStyle, formatTime } from '../lib/format';

export default function EventFeed({ state }) {
  const endRef = useRef(null);
  const events = state.eventLog || [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [events.length]);

  return (
    <section className="panel event-feed">
      <div className="panel-heading">
        <h3>Proceedings feed</h3>
        <span className="panel-tag live-tag">CHRONOLOGICAL</span>
      </div>
      <div className="event-list">
        {events.length === 0 && <p className="feed-empty">The auctioneer is setting up the room…</p>}
        {events.map((event) => {
          const style = eventStyle(event.type);
          return (
            <div key={event.id} className={`event-row event-${style.tone}`}>
              <span className="event-icon" aria-hidden="true">{style.icon}</span>
              <div>
                <div className="event-meta">
                  <span className="event-type">{String(event.type || 'SYSTEM').replace(/_/g, ' ')}</span>
                  <time>{formatTime(event.at)}</time>
                </div>
                <p>{event.text}</p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </section>
  );
}
