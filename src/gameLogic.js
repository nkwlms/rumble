export const BOARD_SIZE = 12;
export const HAND_SIZE = 7;
export const COLORS = ['red', 'blue'];

// ── Starting stars — one per quadrant ────────────────────────────────────────
// (3,3), (3,11), (11,3), (11,11) — symmetric around centre (7,7)
export const STARS = [[3, 3], [3, 8], [8, 3], [8, 8]];
export const STAR_SET = new Set(STARS.map(([r, c]) => `${r},${c}`));

// ── Premium squares ───────────────────────────────────────────────────────────
export const PREMIUM = {};
[
  [1, 1], [1, 10], [10, 1], [10, 10],  // 2× Word — inner corners
].forEach(([r, c]) => { PREMIUM[`${r},${c}`] = 'dw'; });
[
  [0, 4], [0, 7],  [11, 4], [11, 7],   // 2× Number — top/bottom edges
  [4, 0], [7, 0],  [4, 11], [7, 11],   // 2× Number — left/right edges
  [2, 3], [2, 8],  [9, 3],  [9, 8],    // 2× Number — inner ring
  [3, 2], [8, 2],  [3, 9],  [8, 9],    // 2× Number — inner ring (transposed)
].forEach(([r, c]) => { PREMIUM[`${r},${c}`] = 'dn'; });

// ── Tile bag ──────────────────────────────────────────────────────────────────
// 7 values × 4 colors × 2 copies = 56 number tiles + 4 wildcards = 60 total

export function createBag() {
  const bag = [];
  let id = 0;
  for (const color of COLORS) {
    for (let val = 1; val <= 7; val++) {
      for (let copy = 0; copy < 3; copy++) {
        bag.push({ value: val, color, id: `tile-${id++}`, isWild: false });
      }
    }
  }
  for (let w = 0; w < 4; w++) {
    bag.push({ value: 0, color: null, id: `wild-${w}`, isWild: true, chosen: null, chosenColor: null });
  }
  return shuffle(bag);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawTiles(bag, count) {
  const n = Math.min(count, bag.length);
  return { drawn: bag.slice(0, n), newBag: bag.slice(n) };
}

// ── Word validation ───────────────────────────────────────────────────────────
//
// Each cell: { row, col, value (effective), tile (raw object) }
// Wildcards: tile.isWild=true, tile.chosen=number, tile.chosenColor=string
//
// VALID PLAY:
//   Set  — all tiles share the same value (any mix of colors)
//   Run  — all tiles share the same color AND form consecutive integers
//          (wildcards adapt color/value to make a run work)

export function isValidWord(cells) {
  if (cells.length <= 1) return true;

  const nonWilds = cells.filter(c => !c.tile.isWild);
  if (nonWilds.length === 0) return true; // all wildcards → trivially valid

  // ── Try as SET: same effective value, any color ───────────────────────────
  const refVal = nonWilds[0].value; // effective value (face value for non-wilds)
  if (nonWilds.every(c => c.value === refVal)) return true;

  // ── Try as RUN: same color, no duplicate values, bridgeable by wildcards ──
  const refColor = nonWilds[0].tile.color;
  if (!nonWilds.every(c => c.tile.color === refColor)) return false; // mixed colors

  const vals = nonWilds.map(c => c.value).sort((a, b) => a - b);
  // Duplicate values in a run are illegal
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] === vals[i - 1]) return false;
  }

  // Wildcards can fill gaps or extend either end.
  // For a valid arrangement to exist: the spread of non-wild values must fit
  // within the total tile count.
  //   max - min  ≤  cells.length - 1
  const spread = vals[vals.length - 1] - vals[0];
  return spread <= cells.length - 1;
}

// ── Board helpers ─────────────────────────────────────────────────────────────

function getWord(board, r, c, dir) {
  const dr = dir === 'v' ? 1 : 0;
  const dc = dir === 'h' ? 1 : 0;

  let sr = r, sc = c;
  while (sr - dr >= 0 && sc - dc >= 0 && board[sr - dr][sc - dc]) {
    sr -= dr; sc -= dc;
  }

  const cells = [];
  let cr = sr, cc = sc;
  while (cr < BOARD_SIZE && cc < BOARD_SIZE && board[cr][cc]) {
    const tile = board[cr][cc];
    const value = tile.isWild ? tile.chosen : tile.value;
    cells.push({ row: cr, col: cc, value, tile });
    cr += dr; cc += dc;
  }
  return cells;
}

// ── Placement validation ──────────────────────────────────────────────────────
//
// A placement is anchored if it either:
//   (a) connects to at least one existing committed tile, OR
//   (b) covers at least one of the four starting stars

export function validatePlacement(board, pending) {
  const entries = Object.entries(pending).map(([key, tile]) => {
    const [r, c] = key.split(',').map(Number);
    return { row: r, col: c, tile };
  });

  if (entries.length === 0) return { valid: false, reason: 'Place at least one tile.' };

  const merged = board.map(row => [...row]);
  for (const { row, col, tile } of entries) merged[row][col] = tile;

  const rows = [...new Set(entries.map(e => e.row))];
  const cols = [...new Set(entries.map(e => e.col))];
  const sameRow = rows.length === 1;
  const sameCol = cols.length === 1;

  if (!sameRow && !sameCol) {
    return { valid: false, reason: 'All tiles must be in the same row or column.' };
  }

  // Contiguous check (no gaps between the outermost pending tiles)
  if (entries.length > 1) {
    if (sameRow) {
      const r = rows[0];
      const cMin = Math.min(...cols), cMax = Math.max(...cols);
      for (let c = cMin; c <= cMax; c++)
        if (!merged[r][c]) return { valid: false, reason: 'Tiles must be contiguous — no gaps allowed.' };
    } else {
      const c = cols[0];
      const rMin = Math.min(...rows), rMax = Math.max(...rows);
      for (let r = rMin; r <= rMax; r++)
        if (!merged[r][c]) return { valid: false, reason: 'Tiles must be contiguous — no gaps allowed.' };
    }
  }

  // Anchor check
  const connectsToBoard = entries.some(({ row, col }) =>
    [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]].some(
      ([nr, nc]) => nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc]
    )
  );
  const coversStar = entries.some(({ row, col }) => STAR_SET.has(`${row},${col}`));

  if (!connectsToBoard && !coversStar) {
    return { valid: false, reason: 'Tiles must connect to existing tiles or cover a starting star (★).' };
  }

  // Validate every affected word
  const checked = new Set();
  for (const { row, col } of entries) {
    for (const dir of ['h', 'v']) {
      const word = getWord(merged, row, col, dir);
      if (word.length < 2) continue;
      const key = `${dir}:${word[0].row},${word[0].col}`;
      if (checked.has(key)) continue;
      checked.add(key);
      if (!isValidWord(word)) {
        const desc = word.map(c =>
          c.tile.isWild
            ? `★(${c.value})`
            : `${c.tile.color[0].toUpperCase()}${c.value}`
        ).join('-');
        return { valid: false, reason: `[${desc}] — runs need same color, sets need same number.` };
      }
    }
  }

  return { valid: true };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export function scorePlacement(board, pending) {
  const pendingSet = new Set(Object.keys(pending));
  const merged = board.map(row => [...row]);
  const pendingEntries = Object.entries(pending).map(([key, tile]) => {
    const [r, c] = key.split(',').map(Number);
    merged[r][c] = tile;
    return { row: r, col: c };
  });

  let total = 0;
  const scored = new Set();

  for (const { row, col } of pendingEntries) {
    for (const dir of ['h', 'v']) {
      const word = getWord(merged, row, col, dir);
      if (word.length < 2) continue;
      const wKey = `${dir}:${word[0].row},${word[0].col}`;
      if (scored.has(wKey)) continue;
      scored.add(wKey);

      let wordScore = 0;
      let wordMult = 1;
      for (const cell of word) {
        const cellKey = `${cell.row},${cell.col}`;
        const prem = PREMIUM[cellKey];
        const tileScore = cell.tile.value; // wildcards = 0
        if (pendingSet.has(cellKey) && prem === 'dn') {
          wordScore += tileScore * 2;
        } else {
          wordScore += tileScore;
        }
        if (pendingSet.has(cellKey) && prem === 'dw') wordMult *= 2;
      }
      total += wordScore * wordMult;
    }
  }

  // Single tile that formed no multi-tile words
  if (total === 0) {
    const [key, tile] = Object.entries(pending)[0];
    const prem = PREMIUM[key];
    const base = tile.value;
    total = prem === 'dn' ? base * 2 : base;
    if (prem === 'dw') total *= 2;
  }

  return total;
}

// ── Board mutation ────────────────────────────────────────────────────────────

export function commitPending(board, pending) {
  const next = board.map(row => [...row]);
  for (const [key, tile] of Object.entries(pending)) {
    const [r, c] = key.split(',').map(Number);
    next[r][c] = tile;
  }
  return next;
}

// ── End-game helpers ──────────────────────────────────────────────────────────

export function getWinnerText(players) {
  const max = Math.max(...players.map(p => p.score));
  const winners = players.flatMap((p, i) => (p.score === max ? [i + 1] : []));
  if (winners.length > 1) return `It's a tie! Both scored ${max} pts.`;
  return `Player ${winners[0]} wins with ${max} pts!`;
}
