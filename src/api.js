const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxK_C0u3wfpHawR_HeCcYME3sT0OWL95DTy0ZbFOoxzvsH-4LdUKFlHlLGQF92SBorxbw/exec';

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
  // no-cors avoids the CORS error on Apps Script's redirect response.
  // The save reaches the server (data lands in the sheet) — we just can't read the reply.
  await fetch(url, { mode: 'no-cors' });
}
