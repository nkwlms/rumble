const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL;

export async function fetchGame(gameId) {
  const url = `${SCRIPT_URL}?action=get&gameId=${encodeURIComponent(gameId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function saveGame(gameId, state) {
  const url =
    `${SCRIPT_URL}?action=save` +
    `&gameId=${encodeURIComponent(gameId)}` +
    `&state=${encodeURIComponent(JSON.stringify(state))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
