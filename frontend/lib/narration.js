'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const STORAGE_KEY = 't20-dynasty:narration';
const NarrationContext = createContext(null);

function canSpeak() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

export function NarrationProvider({ children }) {
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved.enabled === 'boolean') setEnabled(saved.enabled);
        if (typeof saved.muted === 'boolean') setMuted(saved.muted);
      }
    } catch {
      // Private mode / blocked storage — narration still works for this session.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, muted }));
    } catch {
      // Ignore storage failures.
    }
  }, [enabled, muted]);

  const cancel = useCallback(() => {
    if (!canSpeak()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore browser speech errors.
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const value = useMemo(
    () => ({
      enabled,
      muted,
      supported: canSpeak(),
      cancel,
      toggleEnabled: () => setEnabled((current) => !current),
      toggleMuted: () => setMuted((current) => !current),
    }),
    [enabled, muted, cancel]
  );

  return <NarrationContext.Provider value={value}>{children}</NarrationContext.Provider>;
}

export function useNarrationControls() {
  const context = useContext(NarrationContext);
  if (!context) {
    throw new Error('useNarrationControls must be used inside NarrationProvider');
  }
  return context;
}

export function useAuctioneerVoice(state) {
  const { enabled, muted, cancel } = useNarrationControls();
  const announcement = state?.announcement;
  const lastSpokenId = useRef(null);

  useEffect(() => {
    if (!enabled || muted) {
      cancel();
      return;
    }
    if (!announcement?.id || announcement.id === lastSpokenId.current) return;
    lastSpokenId.current = announcement.id;
    if (!canSpeak()) return;

    try {
      cancel();
      const utterance = new window.SpeechSynthesisUtterance(String(announcement.text || ''));
      utterance.lang = 'en-IN';
      utterance.rate = 1.04;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Narration is optional — the room remains fully usable.
    }
  }, [announcement?.id, announcement?.text, enabled, muted, cancel]);

  useEffect(() => () => cancel(), [cancel]);
}
