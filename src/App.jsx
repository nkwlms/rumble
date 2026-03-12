import { useState, useRef } from 'react';
import {
  BOARD_SIZE,
  HAND_SIZE,
  COLORS,
  STAR_SET,
  PREMIUM,
  createBag,
  drawTiles,
  shuffle,
  validatePlacement,
  scorePlacement,
  commitPending,
  getWinnerText,
} from './gameLogic';
import './App.css';

const NUM_PLAYERS = 2;

const COLOR_LABELS = { red: 'Red', blue: 'Blue', green: 'Green', orange: 'Orange' };

function initGame() {
  let bag = createBag();
  const players = [];
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const { drawn, newBag } = drawTiles(bag, HAND_SIZE);
    players.push({ rack: drawn, score: 0 });
    bag = newBag;
  }
  return {
    board: Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)),
    bag,
    players,
    currentPlayer: 0,
    pending: {},
    selectedIdx: null,
    message: "Player 1's turn — select a tile then click the board.",
    gameOver: false,
  };
}

function Tile({ tile, size = 'board', selected = false, onClick, onDragStart }) {
  const colorClass = tile.isWild
    ? `c-${tile.chosenColor ?? 'wild'}`
    : `c-${tile.color}`;
  const label = tile.isWild
    ? (tile.chosen != null ? tile.chosen : '★')
    : tile.value;

  return (
    <div
      className={[
        'tile',
        `tile--${size}`,
        selected ? 'tile--selected' : '',
        tile.isWild ? 'tile--wild' : '',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      draggable={size === 'rack'}
      onDragStart={onDragStart}
    >
      <span className={`tile-num ${colorClass}`}>{label}</span>
      {tile.isWild && <span className="wild-pip">★</span>}
    </div>
  );
}

export default function App() {
  const [game, setGame] = useState(initGame);
  const [showRules, setShowRules] = useState(false);
  const [wildPicker, setWildPicker] = useState(null);
  const [showBag, setShowBag] = useState(false);
  const [dragOver, setDragOver] = useState(null); // "r,c" key of hovered cell
  const dragIdx = useRef(null); // rack index being dragged

  const rack = game.players[game.currentPlayer].rack;
  const displayBoard = game.board.map((row, r) =>
    row.map((cell, c) => game.pending[`${r},${c}`] ?? cell)
  );

  // ── Placement helper ─────────────────────────────────────────────────────────

  function placeTile(r, c, rackIdx) {
    if (game.gameOver) return;
    const key = `${r},${c}`;
    if (game.board[r][c]) return;
    const tile = game.players[game.currentPlayer].rack[rackIdx];
    if (!tile) return;

    if (tile.isWild) {
      setWildPicker({ row: r, col: c, tile, rackIdx, step: 'color', chosenColor: null });
      return;
    }

    setGame(g => ({
      ...g,
      pending: { ...g.pending, [key]: tile },
      players: g.players.map((p, i) =>
        i === g.currentPlayer
          ? { ...p, rack: p.rack.filter((_, i2) => i2 !== rackIdx) }
          : p
      ),
      selectedIdx: null,
      message: `Placed ${tile.color} ${tile.value}.`,
    }));
  }

  // ── Rack ─────────────────────────────────────────────────────────────────────

  function selectRackTile(idx) {
    if (game.gameOver) return;
    setGame(g => ({ ...g, selectedIdx: g.selectedIdx === idx ? null : idx }));
  }

  // ── Board click ──────────────────────────────────────────────────────────────

  function clickCell(r, c) {
    if (game.gameOver) return;
    const key = `${r},${c}`;

    if (game.pending[key]) {
      setGame(g => {
        const recalled = { ...g.pending[key], chosen: null, chosenColor: null };
        const newPending = { ...g.pending };
        delete newPending[key];
        return {
          ...g,
          pending: newPending,
          players: g.players.map((p, i) =>
            i === g.currentPlayer ? { ...p, rack: [...p.rack, recalled] } : p
          ),
          selectedIdx: null,
          message: 'Tile recalled.',
        };
      });
      return;
    }

    if (game.board[r][c]) return;

    if (game.selectedIdx === null) {
      setGame(g => ({ ...g, message: 'Select a tile from your rack first!' }));
      return;
    }

    placeTile(r, c, game.selectedIdx);
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────────

  function handleDragStart(e, rackIdx) {
    dragIdx.current = rackIdx;
    e.dataTransfer.effectAllowed = 'move';
    setGame(g => ({ ...g, selectedIdx: null }));
  }

  function handleDragOver(e, key) {
    if (dragIdx.current === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(key);
  }

  function handleDragLeave() {
    setDragOver(null);
  }

  function handleDrop(e, r, c) {
    e.preventDefault();
    setDragOver(null);
    const src = dragIdx.current;
    dragIdx.current = null;
    if (src === null) return;
    const key = `${r},${c}`;
    if (game.pending[key] || game.board[r][c]) return;
    placeTile(r, c, src);
  }

  // ── Wildcard picker ──────────────────────────────────────────────────────────

  function pickWildColor(color) {
    setWildPicker(wp => ({ ...wp, step: 'value', chosenColor: color }));
  }

  function confirmWild(chosen) {
    const { row, col, tile, rackIdx, chosenColor } = wildPicker;
    const placed = { ...tile, chosen, chosenColor };
    setGame(g => ({
      ...g,
      pending: { ...g.pending, [`${row},${col}`]: placed },
      players: g.players.map((p, i) =>
        i === g.currentPlayer
          ? { ...p, rack: p.rack.filter((_, i2) => i2 !== rackIdx) }
          : p
      ),
      selectedIdx: null,
      message: `Wildcard placed as ${COLOR_LABELS[chosenColor]} ${chosen}.`,
    }));
    setWildPicker(null);
  }

  function cancelWild() {
    setWildPicker(null);
    setGame(g => ({ ...g, selectedIdx: null }));
  }

  // ── Play ─────────────────────────────────────────────────────────────────────

  function play() {
    setGame(g => {
      if (Object.keys(g.pending).length === 0)
        return { ...g, message: 'Place at least one tile before pressing Play!' };

      const result = validatePlacement(g.board, g.pending);
      if (!result.valid) return { ...g, message: `❌ ${result.reason}` };

      const points = scorePlacement(g.board, g.pending);
      const newBoard = commitPending(g.board, g.pending);
      const { drawn, newBag } = drawTiles(g.bag, Object.keys(g.pending).length);
      const newRack = [...g.players[g.currentPlayer].rack, ...drawn];

      const newPlayers = g.players.map((p, i) =>
        i === g.currentPlayer ? { ...p, score: p.score + points, rack: newRack } : p
      );
      const nextPlayer = (g.currentPlayer + 1) % NUM_PLAYERS;
      const gameOver = newBag.length === 0 && newRack.length === 0;

      return {
        ...g,
        board: newBoard,
        bag: newBag,
        players: newPlayers,
        currentPlayer: nextPlayer,
        pending: {},
        selectedIdx: null,
        gameOver,
        message: gameOver
          ? `🏆 Game over! ${getWinnerText(newPlayers)}`
          : `✅ +${points} pts! Player ${nextPlayer + 1}'s turn.`,
      };
    });
  }

  function recallAll() {
    setGame(g => {
      const recalled = Object.values(g.pending).map(t => ({ ...t, chosen: null, chosenColor: null }));
      if (recalled.length === 0) return g;
      return {
        ...g,
        pending: {},
        players: g.players.map((p, i) =>
          i === g.currentPlayer ? { ...p, rack: [...p.rack, ...recalled] } : p
        ),
        selectedIdx: null,
        message: 'All tiles recalled.',
      };
    });
  }

  function pass() {
    setGame(g => {
      const recalled = Object.values(g.pending).map(t => ({ ...t, chosen: null, chosenColor: null }));
      const fullRack = [...g.players[g.currentPlayer].rack, ...recalled];
      const newBagPool = shuffle([...g.bag, ...fullRack]);
      const { drawn, newBag } = drawTiles(newBagPool, HAND_SIZE);
      const nextPlayer = (g.currentPlayer + 1) % NUM_PLAYERS;
      return {
        ...g,
        bag: newBag,
        players: g.players.map((p, i) =>
          i === g.currentPlayer ? { ...p, rack: drawn } : p
        ),
        currentPlayer: nextPlayer,
        pending: {},
        selectedIdx: null,
        message: `Player ${g.currentPlayer + 1} passed. Player ${nextPlayer + 1}'s turn.`,
      };
    });
  }

  // ── Score preview ─────────────────────────────────────────────────────────────

  const previewScore = (() => {
    if (game.gameOver || Object.keys(game.pending).length === 0) return null;
    if (!validatePlacement(game.board, game.pending).valid) return null;
    return scorePlacement(game.board, game.pending);
  })();

  // ── Bag summary ──────────────────────────────────────────────────────────────

  const bagGroups = (() => {
    const groups = { wild: 0 };
    for (const c of COLORS) groups[c] = {};
    for (const t of game.bag) {
      if (t.isWild) groups.wild++;
      else groups[t.color][t.value] = (groups[t.color][t.value] || 0) + 1;
    }
    return groups;
  })();

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app">

      {/* Bag viewer overlay */}
      {showBag && (
        <div className="wild-overlay" onClick={() => setShowBag(false)}>
          <div className="bag-modal" onClick={e => e.stopPropagation()}>
            <div className="bag-modal__title">Bag · {game.bag.length} tiles remaining</div>
            {COLORS.map(color => {
              const chips = [1,2,3,4,5,6,7].filter(v => (bagGroups[color][v] || 0) > 0);
              return (
                <div key={color} className="bag-modal__row">
                  <span className={`bag-modal__color-label c-${color}`}>{COLOR_LABELS[color]}</span>
                  <div className="bag-modal__chips">
                    {chips.length > 0
                      ? chips.map(v => (
                          <span key={v} className={`bag-chip c-${color}`}>
                            {v}{bagGroups[color][v] > 1 && <sup>×{bagGroups[color][v]}</sup>}
                          </span>
                        ))
                      : <span className="bag-empty">none</span>
                    }
                  </div>
                </div>
              );
            })}
            {bagGroups.wild > 0 && (
              <div className="bag-modal__row">
                <span className="bag-modal__color-label c-wild">Wild</span>
                <div className="bag-modal__chips">
                  <span className="bag-chip c-wild">★{bagGroups.wild > 1 && <sup>×{bagGroups.wild}</sup>}</span>
                </div>
              </div>
            )}
            <button className="wild-picker__cancel" style={{alignSelf:'center'}} onClick={() => setShowBag(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Wildcard picker overlay */}
      {wildPicker && (
        <div className="wild-overlay" onClick={cancelWild}>
          <div className="wild-picker" onClick={e => e.stopPropagation()}>
            {wildPicker.step === 'color' ? (
              <>
                <div className="wild-picker__title">Choose wildcard color</div>
                <div className="wild-picker__colors">
                  {COLORS.map(col => (
                    <button
                      key={col}
                      className={`wild-color-btn wc-${col}`}
                      onClick={() => pickWildColor(col)}
                    >
                      {COLOR_LABELS[col]}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="wild-picker__title">
                  Choose value
                  <span className={`wild-picker__color-tag wc-${wildPicker.chosenColor}`}>
                    {COLOR_LABELS[wildPicker.chosenColor]}
                  </span>
                </div>
                <div className="wild-picker__grid">
                  {[1, 2, 3, 4, 5, 6, 7].map(n => (
                    <button
                      key={n}
                      className={`wild-picker__btn c-${wildPicker.chosenColor}`}
                      onClick={() => confirmWild(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button className="wild-picker__cancel" onClick={cancelWild}>Cancel</button>
          </div>
        </div>
      )}

      <aside className="sidebar">

      <header className="header">
        <h1 className="title">RUMBLE</h1>
        <button className="rules-btn" onClick={() => setShowRules(v => !v)}>
          {showRules ? 'Hide Rules' : '? How to Play'}
        </button>
      </header>

      {showRules && (
        <div className="rules-panel">
          <h3>How to Play</h3>
          <ul>
            <li><strong>Select</strong> a tile (or drag it) then <strong>click or drop</strong> onto a cell. Click a placed orange tile to recall it.</li>
            <li>
              Valid plays:
              <ul>
                <li><strong>Run</strong> — same color, consecutive numbers (e.g. <span className="c-red ex">R3</span> <span className="c-red ex">R4</span> <span className="c-red ex">R5</span>)</li>
                <li><strong>Set</strong> — same number, any color (e.g. <span className="c-red ex">R6</span> <span className="c-blue ex">B6</span>)</li>
              </ul>
            </li>
            <li>All tiles in one turn must share a <strong>row or column</strong> and connect to the board or cover a <strong>★ star</strong>.</li>
            <li><strong>Wildcards (★)</strong> — pick a color and value when placed. They score 0 but bridge runs or fill sets. Placed wilds show a gold ★ mark.</li>
            <li><span className="rule-dn">2N</span> doubles that tile's value · <span className="rule-dw">2W</span> doubles the whole word — only for newly placed tiles.</li>
            <li><strong>Pass</strong> exchanges your whole rack and skips your turn. Click the <strong>Bag</strong> count to see what's left.</li>
          </ul>
        </div>
      )}

      <div className="scoreboard">
        {game.players.map((p, i) => (
          <div
            key={i}
            className={`score-card${i === game.currentPlayer && !game.gameOver ? ' score-card--active' : ''}`}
          >
            <div className="score-card__label">Player {i + 1}</div>
            <div className="score-card__value">{p.score}</div>
          </div>
        ))}
        <div className="bag-card" onClick={() => setShowBag(true)} title="Click to see bag contents">
          <div className="bag-card__label">Bag</div>
          <div className="bag-card__value">{game.bag.length}</div>
        </div>
      </div>

      <div className={`message${game.gameOver ? ' message--game-over' : ''}`}>
        {game.message}
      </div>

      <div className="controls">
        <div className="rack-area">
          <div className="rack-label">
            Player {game.currentPlayer + 1}'s Rack
            {Object.keys(game.pending).length > 0 && (
              <span className="pending-count"> · {Object.keys(game.pending).length} on board</span>
            )}
          </div>
          <div className="rack">
            {rack.map((tile, i) => (
              <Tile
                key={tile.id}
                tile={tile}
                size="rack"
                selected={game.selectedIdx === i}
                onClick={() => selectRackTile(i)}
                onDragStart={(e) => handleDragStart(e, i)}
              />
            ))}
            {rack.length === 0 && !game.gameOver && (
              <span className="rack-empty">— empty —</span>
            )}
          </div>
        </div>
          {previewScore !== null && (
            <div className="score-preview">+{previewScore} pts</div>
          )}
          <button className="btn btn--play"   onClick={play}      disabled={game.gameOver}>▶ Play</button>

        <div className="buttons">
          <button className="btn btn--recall" onClick={recallAll} disabled={game.gameOver}>↩ Recall</button>
          <button className="btn btn--pass"   onClick={pass}      disabled={game.gameOver}>⏭ Pass</button>
          <button className="btn btn--new"    onClick={() => { setWildPicker(null); setShowBag(false); setGame(initGame()); }}>↺ New Game</button>
        </div>
      </div>

      </aside>

      <div className="board-scroll">
        <div className="board">
          {displayBoard.map((row, r) =>
            row.map((cell, c) => {
              const key = `${r},${c}`;
              const isPending = !!game.pending[key];
              const prem = PREMIUM[key];
              const isStar = STAR_SET.has(key) && !cell;

              return (
                <div
                  key={key}
                  className={[
                    'cell',
                    isStar                ? 'cell--star' : '',
                    !cell && prem === 'dn' ? 'cell--dn'   : '',
                    !cell && prem === 'dw' ? 'cell--dw'   : '',
                    dragOver === key       ? 'cell--dragover' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => clickCell(r, c)}
                  onDragOver={(e) => handleDragOver(e, key)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, r, c)}
                >
                  {cell ? (
                    <div className={`tile tile--board${isPending ? ' tile--pending' : ' tile--placed'}${cell.isWild ? ' tile--wild' : ''}`}>
                      <span className={`tile-num c-${cell.isWild ? (cell.chosenColor ?? 'wild') : cell.color}`}>
                        {cell.isWild ? (cell.chosen ?? '★') : cell.value}
                      </span>
                      {cell.isWild && <span className="wild-pip">★</span>}
                    </div>
                  ) : isStar ? (
                    <span className="star-glyph">★</span>
                  ) : prem ? (
                    <span className="prem-label">{prem === 'dn' ? '2N' : '2W'}</span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}
