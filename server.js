const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// Disable caching of static assets so a code change is always picked up on reload.
const path = require('path');
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

const rooms = new Map();
const GAME_ORDER = ['memory', 'uno', 'dots', 'connect4'];

/* ---------- Helpers ---------- */
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function findPlayer(room, socketId) {
  return room.players.find(p => p.socketId === socketId);
}
function playerIndex(room, socketId) {
  return room.players.findIndex(p => p.socketId === socketId);
}
function nameOf(room, socketId) {
  return findPlayer(room, socketId)?.name || '?';
}

/* ---------- UNO ---------- */
function createUnoDeck() {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const numbers = ['0','1','2','3','4','5','6','7','8','9'];
  const actions = ['skip','reverse','draw2'];
  const deck = [];
  for (const c of colors) {
    for (const v of numbers) {
      deck.push({ color: c, value: v });
      if (v !== '0') deck.push({ color: c, value: v });
    }
    for (const v of actions) {
      deck.push({ color: c, value: v });
      deck.push({ color: c, value: v });
    }
  }
  for (let i = 0; i < 4; i++) deck.push({ color: 'wild', value: 'wild' });
  for (let i = 0; i < 4; i++) deck.push({ color: 'wild', value: 'wild4' });
  return shuffle(deck);
}

function setupUnoState(room) {
  const deck = createUnoDeck();
  const hands = {};
  room.players.forEach(p => {
    hands[p.socketId] = [];
    for (let i = 0; i < 7; i++) hands[p.socketId].push(deck.pop());
  });
  let firstCard = deck.pop();
  while (firstCard.value === 'wild' || firstCard.value === 'wild4') {
    deck.unshift(firstCard);
    firstCard = deck.pop();
  }
  return {
    type: 'uno',
    deck,
    discardPile: [firstCard],
    hands,
    currentPlayerIndex: 0,
    direction: 1,
    currentColor: firstCard.color,
    currentValue: firstCard.value,
    winner: null
  };
}

function broadcastUnoState(room, message) {
  const gs = room.gameState;
  const top = gs.discardPile[gs.discardPile.length - 1];
  room.players.forEach(p => {
    const opponents = room.players
      .filter(q => q.socketId !== p.socketId)
      .map(q => ({
        id: q.id,
        socketId: q.socketId,
        name: q.name,
        cardCount: gs.hands[q.socketId]?.length || 0
      }));
    io.to(p.socketId).emit('uno-state', {
      hand: gs.hands[p.socketId] || [],
      opponents,
      players: room.players.map(q => ({ id: q.id, socketId: q.socketId, name: q.name })),
      currentPlayerIndex: gs.currentPlayerIndex,
      currentPlayerName: room.players[gs.currentPlayerIndex].name,
      currentPlayerSocketId: room.players[gs.currentPlayerIndex].socketId,
      direction: gs.direction,
      currentColor: gs.currentColor,
      currentValue: gs.currentValue,
      topCard: top,
      drawCount: gs.deck.length,
      myIndex: room.players.findIndex(q => q.socketId === p.socketId),
      winner: gs.winner,
      message: message || null
    });
  });
}

function unoCanPlay(card, color, value) {
  if (!card) return false;
  if (card.color === 'wild') return true;
  if (card.color === color) return true;
  if (card.value === value) return true;
  return false;
}

function unoDrawCards(gs, sid, n) {
  for (let i = 0; i < n; i++) {
    if (gs.deck.length === 0) {
      if (gs.discardPile.length <= 1) return;
      const top = gs.discardPile.pop();
      gs.deck = shuffle(gs.discardPile.slice());
      gs.discardPile = [top];
    }
    if (gs.deck.length > 0) gs.hands[sid].push(gs.deck.pop());
  }
}

function unoApplyEffect(room, card) {
  const gs = room.gameState;
  const n = room.players.length;
  if (card.value === 'skip') {
    gs.currentPlayerIndex = (gs.currentPlayerIndex + gs.direction + n) % n;
  } else if (card.value === 'reverse') {
    gs.direction *= -1;
    if (n === 2) gs.currentPlayerIndex = (gs.currentPlayerIndex + gs.direction + n) % n;
  } else if (card.value === 'draw2') {
    const next = (gs.currentPlayerIndex + gs.direction + n) % n;
    unoDrawCards(gs, room.players[next].socketId, 2);
    gs.currentPlayerIndex = next;
  } else if (card.value === 'wild4') {
    const next = (gs.currentPlayerIndex + gs.direction + n) % n;
    unoDrawCards(gs, room.players[next].socketId, 4);
    gs.currentPlayerIndex = next;
  }
}

function unoAdvance(room) {
  const n = room.players.length;
  room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + room.gameState.direction + n) % n;
}

/* ---------- Memory (synchronized levels) ---------- */
const MEM_MAX_LEVEL = 8;
const MEM_TOTAL_CELLS = 64;

function memPatternCount(level, mult) { return Math.min(14, Math.floor(2 + level * 0.9 * mult)); }
function memMemTime(level, mult) { return Math.min(8, 2.5 + (level - 1) * 0.55 / mult); }

function setupMemoryState(room) {
  const mult = ({ easy: 0.8, medium: 1, hard: 1.3 })[room.difficulty] || 1;
  const patterns = [];
  for (let l = 1; l <= MEM_MAX_LEVEL; l++) {
    const set = new Set();
    while (set.size < memPatternCount(l, mult)) set.add(Math.floor(Math.random() * MEM_TOTAL_CELLS));
    patterns.push(Array.from(set));
  }
  const playerStates = {};
  room.players.forEach(p => playerStates[p.socketId] = {
    score: 0,
    currentSubmission: null,
    lastResult: null
  });
  return {
    type: 'memory',
    currentLevel: 1,
    maxLevel: MEM_MAX_LEVEL,
    patterns,
    memTimes: Array.from({ length: MEM_MAX_LEVEL }, (_, i) => memMemTime(i + 1, mult)),
    playerStates,
    phase: 'memorize',
    levelTimer: null
  };
}

function broadcastMemoryState(room, override = {}) {
  const gs = room.gameState;
  const level = gs.currentLevel;
  const pattern = gs.patterns[level - 1] || [];
  io.to(room.roomCode).emit('mem-state', {
    level,
    maxLevel: gs.maxLevel,
    pattern: gs.phase === 'memorize' ? pattern : null,
    patternLength: pattern.length,
    memTime: gs.memTimes[level - 1] || 3,
    phase: gs.phase,
    scores: Object.fromEntries(room.players.map(p => [p.socketId, gs.playerStates[p.socketId]?.score || 0])),
    submissions: Object.fromEntries(room.players.map(p => [p.socketId, gs.playerStates[p.socketId]?.currentSubmission != null])),
    lastResults: Object.fromEntries(room.players.map(p => [p.socketId, gs.playerStates[p.socketId]?.lastResult || null])),
    players: room.players.map(p => ({ id: p.id, socketId: p.socketId, name: p.name })),
    ...override
  });
}

function memoryStartLevel(room) {
  const gs = room.gameState;
  if (!gs) return;
  gs.phase = 'memorize';
  Object.values(gs.playerStates).forEach(s => { s.currentSubmission = null; s.lastResult = null; });
  broadcastMemoryState(room);
  if (gs.levelTimer) clearTimeout(gs.levelTimer);
  gs.levelTimer = setTimeout(() => {
    if (room.gameState !== gs) return;
    gs.phase = 'recall';
    broadcastMemoryState(room);
    // hard timeout for recall: 25 seconds (auto-empty submission)
    gs.levelTimer = setTimeout(() => {
      if (room.gameState !== gs) return;
      room.players.forEach(p => {
        if (gs.playerStates[p.socketId].currentSubmission == null) {
          gs.playerStates[p.socketId].currentSubmission = [];
        }
      });
      memoryFinishLevel(room);
    }, 25000);
  }, gs.memTimes[gs.currentLevel - 1] * 1000);
}

function memoryFinishLevel(room) {
  const gs = room.gameState;
  if (!gs) return;
  if (gs.levelTimer) { clearTimeout(gs.levelTimer); gs.levelTimer = null; }
  const pattern = gs.patterns[gs.currentLevel - 1];
  const sortedPattern = [...pattern].sort((a, b) => a - b);

  room.players.forEach(p => {
    const ps = gs.playerStates[p.socketId];
    const sub = Array.isArray(ps.currentSubmission) ? ps.currentSubmission : [];
    const sortedSub = [...sub].sort((a, b) => a - b);
    const correct = sortedPattern.length === sortedSub.length &&
                    sortedPattern.every((v, i) => v === sortedSub[i]);
    const pts = correct ? gs.currentLevel * 100 : 0;
    ps.lastResult = { correct, points: pts };
    if (pts) {
      ps.score += pts;
      p.points += pts;
    }
  });

  io.to(room.roomCode).emit('scoreUpdate', { players: room.players });
  broadcastMemoryState(room, { phase: 'result' });

  setTimeout(() => {
    if (room.gameState !== gs) return;
    if (gs.currentLevel >= gs.maxLevel) {
      memoryGameOver(room);
    } else {
      gs.currentLevel++;
      memoryStartLevel(room);
    }
  }, 2500);
}

function memoryCheckAllSubmitted(room) {
  const gs = room.gameState;
  if (!gs) return;
  const allSubmitted = room.players.every(p => gs.playerStates[p.socketId].currentSubmission != null);
  if (allSubmitted) memoryFinishLevel(room);
}

function memoryGameOver(room) {
  const gs = room.gameState;
  if (!gs) return;
  gs.phase = 'gameover';
  io.to(room.roomCode).emit('mem-state', {
    phase: 'gameover',
    finalScores: Object.fromEntries(room.players.map(p => [p.socketId, gs.playerStates[p.socketId].score])),
    players: room.players.map(p => ({ id: p.id, socketId: p.socketId, name: p.name }))
  });

  let secs = 3;
  const advIdx = room.currentGameIndex;
  io.to(room.roomCode).emit('mem-countdown', { seconds: secs });
  const ticker = setInterval(() => {
    secs--;
    if (secs > 0) {
      io.to(room.roomCode).emit('mem-countdown', { seconds: secs });
    } else {
      clearInterval(ticker);
      advanceRoom(room.roomCode, advIdx);
    }
  }, 1000);
}

/* ---------- Start any game stage ---------- */
function startStage(room) {
  if (room.gameState) return;
  const stage = GAME_ORDER[room.currentGameIndex];
  console.log(`[${stage}] starting for room ${room.roomCode}`);
  if (stage === 'memory') {
    room.gameState = setupMemoryState(room);
    memoryStartLevel(room);
  } else if (stage === 'uno') {
    room.gameState = setupUnoState(room);
    broadcastUnoState(room, `Game started! ${room.players[0].name} goes first.`);
  } else if (stage === 'dots') {
    room.gameState = setupDotsState(room);
    const m = room.gameState.matches[0];
    broadcastDotsState(room, `Match 1 of ${room.gameState.matches.length}: ${nameOf(room, m.p1)} vs ${nameOf(room, m.p2)}`);
  } else if (stage === 'connect4') {
    room.gameState = setupC4State(room);
    const m = room.gameState.matches[0];
    broadcastC4State(room, `Match 1 of ${room.gameState.matches.length}: ${nameOf(room, m.p1)} vs ${nameOf(room, m.p2)}`);
  }
}

/* ---------- Match builder for Dots / Connect4 ---------- */
function buildMatches(players) {
  const N = players.length;
  if (N === 2) return [{ p1: players[0].socketId, p2: players[1].socketId }];
  if (N === 3) return [
    { p1: players[0].socketId, p2: players[1].socketId },
    { p1: players[0].socketId, p2: players[2].socketId },
    { p1: players[1].socketId, p2: players[2].socketId }
  ];
  if (N === 4) return [
    { p1: players[0].socketId, p2: players[1].socketId },
    { p1: players[2].socketId, p2: players[3].socketId }
  ];
  return [];
}

/* ---------- Dots & Boxes ---------- */
function setupDotsState(room) {
  const matches = buildMatches(room.players).map(m => ({
    p1: m.p1, p2: m.p2,
    edges: { h: Array.from({ length: 6 }, () => Array(5).fill(null)),
             v: Array.from({ length: 5 }, () => Array(6).fill(null)) },
    boxes: Array.from({ length: 5 }, () => Array(5).fill(null)),
    scores: { [m.p1]: 0, [m.p2]: 0 },
    currentPlayer: m.p1,
    winner: null,
    finished: false
  }));
  return { type: 'dots', matches, activeMatchIndex: 0 };
}

function broadcastDotsState(room, message) {
  const gs = room.gameState;
  const payload = {
    matches: gs.matches.map(m => ({
      p1: m.p1, p2: m.p2,
      p1Name: nameOf(room, m.p1),
      p2Name: nameOf(room, m.p2),
      edges: m.edges,
      boxes: m.boxes,
      scores: m.scores,
      currentPlayer: m.currentPlayer,
      currentPlayerName: nameOf(room, m.currentPlayer),
      winner: m.winner,
      finished: m.finished
    })),
    activeMatchIndex: gs.activeMatchIndex,
    message: message || null
  };
  io.to(room.roomCode).emit('dots-state', payload);
}

function dotsCheckBoxesAndAdvance(match) {
  let claimed = false;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (match.boxes[r][c]) continue;
      const top = match.edges.h[r][c];
      const bot = match.edges.h[r+1][c];
      const left = match.edges.v[r][c];
      const right = match.edges.v[r][c+1];
      if (top && bot && left && right) {
        match.boxes[r][c] = match.currentPlayer;
        match.scores[match.currentPlayer]++;
        claimed = true;
      }
    }
  }
  if (match.scores[match.p1] + match.scores[match.p2] === 25) {
    match.finished = true;
    match.winner = match.scores[match.p1] === match.scores[match.p2]
      ? null
      : (match.scores[match.p1] > match.scores[match.p2] ? match.p1 : match.p2);
  } else if (!claimed) {
    match.currentPlayer = (match.currentPlayer === match.p1) ? match.p2 : match.p1;
  }
}

/* ---------- Connect 4 ---------- */
function setupC4State(room) {
  const matches = buildMatches(room.players).map(m => ({
    p1: m.p1, p2: m.p2,
    board: Array.from({ length: 6 }, () => Array(7).fill(null)),
    currentPlayer: m.p1,
    winner: null,
    winningCells: [],
    finished: false
  }));
  return { type: 'connect4', matches, activeMatchIndex: 0 };
}

function broadcastC4State(room, message) {
  const gs = room.gameState;
  const payload = {
    matches: gs.matches.map(m => ({
      p1: m.p1, p2: m.p2,
      p1Name: nameOf(room, m.p1),
      p2Name: nameOf(room, m.p2),
      board: m.board,
      currentPlayer: m.currentPlayer,
      currentPlayerName: nameOf(room, m.currentPlayer),
      winner: m.winner,
      winningCells: m.winningCells,
      finished: m.finished
    })),
    activeMatchIndex: gs.activeMatchIndex,
    message: message || null
  };
  io.to(room.roomCode).emit('c4-state', payload);
}

function c4CheckWin(board, row, col, player) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    let cells = [[row,col]];
    for (let k = 1; k < 4; k++) {
      const r = row + dr*k, c = col + dc*k;
      if (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === player) cells.push([r,c]);
      else break;
    }
    for (let k = 1; k < 4; k++) {
      const r = row - dr*k, c = col - dc*k;
      if (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === player) cells.unshift([r,c]);
      else break;
    }
    if (cells.length >= 4) return cells.slice(0, 4);
  }
  return null;
}

function c4IsFull(board) {
  return board[0].every(v => v !== null);
}

/* ---------- Advance room to next stage ---------- */
function advanceRoom(roomCode, expectedIndex) {
  const room = rooms.get(roomCode);
  if (!room || room.status !== 'playing') return;
  if (expectedIndex !== undefined && room.currentGameIndex !== expectedIndex) return;
  room.finishedPlayers = new Set();
  room.readyPlayers = new Set();
  room.gameState = null;
  room.currentGameIndex++;
  if (room.currentGameIndex >= GAME_ORDER.length) {
    io.to(roomCode).emit('gameComplete', { players: room.players });
    room.status = 'waiting';
    room.currentGameIndex = 0;
  } else {
    io.to(roomCode).emit('nextGame', { index: room.currentGameIndex });
    const savedIndex = room.currentGameIndex;
    setTimeout(() => {
      const r = rooms.get(roomCode);
      if (!r || r.status !== 'playing' || r.currentGameIndex !== savedIndex) return;
      if (r.gameState) return;
      console.log(`[${GAME_ORDER[savedIndex]}] readiness timeout — starting anyway`);
      startStage(r);
    }, 4000);
  }
}

/* ---------- Award points after a multiplayer game ---------- */
function awardPoints(room, awards) {
  // awards: { socketId: points }
  Object.entries(awards).forEach(([sid, pts]) => {
    const p = findPlayer(room, sid);
    if (p) p.points += pts;
  });
  io.to(room.roomCode).emit('scoreUpdate', { players: room.players });
}

/* ---------- Socket.IO ---------- */
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', (data, callback) => {
    const { hostName, difficulty, maxPlayers } = data;
    const roomCode = generateRoomCode();
    const room = {
      roomCode,
      players: [{ id: socket.id, socketId: socket.id, name: hostName, points: 0 }],
      maxPlayers,
      difficulty,
      currentGameIndex: 0,
      hostId: socket.id,
      status: 'waiting',
      finishedPlayers: new Set(),
      gameState: null
    };
    rooms.set(roomCode, room);
    socket.join(roomCode);
    callback({ success: true, roomCode });
    io.to(roomCode).emit('roomUpdate', { players: room.players });
  });

  socket.on('joinRoom', (data, callback) => {
    const { roomCode, playerName } = data;
    const room = rooms.get(roomCode);
    if (!room) return callback({ success: false, error: 'Room not found' });
    if (room.players.length >= room.maxPlayers) return callback({ success: false, error: 'Room is full' });
    if (room.status !== 'waiting') return callback({ success: false, error: 'Game already in progress' });
    room.players.push({ id: socket.id, socketId: socket.id, name: playerName, points: 0 });
    socket.join(roomCode);
    callback({ success: true });
    io.to(roomCode).emit('roomUpdate', { players: room.players });
  });

  socket.on('startGame', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;
    room.status = 'playing';
    room.currentGameIndex = 0;
    room.finishedPlayers = new Set();
    room.gameState = null;
    room.readyPlayers = new Set();
    io.to(roomCode).emit('gameStarted', {
      gameOrder: GAME_ORDER,
      players: room.players
    });
    // Hard fallback: if we don't get a ready handshake from everyone within 4 seconds, start anyway.
    setTimeout(() => {
      const r = rooms.get(roomCode);
      if (!r || r.status !== 'playing') return;
      if (r.gameState) return;
      console.log(`[${GAME_ORDER[0]}] readiness timeout — starting anyway`);
      startStage(r);
    }, 4000);
  });

  // Each client emits this when its game-stage listeners are wired up.
  socket.on('stage-ready', (data) => {
    const room = rooms.get(data?.roomCode);
    if (!room || room.status !== 'playing') return;
    const expectedStage = GAME_ORDER[room.currentGameIndex];
    if (data?.stage && data.stage !== expectedStage) return;
    if (!room.readyPlayers) room.readyPlayers = new Set();
    room.readyPlayers.add(socket.id);
    const allReady = room.players.every(p => room.readyPlayers.has(p.socketId));
    if (!allReady || room.gameState) return;
    console.log(`[${expectedStage}] all ${room.players.length} players ready, starting now`);
    startStage(room);
  });

  /* --- Memory uses gameAction broadcast (host shares patterns) and updateScores --- */
  socket.on('gameAction', (data) => {
    const { roomCode, action, gameData } = data;
    const room = rooms.get(roomCode);
    if (!room) return;
    socket.to(roomCode).emit('gameAction', { action, gameData, senderId: socket.id });
  });

  socket.on('updateScores', (data) => {
    const { roomCode, scores } = data;
    const room = rooms.get(roomCode);
    if (!room || !scores) return;
    room.players.forEach(player => {
      let delta = 0;
      if (typeof scores[player.id] === 'number') delta = scores[player.id];
      else if (typeof scores[player.socketId] === 'number') delta = scores[player.socketId];
      if (delta) player.points += delta;
    });
    io.to(roomCode).emit('scoreUpdate', { players: room.players });
  });

  socket.on('playerFinished', (data) => {
    const { roomCode } = data || {};
    const room = rooms.get(roomCode);
    if (!room) return;
    if (!room.finishedPlayers) room.finishedPlayers = new Set();
    room.finishedPlayers.add(socket.id);
    io.to(roomCode).emit('finishStatus', {
      finishedIds: Array.from(room.finishedPlayers),
      totalPlayers: room.players.length
    });
    if (room.finishedPlayers.size >= room.players.length) {
      const idx = room.currentGameIndex;
      setTimeout(() => advanceRoom(roomCode, idx), 1500);
    }
  });

  /* ---------- Memory (server-driven) ---------- */
  // mem-host-start kept for back-compat / re-trigger (e.g. if host wants to restart memory).
  socket.on('mem-host-start', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.gameState && room.gameState.type === 'memory' && room.gameState.phase !== 'gameover') return; // already running
    room.gameState = setupMemoryState(room);
    memoryStartLevel(room);
  });

  socket.on('mem-submit', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || !room.gameState || room.gameState.type !== 'memory') return;
    if (room.gameState.phase !== 'recall') return;
    const ps = room.gameState.playerStates[socket.id];
    if (!ps || ps.currentSubmission != null) return;
    ps.currentSubmission = Array.isArray(data.cells) ? data.cells.filter(n => Number.isInteger(n) && n >= 0 && n < MEM_TOTAL_CELLS) : [];
    broadcastMemoryState(room);
    memoryCheckAllSubmitted(room);
  });

  /* ---------- UNO ---------- */
  socket.on('uno-host-start', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.gameState) return;
    room.gameState = setupUnoState(room);
    broadcastUnoState(room, `Game started! ${room.players[0].name} goes first.`);
  });

  socket.on('uno-play', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || !room.gameState || room.gameState.type !== 'uno' || room.gameState.winner) return;
    const gs = room.gameState;
    const idx = playerIndex(room, socket.id);
    if (idx !== gs.currentPlayerIndex) return; // not your turn

    const hand = gs.hands[socket.id];
    const card = hand[data.cardIdx];
    if (!card) return;
    if (!unoCanPlay(card, gs.currentColor, gs.currentValue)) return;
    if (card.color === 'wild' && !data.chosenColor) return;

    hand.splice(data.cardIdx, 1);
    gs.discardPile.push(card);
    if (card.color === 'wild') {
      gs.currentColor = data.chosenColor;
      gs.currentValue = card.value;
    } else {
      gs.currentColor = card.color;
      gs.currentValue = card.value;
    }

    // Check win
    if (hand.length === 0) {
      gs.winner = socket.id;
      const winner = findPlayer(room, socket.id);
      awardPoints(room, { [socket.id]: 500 });
      broadcastUnoState(room, `🏆 ${winner.name} wins UNO!`);
      const advIdx = room.currentGameIndex;
      setTimeout(() => advanceRoom(room.roomCode, advIdx), 4000);
      return;
    }

    unoApplyEffect(room, card);
    unoAdvance(room);
    const next = room.players[gs.currentPlayerIndex].name;
    broadcastUnoState(room, `${nameOf(room, socket.id)} played ${card.color} ${card.value}. Now it's ${next}'s turn.`);
  });

  socket.on('uno-draw', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || !room.gameState || room.gameState.type !== 'uno' || room.gameState.winner) return;
    const gs = room.gameState;
    const idx = playerIndex(room, socket.id);
    if (idx !== gs.currentPlayerIndex) return;
    unoDrawCards(gs, socket.id, 1);
    unoAdvance(room);
    const next = room.players[gs.currentPlayerIndex].name;
    broadcastUnoState(room, `${nameOf(room, socket.id)} drew a card. Now it's ${next}'s turn.`);
  });

  /* ---------- Dots & Boxes ---------- */
  socket.on('dots-host-start', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.gameState) return;
    room.gameState = setupDotsState(room);
    const m = room.gameState.matches[0];
    broadcastDotsState(room, `Match 1 of ${room.gameState.matches.length}: ${nameOf(room, m.p1)} vs ${nameOf(room, m.p2)}`);
  });

  socket.on('dots-move', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || !room.gameState || room.gameState.type !== 'dots') return;
    const gs = room.gameState;
    const m = gs.matches[gs.activeMatchIndex];
    if (!m || m.finished) return;
    if (m.currentPlayer !== socket.id) return;
    const { etype, r, c } = data;
    if (!['h','v'].includes(etype)) return;
    if (!m.edges[etype][r] || m.edges[etype][r][c] !== null) return;

    m.edges[etype][r][c] = socket.id;
    dotsCheckBoxesAndAdvance(m);

    if (m.finished) {
      // Award points
      if (m.winner) {
        const points = 100 + Math.max(m.scores[m.p1], m.scores[m.p2]) * 10;
        awardPoints(room, { [m.winner]: points });
      }
      // Advance to next match or finish stage
      gs.activeMatchIndex++;
      if (gs.activeMatchIndex >= gs.matches.length) {
        broadcastDotsState(room, '✅ All Dots & Boxes matches complete!');
        const advIdx = room.currentGameIndex;
        setTimeout(() => advanceRoom(room.roomCode, advIdx), 3500);
        return;
      } else {
        const nm = gs.matches[gs.activeMatchIndex];
        broadcastDotsState(room, `Match ${gs.activeMatchIndex + 1} of ${gs.matches.length}: ${nameOf(room, nm.p1)} vs ${nameOf(room, nm.p2)}`);
        return;
      }
    }
    broadcastDotsState(room, `Now it's ${nameOf(room, m.currentPlayer)}'s turn vs ${nameOf(room, m.currentPlayer === m.p1 ? m.p2 : m.p1)}`);
  });

  /* ---------- Connect 4 ---------- */
  socket.on('c4-host-start', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.gameState) return;
    room.gameState = setupC4State(room);
    const m = room.gameState.matches[0];
    broadcastC4State(room, `Match 1 of ${room.gameState.matches.length}: ${nameOf(room, m.p1)} vs ${nameOf(room, m.p2)}`);
  });

  socket.on('c4-move', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || !room.gameState || room.gameState.type !== 'connect4') return;
    const gs = room.gameState;
    const m = gs.matches[gs.activeMatchIndex];
    if (!m || m.finished) return;
    if (m.currentPlayer !== socket.id) return;
    const col = data.col;
    if (typeof col !== 'number' || col < 0 || col > 6) return;
    let landedRow = -1;
    for (let r = 5; r >= 0; r--) {
      if (m.board[r][col] === null) {
        m.board[r][col] = socket.id;
        landedRow = r;
        break;
      }
    }
    if (landedRow === -1) return; // column full

    const win = c4CheckWin(m.board, landedRow, col, socket.id);
    if (win) {
      m.winner = socket.id;
      m.winningCells = win;
      m.finished = true;
      awardPoints(room, { [socket.id]: 200 });
    } else if (c4IsFull(m.board)) {
      m.finished = true;
    } else {
      m.currentPlayer = (m.currentPlayer === m.p1) ? m.p2 : m.p1;
    }

    if (m.finished) {
      gs.activeMatchIndex++;
      if (gs.activeMatchIndex >= gs.matches.length) {
        broadcastC4State(room, '✅ All 4-in-a-Row matches complete!');
        const advIdx = room.currentGameIndex;
        setTimeout(() => advanceRoom(room.roomCode, advIdx), 3500);
        return;
      }
      const nm = gs.matches[gs.activeMatchIndex];
      broadcastC4State(room, `Match ${gs.activeMatchIndex + 1} of ${gs.matches.length}: ${nameOf(room, nm.p1)} vs ${nameOf(room, nm.p2)}`);
      return;
    }
    broadcastC4State(room, `Now it's ${nameOf(room, m.currentPlayer)}'s turn vs ${nameOf(room, m.currentPlayer === m.p1 ? m.p2 : m.p1)}`);
  });

  /* ---------- Disconnect ---------- */
  socket.on('disconnect', () => {
    for (const [roomCode, room] of rooms.entries()) {
      const idx = room.players.findIndex(p => p.socketId === socket.id);
      if (idx === -1) continue;
      room.players.splice(idx, 1);
      if (room.finishedPlayers) room.finishedPlayers.delete(socket.id);

      if (room.players.length === 0) {
        rooms.delete(roomCode);
      } else {
        if (room.hostId === socket.id) room.hostId = room.players[0].socketId;
        io.to(roomCode).emit('roomUpdate', { players: room.players });
        io.to(roomCode).emit('playerLeft', { playerId: socket.id });
      }
      break;
    }
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`ARENA server running at http://${HOST}:${PORT}`);
});
