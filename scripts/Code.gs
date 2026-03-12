// ── Rumble – Google Apps Script backend ──────────────────────────────────────
//
// SETUP:
//   1. Go to script.google.com → New Project
//   2. Paste this entire file, replacing the default Code.gs content
//   3. Deploy → New deployment → Web app
//      - Execute as: Me
//      - Who has access: Anyone
//   4. Copy the Web App URL into your .env.local as VITE_SCRIPT_URL=<url>
//   5. Re-deploy after any code changes (Deploy → Manage deployments → Edit)
//
// NOTE: The script automatically creates a "Games" sheet on first use.
// ─────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  const action = e.parameter.action;
  const gameId = e.parameter.gameId;

  try {
    if (action === 'get') {
      return respond(getGame(gameId));
    }
    if (action === 'save') {
      const state = JSON.parse(e.parameter.state);
      return respond(saveGameState(gameId, state));
    }
    return respond({ error: 'unknown_action' });
  } catch (err) {
    return respond({ error: err.toString() });
  }
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Games');
  if (!sheet) {
    sheet = ss.insertSheet('Games');
    sheet.appendRow(['gameId', 'state', 'updatedAt']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getGame(gameId) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === gameId) {
      return JSON.parse(data[i][1]);
    }
  }
  return { error: 'not_found' };
}

function saveGameState(gameId, state) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === gameId) {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(state));
      sheet.getRange(i + 1, 3).setValue(new Date().toISOString());
      return { ok: true };
    }
  }
  // New game — append a row
  sheet.appendRow([gameId, JSON.stringify(state), new Date().toISOString()]);
  return { ok: true, created: true };
}
