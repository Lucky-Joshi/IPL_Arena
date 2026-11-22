const RAW_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const API_BASE = RAW_BASE.replace(/\/+$/, '');

async function read(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      cache: 'no-store',
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    throw new Error(
      `Cannot reach the auction server at ${API_BASE}. Start the backend, then try again.`
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Auction server returned ${response.status}.`);
  }
  return payload;
}

export async function getState() {
  const payload = await read('/api/auction/state', { method: 'GET' });
  return {
    state: payload?.state ?? null,
    hasSave: Boolean(payload?.hasSave),
    saveError: payload?.saveError || null,
  };
}

export async function postAction(action, payload = {}) {
  const response = await read('/api/auction', {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  });

  // The backend persists every mutation; re-read so the caller always gets
  // the authoritative snapshot after an action.
  let snapshot = null;
  try {
    snapshot = await getState();
  } catch {
    // The POST response itself contains the updated state.
  }

  const state = snapshot?.state ?? response?.state ?? null;
  const hasSave = snapshot?.hasSave ?? Boolean(state);

  if (response?.ok === false) {
    const error = new Error(response.error || 'The backend rejected that action.');
    error.state = state;
    error.action = action;
    throw error;
  }

  return { ok: true, state, hasSave, error: null };
}

export async function getResults() {
  const payload = await read('/api/results', { method: 'GET' });
  if (payload?.ok === false) {
    throw new Error(payload.error || 'Results are not available yet.');
  }
  return payload?.results ?? null;
}

export async function getHealth() {
  return read('/api/health', { method: 'GET' });
}
