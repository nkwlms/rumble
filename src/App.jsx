import { useState, useRef, useEffect } from 'react';
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
import { fetchGame, saveGame } from './api';
import './App.css';

const NUM_PLAYERS = 2;
const COLOR_LABELS = { red: 'Red', blue: 'Blue', green: 'Green', orange: 'Orange' };
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxK_C0u3wfpHawR_HeCcYME3sT0OWL95DTy0ZbFOoxzvsH-4LdUKFlHlLGQF92SBorxbw/exec';
const POLL_MS = 4000;

function randId(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  while (s.length < len) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

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
    consecutivePasses: 0,
    lastMove: [],
  };
}

// Strip UI-only fields before syncing to server
function toSyncState(game) {
  const { pending, selectedIdx, ...rest } = game;
  return rest;
}

// Re-attach UI fields when loading from server
function fromSyncState(state) {
  return { ...state, pending: {}, selectedIdx: null };
}

function playerLabel(idx, myPlayer, names) {
  const name = names?.[idx];
  if (myPlayer === null) return name || `Player ${idx + 1}`;
  return name || (idx === myPlayer ? 'You' : 'Opponent');
}

function turnMsg(nextPlayer, myPlayer, names) {
  if (myPlayer === null) {
    const name = names?.[nextPlayer] || `Player ${nextPlayer + 1}`;
    return `${name}'s turn.`;
  }
  if (nextPlayer === myPlayer) return 'Your turn!';
  const opName = names?.[nextPlayer] || 'Opponent';
  return `${opName}'s turn — waiting…`;
}

// ── Tile component ────────────────────────────────────────────────────────────

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

// ── Install banner ────────────────────────────────────────────────────────────

function InstallBanner({ isIOS, onInstall, onDismiss }) {
  return (
    <div className="install-banner">
      <div className="install-banner__icon">📲</div>
      <div className="install-banner__text">
        {isIOS
          ? <>Tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to install Rumble</>
          : <>Add Rumble to your home screen for the best experience</>
        }
      </div>
      {isIOS
        ? <button className="install-banner__dismiss" onClick={onDismiss}>✕</button>
        : <>
            <button className="install-banner__btn" onClick={onInstall}>Add</button>
            <button className="install-banner__dismiss" onClick={onDismiss}>✕</button>
          </>
      }
    </div>
  );
}

// ── Lobby screen ──────────────────────────────────────────────────────────────

function Lobby({ onNew, onJoin, onLocal, syncing, name, onNameChange, activeGames, onResume }) {
  const [joinInput, setJoinInput] = useState('');
  const [editingName, setEditingName] = useState(!name);
  return (
    <div className="app lobby">
      <h1 className="title">RUMBLE</h1>
      <div className="lobby-card">
        {editingName ? (
          <input
            className="lobby-input lobby-name-input"
            placeholder="Your name"
            value={name}
            onChange={e => onNameChange(e.target.value)}
            maxLength={20}
            autoFocus
            onBlur={() => { if (name) setEditingName(false); }}
            onKeyDown={e => { if (e.key === 'Enter' && name) setEditingName(false); }}
          />
        ) : (
          <div className="lobby-playing-as">
            Playing as <strong>{name}</strong>
            <button className="lobby-edit-name" onClick={() => setEditingName(true)}>Edit</button>
          </div>
        )}
        {SCRIPT_URL ? (
          <>
            <button className="btn btn--play lobby-btn" onClick={onNew} disabled={syncing}>
              {syncing ? 'Creating…' : '+ New Online Game'}
            </button>
            <div className="lobby-divider">or join existing</div>
            <div className="lobby-join">
              <input
                className="lobby-input"
                placeholder="Game ID (e.g. AB3K9Z)"
                value={joinInput}
                onChange={e => setJoinInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && joinInput && onJoin(joinInput)}
                maxLength={8}
              />
              <button
                className="btn btn--recall"
                onClick={() => onJoin(joinInput)}
                disabled={!joinInput || syncing}
              >
                Join
              </button>
            </div>
            <div className="lobby-divider">or</div>
          </>
        ) : (
          <div className="lobby-no-backend">
            Set VITE_SCRIPT_URL to enable online play.
          </div>
        )}
        <button className="btn btn--new lobby-btn" onClick={onLocal}>
          Play Locally (same device)
        </button>
        {activeGames && activeGames.length > 0 && (
          <>
            <div className="lobby-divider">resume a game</div>
            {activeGames.map(({ id, state, myPlayer: myP }) => {
              const opIdx = myP === 0 ? 1 : 0;
              const opName = state.names?.[opIdx] || 'Opponent';
              const isMyTurn = !state.gameOver && state.currentPlayer === myP;
              return (
                <button key={id} className="active-game-btn" onClick={() => onResume(id)}>
                  <span className="active-game-id">{id}</span>
                  <span className="active-game-meta">
                    <span className="active-game-vs">vs {opName}</span>
                    <span className={`active-game-turn${isMyTurn ? ' active-game-turn--mine' : ''}`}>
                      {state.gameOver ? 'finished' : isMyTurn ? 'your turn' : "their turn"}
                    </span>
                  </span>
                </button>
              );
            })}
          </>
        )}
        {activeGames === null && SCRIPT_URL && (
          <div className="loading-msg" style={{ padding: '4px', fontSize: '0.8rem' }}>Loading games…</div>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const urlGameId = new URLSearchParams(window.location.search).get('game');

  // Save invite to localStorage so it survives "Add to Home Screen" on iOS.
  // When the PWA launches at start_url (/rumble/) with no query param,
  // we pick up the pending invite from localStorage instead.
  if (urlGameId) localStorage.setItem('rumble_pending_invite', urlGameId);
  const pendingInvite = !urlGameId ? localStorage.getItem('rumble_pending_invite') : null;
  const effectiveGameId = urlGameId || pendingInvite;

  const [mode, setMode] = useState(() => {
    if (effectiveGameId) return 'join-prompt';
    if (!SCRIPT_URL) return 'local';
    return 'lobby';
  });

  const [game, setGame] = useState(() => {
    if (effectiveGameId || SCRIPT_URL) return null;
    return initGame();
  });

  const [gameId, setGameId]     = useState(effectiveGameId);
  const [myPlayer, setMyPlayer] = useState(null);
  const [myName, setMyName]     = useState(() => localStorage.getItem('rumble_name') || '');

  function saveName(n) {
    setMyName(n);
    localStorage.setItem('rumble_name', n);
  }

  function addGameToHistory(id) {
    const games = JSON.parse(localStorage.getItem('rumble_games') || '[]');
    if (!games.includes(id)) {
      localStorage.setItem('rumble_games', JSON.stringify([id, ...games]));
    }
  }

  const [syncing, setSyncing]   = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [copyDone, setCopyDone] = useState(false);

  const [showRules, setShowRules] = useState(false);
  const [wildPicker, setWildPicker] = useState(null);
  const [showBag, setShowBag]   = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const dragIdx = useRef(null);
  const [activeGames, setActiveGames] = useState(null);

  // ── PWA install prompt ──────────────────────────────────────────────────────
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
  const installDismissed = localStorage.getItem('rumble_install_dismissed') === '1';

  useEffect(() => {
    if (isStandalone || installDismissed) return;
    const handler = e => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isStandalone || installDismissed) return;
    if (installPrompt || isIOS) {
      const t = setTimeout(() => setShowInstallBanner(true), 2000);
      return () => clearTimeout(t);
    }
  }, [installPrompt, isIOS]); // eslint-disable-line react-hooks/exhaustive-deps

  function dismissInstall() {
    setShowInstallBanner(false);
    localStorage.setItem('rumble_install_dismissed', '1');
  }

  async function triggerInstall() {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') setInstallPrompt(null);
    }
    dismissInstall();
  }

  // ── App badge (shows when it's your turn in an online game) ────────────────
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    const myTurn = mode === 'online' && game && !game.gameOver && game.currentPlayer === myPlayer;
    if (myTurn) navigator.setAppBadge(1).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  }, [mode, game?.currentPlayer, game?.gameOver, myPlayer]); // eslint-disable-line react-hooks/exhaustive-deps

  // (join-prompt handles the URL game load after name entry)

  // Fetch active games when returning to lobby
  useEffect(() => {
    if (mode !== 'lobby' || !SCRIPT_URL) { if (mode === 'lobby') setActiveGames([]); return; }
    const ids = JSON.parse(localStorage.getItem('rumble_games') || '[]');
    if (ids.length === 0) { setActiveGames([]); return; }
    setActiveGames(null); // loading
    Promise.all(ids.map(async id => {
      try {
        const stored = localStorage.getItem(`rumble_${id}`);
        if (!stored) return null;
        const { player: myP } = JSON.parse(stored);
        const state = await fetchGame(id);
        if (state.error) return null;
        return { id, state, myPlayer: myP };
      } catch { return null; }
    })).then(results => setActiveGames(results.filter(Boolean)));
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for updates when it's opponent's turn or waiting for them to join
  useEffect(() => {
    if (mode !== 'online' || !gameId || !game) return;
    if (game.gameOver) return;
    const needsPoll = game.status === 'waiting' || game.currentPlayer !== myPlayer;
    if (!needsPoll) return;

    const id = setInterval(async () => {
      try {
        const state = await fetchGame(gameId);
        setSyncError(false);
        const changed =
          state.currentPlayer !== game.currentPlayer ||
          state.status !== game.status ||
          state.gameOver !== game.gameOver;
        if (changed) setGame(fromSyncState(state));
      } catch {
        setSyncError(true);
      }
    }, POLL_MS);

    return () => clearInterval(id);
  }, [mode, gameId, game?.currentPlayer, game?.status, game?.gameOver, myPlayer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Online helpers ──────────────────────────────────────────────────────────

  async function loadOnlineGame(id) {
    try {
      const state = await fetchGame(id);
      if (state.error) { setMode('lobby'); return; }

      // Check if we're already a registered player
      const stored = localStorage.getItem(`rumble_${id}`);
      if (stored) {
        const { player: p, secret } = JSON.parse(stored);
        if (state.secrets?.[p] === secret) {
          localStorage.removeItem('rumble_pending_invite');
          setMyPlayer(p);
          setGame(fromSyncState(state));
          setGameId(id);
          setMode('online');
          return;
        }
      }

      // Auto-join as player 2 if the slot is still open
      if (state.status === 'waiting' && state.secrets?.[1] === null) {
        const secret = randId(16);
        const joinerName = localStorage.getItem('rumble_name') || '';
        const newState = { ...state, secrets: [state.secrets[0], secret], status: 'active', names: [state.names?.[0] ?? null, joinerName || null] };
        await saveGame(id, newState);
        localStorage.setItem(`rumble_${id}`, JSON.stringify({ player: 1, secret }));
        addGameToHistory(id);
        localStorage.removeItem('rumble_pending_invite');
        setMyPlayer(1);
        setGame(fromSyncState(newState));
        setGameId(id);
        setMode('online');
        return;
      }

      // Spectator / game already full
      localStorage.removeItem('rumble_pending_invite');
      setMyPlayer(null);
      setGame(fromSyncState(state));
      setGameId(id);
      setMode('online');
    } catch {
      setMode('lobby');
    }
  }

  async function createNewGame() {
    setSyncing(true);
    try {
      const id = randId(6);
      const secret = randId(16);
      const base = initGame();
      const state = { ...toSyncState(base), secrets: [secret, null], status: 'waiting', names: [myName || null, null] };
      await saveGame(id, state);
      localStorage.setItem(`rumble_${id}`, JSON.stringify({ player: 0, secret }));
      addGameToHistory(id);
      window.history.pushState(null, '', `?game=${id}`);
      setGameId(id);
      setMyPlayer(0);
      setGame(fromSyncState(state));
      setMode('online');
    } catch {
      alert('Failed to create game. Check your VITE_SCRIPT_URL.');
    } finally {
      setSyncing(false);
    }
  }

  async function joinOnlineGame(id) {
    setSyncing(true);
    try {
      const state = await fetchGame(id);
      if (state.error === 'not_found') { alert(`Game "${id}" not found.`); return; }
      if (state.secrets?.[1] !== null) { alert('This game already has two players.'); return; }
      const secret = randId(16);
      const newState = { ...state, secrets: [state.secrets[0], secret], status: 'active', names: [state.names?.[0] ?? null, myName || null] };
      await saveGame(id, newState);
      localStorage.setItem(`rumble_${id}`, JSON.stringify({ player: 1, secret }));
      addGameToHistory(id);
      window.history.pushState(null, '', `?game=${id}`);
      setGameId(id);
      setMyPlayer(1);
      setGame(fromSyncState(newState));
      setMode('online');
    } catch {
      alert('Failed to join game. Check the game ID and try again.');
    } finally {
      setSyncing(false);
    }
  }

  function syncGame(newGame) {
    if (mode !== 'online' || !gameId) return;
    setSyncing(true);
    setSyncError(false);
    saveGame(gameId, toSyncState(newGame))
      .then(() => setSyncError(false))
      .catch(() => setSyncError(true))
      .finally(() => setSyncing(false));
  }

  function startLocal() {
    window.history.pushState(null, '', window.location.pathname);
    setGameId(null);
    setMyPlayer(null);
    setGame(initGame());
    setMode('local');
  }

  function goLobby() {
    window.history.pushState(null, '', window.location.pathname);
    setMode('lobby');
    setGame(null);
    setGameId(null);
    setMyPlayer(null);
    setWildPicker(null);
    setShowBag(false);
  }

  function copyShareLink() {
    const url = `${window.location.origin}${window.location.pathname}?game=${gameId}`;
    navigator.clipboard.writeText(`Let's play Rumble: ${url}`).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  }

  // ── Placement helper ────────────────────────────────────────────────────────

  function placeTile(r, c, rackIdx) {
    if (!game || game.gameOver) return;
    if (mode === 'online' && game.currentPlayer !== myPlayer) return;
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

  function selectRackTile(idx) {
    if (!game || game.gameOver) return;
    if (mode === 'online' && game.currentPlayer !== myPlayer) return;
    setGame(g => ({ ...g, selectedIdx: g.selectedIdx === idx ? null : idx }));
  }

  function clickCell(r, c) {
    if (!game || game.gameOver) return;
    if (mode === 'online' && game.currentPlayer !== myPlayer) return;
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

  // ── Drag & drop ─────────────────────────────────────────────────────────────

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

  function handleDragLeave() { setDragOver(null); }

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

  // ── Wildcard picker ─────────────────────────────────────────────────────────

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

  // ── Play ────────────────────────────────────────────────────────────────────

  function play() {
    if (!game || game.gameOver) return;
    if (mode === 'online' && game.currentPlayer !== myPlayer) return;

    if (Object.keys(game.pending).length === 0) {
      setGame(g => ({ ...g, message: 'Place at least one tile before pressing Play!' }));
      return;
    }

    const result = validatePlacement(game.board, game.pending);
    if (!result.valid) {
      setGame(g => ({ ...g, message: `❌ ${result.reason}` }));
      return;
    }

    const points = scorePlacement(game.board, game.pending);
    const newBoard = commitPending(game.board, game.pending);
    const { drawn, newBag } = drawTiles(game.bag, Object.keys(game.pending).length);
    const newRack = [...game.players[game.currentPlayer].rack, ...drawn];

    const newPlayers = game.players.map((p, i) =>
      i === game.currentPlayer ? { ...p, score: p.score + points, rack: newRack } : p
    );
    const nextPlayer = (game.currentPlayer + 1) % NUM_PLAYERS;
    const gameOver = newBag.length === 0 && newRack.length === 0;

    const newGame = {
      ...game,
      board: newBoard,
      bag: newBag,
      players: newPlayers,
      currentPlayer: nextPlayer,
      pending: {},
      selectedIdx: null,
      consecutivePasses: 0,
      lastMove: Object.keys(game.pending),
      gameOver,
      message: gameOver
        ? `🏆 Game over! ${getWinnerText(newPlayers)}`
        : `✅ +${points} pts! ${turnMsg(nextPlayer, myPlayer, game.names)}`,
    };

    setGame(newGame);
    syncGame(newGame);
  }

  function recallAll() {
    if (!game) return;
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
    if (!game || game.gameOver) return;
    if (mode === 'online' && game.currentPlayer !== myPlayer) return;

    const recalled = Object.values(game.pending).map(t => ({ ...t, chosen: null, chosenColor: null }));
    const fullRack = [...game.players[game.currentPlayer].rack, ...recalled];
    const newBagPool = shuffle([...game.bag, ...fullRack]);
    const { drawn, newBag } = drawTiles(newBagPool, HAND_SIZE);
    const nextPlayer = (game.currentPlayer + 1) % NUM_PLAYERS;
    const nextConsecutivePasses = (game.consecutivePasses || 0) + 1;
    const gameOver = nextConsecutivePasses >= NUM_PLAYERS;

    const newPlayers = game.players.map((p, i) =>
      i === game.currentPlayer ? { ...p, rack: drawn } : p
    );

    const newGame = {
      ...game,
      bag: newBag,
      players: newPlayers,
      currentPlayer: nextPlayer,
      pending: {},
      selectedIdx: null,
      consecutivePasses: nextConsecutivePasses,
      lastMove: [],
      gameOver,
      message: gameOver
        ? `🏆 Game over! ${getWinnerText(newPlayers)}`
        : `${playerLabel(game.currentPlayer, myPlayer, game.names)} passed. ${turnMsg(nextPlayer, myPlayer, game.names)}`,
    };

    setGame(newGame);
    syncGame(newGame);
  }

  function newGame() {
    setWildPicker(null);
    setShowBag(false);
    if (mode === 'online') {
      goLobby();
    } else {
      setGame(initGame());
    }
  }

  // ── Score preview ───────────────────────────────────────────────────────────

  const previewScore = (() => {
    if (!game || game.gameOver || Object.keys(game.pending).length === 0) return null;
    if (!validatePlacement(game.board, game.pending).valid) return null;
    return scorePlacement(game.board, game.pending);
  })();

  // ── Bag summary ─────────────────────────────────────────────────────────────

  const bagGroups = (() => {
    if (!game) return null;
    const groups = { wild: 0 };
    for (const c of COLORS) groups[c] = {};
    for (const t of game.bag) {
      if (t.isWild) groups.wild++;
      else groups[t.color][t.value] = (groups[t.color][t.value] || 0) + 1;
    }
    return groups;
  })();

  // ── Render: Join prompt (arrived via share link) ────────────────────────────

  if (mode === 'join-prompt') {
    return (
      <div className="app lobby">
        <h1 className="title">RUMBLE</h1>
        <div className="lobby-card">
          <div className="lobby-divider" style={{ fontSize: '0.9rem', color: '#8fa0b4' }}>
            You've been invited to a game
          </div>
          <input
            className="lobby-input lobby-name-input"
            placeholder="Your name"
            value={myName}
            onChange={e => saveName(e.target.value)}
            maxLength={20}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') { setMode('loading'); loadOnlineGame(gameId); }
            }}
          />
          <button
            className="btn btn--play lobby-btn"
            onClick={() => { setMode('loading'); loadOnlineGame(gameId); }}
          >
            Join Game
          </button>
          <button className="wild-picker__cancel" style={{ alignSelf: 'center' }}
            onClick={() => { localStorage.removeItem('rumble_pending_invite'); window.history.pushState(null, '', window.location.pathname); setMode('lobby'); }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Lobby ───────────────────────────────────────────────────────────

  if (mode === 'lobby') {
    return (
      <>
        <Lobby
          onNew={createNewGame}
          onJoin={joinOnlineGame}
          onLocal={startLocal}
          syncing={syncing}
          name={myName}
          onNameChange={saveName}
          activeGames={activeGames}
          onResume={id => { window.location.assign(`${window.location.pathname}?game=${id}`); }}
        />
        {showInstallBanner && <InstallBanner isIOS={isIOS} onInstall={triggerInstall} onDismiss={dismissInstall} />}
      </>
    );
  }

  // ── Render: Loading ─────────────────────────────────────────────────────────

  if (mode === 'loading' || !game) {
    return (
      <div className="app lobby">
        <h1 className="title">RUMBLE</h1>
        <div className="lobby-card">
          <div className="loading-msg">Loading game…</div>
        </div>
      </div>
    );
  }

  const isMyTurn = mode !== 'online' || game.currentPlayer === myPlayer;
  const rack = game.players[game.currentPlayer].rack;
  const myRack = (mode === 'online' && myPlayer !== null) ? game.players[myPlayer].rack : rack;
  const lastMoveSet = new Set(game.lastMove || []);
  const displayBoard = game.board.map((row, r) =>
    row.map((cell, c) => game.pending[`${r},${c}`] ?? cell)
  );

  // ── Render: Game ────────────────────────────────────────────────────────────

  return (
    <>
    <div className="app">

      {/* Waiting for opponent to join overlay */}
      {mode === 'online' && game.status === 'waiting' && (
        <div className="wild-overlay">
          <div className="wild-picker share-box">
            <div className="wild-picker__title">Waiting for opponent…</div>
            <div className="share-instructions">Share this Game ID or link:</div>
            <div className="share-id">{gameId}</div>
            <button className="btn btn--recall" onClick={copyShareLink}>
              {copyDone ? '✓ Copied!' : 'Copy Invite Link'}
            </button>
            <button className="wild-picker__cancel" onClick={goLobby}>Cancel</button>
          </div>
        </div>
      )}

      {/* Bag viewer overlay */}
      {showBag && bagGroups && (
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

        {/* Online: game ID + sync status */}
        {mode === 'online' && gameId && (
          <div className="game-id-bar">
            <span>Game: <strong>{gameId}</strong></span>
            <span
              className={`sync-dot sync-dot--${syncing ? 'busy' : syncError ? 'err' : 'ok'}`}
              title={syncing ? 'Saving…' : syncError ? 'Sync error' : 'Synced'}
            />
          </div>
        )}

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
              <div className="score-card__label">{playerLabel(i, myPlayer, game.names)}</div>
              <div className="score-card__value">{p.score}</div>
            </div>
          ))}
        </div>

        <div className={`message${game.gameOver ? ' message--game-over' : ''}`}>
          {game.message}
        </div>

        <button className="bag-pill" onClick={() => setShowBag(true)}>
          🎒 {game.bag.length} tile{game.bag.length !== 1 ? 's' : ''} in bag
        </button>

        <div className="controls">
          {isMyTurn ? (
            <div className="rack-area">
              <div className="rack-label">
                {mode === 'online' ? 'Your Rack' : `Player ${game.currentPlayer + 1}'s Rack`}
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
          ) : (
            <div className="rack-area rack-area--waiting">
              <div className="rack-wait-overlay">
                <div className="rack-label">{playerLabel(game.currentPlayer, myPlayer, game.names)}'s turn</div>
                <div className="wait-dots"><span /><span /><span /></div>
                {syncError && <div className="sync-err-msg">Connection issue — retrying…</div>}
              </div>
              <div className="rack-label">Your Rack</div>
              <div className="rack">
                {myRack.map((tile) => (
                  <Tile key={tile.id} tile={tile} size="rack" />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="action-bar">
          {isMyTurn && previewScore !== null && (
            <div className="score-preview">+{previewScore} pts</div>
          )}
          {isMyTurn && (
            <button className="btn btn--play action-bar__play" onClick={play} disabled={game.gameOver || syncing}>▶ Play</button>
          )}
          <div className="buttons">
            {isMyTurn && (
              <button className="btn btn--recall" onClick={recallAll} disabled={game.gameOver}>↩ Recall</button>
            )}
            {isMyTurn && (
              <button className="btn btn--pass" onClick={pass} disabled={game.gameOver || syncing}>⏭ Pass</button>
            )}
            <button className="btn btn--new" onClick={newGame}>
              {mode === 'online' ? '← Lobby' : '↺ New Game'}
            </button>
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
                    <div className={`tile tile--board${isPending ? ' tile--pending' : ' tile--placed'}${cell.isWild ? ' tile--wild' : ''}${!isPending && lastMoveSet.has(key) ? ' tile--last-move' : ''}`}>
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
    {showInstallBanner && <InstallBanner isIOS={isIOS} onInstall={triggerInstall} onDismiss={dismissInstall} />}
    </>
  );
}
