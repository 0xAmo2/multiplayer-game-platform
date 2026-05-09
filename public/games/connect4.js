function initConnect4(containerId, onComplete, socket, roomCode, currentUser, isHost) {
  const container = document.getElementById(containerId);
  const isMulti = !!(socket && roomCode);
  if (isMulti) return initC4_multi(containerId, onComplete, socket, roomCode, currentUser, !!isHost);
  return initC4_solo(containerId, onComplete, currentUser);
}

/* ============================================================
   MULTIPLAYER Connect 4 — server authoritative
   ============================================================ */
function initC4_multi(containerId, onComplete, socket, roomCode, currentUser, isHost) {
  const container = document.getElementById(containerId);
  let myFinishSent = false;
  let lastState = null;
  const PALETTE = ['#FF3B30', '#FFCC00', '#2D8CFF', '#9B5CFF'];

  function showWaiting() {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <h2 style="font-family:'Orbitron',sans-serif;letter-spacing:3px;color:var(--gold);">4 IN A ROW</h2>
        <p style="margin:20px 0;color:var(--muted);">1v1 matches — line up four to win!</p>
        <div class="mem-loader"></div>
        <p style="margin-top:16px;color:var(--cyan);">Starting in a moment…</p>
        ${isHost ? '<button id="c4-host-restart" class="btn-game btn-game-secondary" style="margin-top:18px;">Tap to start 4 in a Row</button>' : ''}
      </div>
    `;
    document.getElementById('c4-host-restart')?.addEventListener('click', () => {
      socket.emit('c4-host-start', { roomCode });
    });
  }

  function colorFor(socketId, players) {
    const idx = players.findIndex(p => p.socketId === socketId);
    return PALETTE[idx % PALETTE.length] || '#888';
  }

  function lighten(hex) {
    const c = hex.replace('#','');
    const r = parseInt(c.substring(0,2),16), g = parseInt(c.substring(2,4),16), b = parseInt(c.substring(4,6),16);
    const lr = Math.min(255, Math.floor(r + (255-r)*0.45));
    const lg = Math.min(255, Math.floor(g + (255-g)*0.45));
    const lb = Math.min(255, Math.floor(b + (255-b)*0.45));
    return `rgb(${lr},${lg},${lb})`;
  }

  function escapeHtmlSafe(s) {
    return String(s || '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  }

  function render(state) {
    lastState = state;
    const m = state.matches[state.activeMatchIndex];
    const allDone = state.activeMatchIndex >= state.matches.length;
    const inThisMatch = m && (m.p1 === socket.id || m.p2 === socket.id);
    const isMyTurn = m && !m.finished && m.currentPlayer === socket.id;

    const players = (function () {
      const out = [];
      state.matches.forEach(mm => {
        [{ id: mm.p1, name: mm.p1Name }, { id: mm.p2, name: mm.p2Name }].forEach(o => {
          if (!out.find(x => x.socketId === o.id)) out.push({ socketId: o.id, name: o.name });
        });
      });
      return out;
    })();

    const c1 = m ? colorFor(m.p1, players) : '#888';
    const c2 = m ? colorFor(m.p2, players) : '#888';

    container.innerHTML = `
      <div class="c4-turn-banner ${isMyTurn ? 'my-turn' : ''}">
        ${allDone
          ? '✅ All 4-in-a-Row matches complete!'
          : m
            ? (m.finished
                ? (m.winner ? `🏆 ${m.winner === m.p1 ? m.p1Name : m.p2Name} won this match` : 'Draw')
                : (isMyTurn
                    ? `🎯 Your turn vs ${m.currentPlayer === m.p1 ? m.p2Name : m.p1Name}`
                    : (inThisMatch
                        ? `Waiting — ${m.currentPlayerName}'s turn vs ${m.currentPlayer === m.p1 ? m.p2Name : m.p1Name}`
                        : `Spectating: ${m.currentPlayerName}'s turn vs ${m.currentPlayer === m.p1 ? m.p2Name : m.p1Name}`)))
            : ''}
      </div>
      ${state.matches.length > 1 ? `
        <div class="db-matches-strip">
          ${state.matches.map((mm, i) => `
            <div class="db-match-chip ${i === state.activeMatchIndex && !allDone ? 'active' : ''} ${mm.finished ? 'done' : ''}">
              <span style="color:${colorFor(mm.p1, players)}">${escapeHtmlSafe(mm.p1Name)}</span>
              <span class="db-vs-mini">vs</span>
              <span style="color:${colorFor(mm.p2, players)}">${escapeHtmlSafe(mm.p2Name)}</span>
              ${mm.finished ? `<span class="db-match-result">${mm.winner ? '✓' : '–'}</span>` : (i === state.activeMatchIndex ? '<span class="db-match-result">▶ live</span>' : '')}
            </div>
          `).join('')}
        </div>` : ''}
      ${allDone ? `
        <div style="text-align:center;padding:40px 20px;">
          <div class="mem-loader"></div>
          <p style="margin-top:16px;color:var(--cyan);font-family:'Orbitron',sans-serif;letter-spacing:2px;">Moving to next game…</p>
        </div>
      ` : m ? `
        <div class="c4-scoreboard">
          <div class="c4-team" style="--c:${c1}"><span class="c4-disc"></span><span class="c4-team-name">${escapeHtmlSafe(m.p1Name)}</span></div>
          <div class="c4-vs">VS</div>
          <div class="c4-team" style="--c:${c2}"><span class="c4-disc"></span><span class="c4-team-name">${escapeHtmlSafe(m.p2Name)}</span></div>
        </div>
        <div class="c4-board-wrap">
          <div class="c4-arrow-row" id="c4-arrows"></div>
          <div class="c4-board" id="c4-board"></div>
        </div>
        ${m.finished && m.winner ? `<div class="c4-winner-banner" style="--c:${colorFor(m.winner, players)}">🏆 Winner: ${escapeHtmlSafe(m.winner === m.p1 ? m.p1Name : m.p2Name)}</div>` : ''}
      ` : ''}
      ${state.message ? `<p class="db-hint">${escapeHtmlSafe(state.message)}</p>` : ''}
    `;

    if (!m) return;

    const arrowRow = container.querySelector('#c4-arrows');
    for (let c = 0; c < 7; c++) {
      const btn = document.createElement('button');
      btn.className = 'c4-arrow';
      btn.innerHTML = '▼';
      const colFull = m.board[0][c] !== null;
      btn.disabled = !isMyTurn || m.finished || colFull;
      btn.style.color = colorFor(socket.id, players);
      btn.addEventListener('click', () => {
        if (!isMyTurn || m.finished || colFull) return;
        socket.emit('c4-move', { roomCode, col: c });
      });
      arrowRow.appendChild(btn);
    }

    const boardEl = container.querySelector('#c4-board');
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 7; c++) {
        const cell = document.createElement('div');
        cell.className = 'c4-cell';
        const inner = document.createElement('div');
        inner.className = 'c4-disc-cell';
        const v = m.board[r][c];
        if (v) {
          const col = colorFor(v, players);
          inner.style.background = `radial-gradient(circle at 30% 30%, ${lighten(col)}, ${col})`;
          inner.style.boxShadow = `0 0 14px ${col}99, inset 0 -4px 0 rgba(0,0,0,.35)`;
        }
        if ((m.winningCells || []).some(([wr, wc]) => wr === r && wc === c)) cell.classList.add('c4-cell-win');
        cell.appendChild(inner);
        boardEl.appendChild(cell);
      }
    }

    if (allDone && !myFinishSent) {
      myFinishSent = true;
      if (onComplete) onComplete(null);
    }
  }

  const onState = (state) => render(state);
  socket.on('c4-state', onState);

  showWaiting();
  socket.emit('stage-ready', { roomCode, stage: 'connect4' });

  const stuckTimer = setTimeout(() => {
    if (lastState) return;
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <h2 style="font-family:'Orbitron',sans-serif;letter-spacing:3px;color:var(--gold);">4 IN A ROW</h2>
        <p style="margin:20px 0;color:var(--red);">4 in a Row hasn't started yet.</p>
        ${isHost
          ? '<button id="c4-host-restart" class="btn-game btn-game-primary">▶ Start now</button>'
          : '<p style="color:var(--cyan)">Ask the host to start the game.</p>'}
      </div>
    `;
    document.getElementById('c4-host-restart')?.addEventListener('click', () => {
      socket.emit('c4-host-start', { roomCode });
    });
  }, 6000);
  const cancelStuck = (state) => { if (state) clearTimeout(stuckTimer); };
  socket.on('c4-state', cancelStuck);

  return {
    handleRemoteAction: () => {},
    cleanup: () => {
      socket.off('c4-state', onState);
      socket.off('c4-state', cancelStuck);
      clearTimeout(stuckTimer);
    }
  };
}

/* ============================================================
   SOLO Connect 4 (vs CPU)
   ============================================================ */
function initC4_solo(containerId, onComplete, currentUser) {
  const container = document.getElementById(containerId);
  const ROWS = 6, COLS = 7;
  const playerName = currentUser?.name || 'You';
  const playerId = currentUser?.id || 'player1';

  const players = [
    { name: playerName, color: '#FF3B30', glow: 'rgba(255,59,48,.65)', isCPU: false, id: playerId },
    { name: 'CPU',      color: '#FFCC00', glow: 'rgba(255,204,0,.65)',  isCPU: true,  id: 'cpu' }
  ];
  let board=[], currentPlayer=0, gameActive=true, winningCells=[], winnerIdx=-1;

  function init() {
    board = Array.from({length:ROWS}, () => Array(COLS).fill(null));
    currentPlayer=0; gameActive=true; winningCells=[]; winnerIdx=-1;
    render();
  }
  function dropPiece(col) { if (!gameActive || currentPlayer !== 0) return; doDrop(col); }
  function doDrop(col) {
    for (let r=ROWS-1;r>=0;r--) {
      if (board[r][col] === null) {
        board[r][col] = currentPlayer;
        const win = checkWin(r, col, currentPlayer);
        if (win) {
          winningCells = win; winnerIdx = currentPlayer; gameActive = false;
          if (onComplete) onComplete({ [players[currentPlayer].id]: 200 });
        } else if (isDraw()) { gameActive = false; if (onComplete) onComplete({}); }
        else {
          currentPlayer = 1 - currentPlayer; render();
          if (gameActive && currentPlayer === 1) setTimeout(cpuMove, 700);
          return;
        }
        render(); return;
      }
    }
  }
  function cpuMove() {
    if (!gameActive || currentPlayer !== 1) return;
    let col = findCritical(1); if (col === -1) col = findCritical(0);
    if (col === -1) {
      const order=[3,2,4,1,5,0,6];
      for (const c of order) if (board[0][c] === null) { col = c; break; }
    }
    if (col !== -1) doDrop(col);
  }
  function findCritical(p) {
    for (let c=0;c<COLS;c++) for (let r=ROWS-1;r>=0;r--) {
      if (board[r][c] === null) { board[r][c] = p; const win = checkWin(r,c,p); board[r][c] = null; if (win) return c; break; }
    }
    return -1;
  }
  function checkWin(row,col,p) {
    const dirs=[[0,1],[1,0],[1,1],[1,-1]];
    for (const [dr,dc] of dirs) {
      let cells=[[row,col]];
      for (let k=1;k<4;k++) { const r=row+dr*k,c=col+dc*k; if (r>=0&&r<ROWS&&c>=0&&c<COLS&&board[r][c]===p) cells.push([r,c]); else break; }
      for (let k=1;k<4;k++) { const r=row-dr*k,c=col-dc*k; if (r>=0&&r<ROWS&&c>=0&&c<COLS&&board[r][c]===p) cells.unshift([r,c]); else break; }
      if (cells.length>=4) return cells.slice(0,4);
    }
    return null;
  }
  function isDraw() { return board[0].every(v => v !== null); }
  function lighten(hex) {
    const c=hex.replace('#',''); const r=parseInt(c.substring(0,2),16),g=parseInt(c.substring(2,4),16),b=parseInt(c.substring(4,6),16);
    return `rgb(${Math.min(255,Math.floor(r+(255-r)*0.45))},${Math.min(255,Math.floor(g+(255-g)*0.45))},${Math.min(255,Math.floor(b+(255-b)*0.45))})`;
  }
  function render() {
    const turn = gameActive
      ? `<span style="color:${players[currentPlayer].color};font-weight:700;">${players[currentPlayer].name}</span>'s turn`
      : (winnerIdx===-1?'<span style="color:var(--gold)">It\'s a draw!</span>'
        : `<span style="color:${players[winnerIdx].color};font-weight:700;">🏆 ${players[winnerIdx].name} wins!</span>`);
    container.innerHTML = `
      <div class="c4-scoreboard">
        <div class="c4-team" style="--c:${players[0].color}"><span class="c4-disc"></span><span class="c4-team-name">${players[0].name}</span></div>
        <div class="c4-vs">VS</div>
        <div class="c4-team" style="--c:${players[1].color}"><span class="c4-disc"></span><span class="c4-team-name">${players[1].name}</span></div>
      </div>
      <div class="c4-status">${turn}</div>
      <div class="c4-board-wrap">
        <div class="c4-arrow-row" id="c4-arrows"></div>
        <div class="c4-board" id="c4-board"></div>
      </div>
      ${!gameActive?`<div class="c4-winner-banner" style="--c:${winnerIdx===-1?'#FFB800':players[winnerIdx].color}">${winnerIdx===-1?'Draw — well played!':`🏆 Winner: ${players[winnerIdx].name}`}</div>`:''}
    `;
    const arrowRow = container.querySelector('#c4-arrows');
    for (let c=0;c<COLS;c++) {
      const btn = document.createElement('button'); btn.className='c4-arrow'; btn.innerHTML='▼';
      btn.disabled = !gameActive || currentPlayer !== 0 || board[0][c] !== null;
      btn.style.color = players[0].color;
      btn.addEventListener('click', () => dropPiece(c));
      arrowRow.appendChild(btn);
    }
    const boardEl = container.querySelector('#c4-board');
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
      const cell = document.createElement('div'); cell.className='c4-cell';
      const inner = document.createElement('div'); inner.className='c4-disc-cell';
      const v = board[r][c];
      if (v !== null) {
        inner.style.background = `radial-gradient(circle at 30% 30%, ${lighten(players[v].color)}, ${players[v].color})`;
        inner.style.boxShadow = `0 0 14px ${players[v].glow}, inset 0 -4px 0 rgba(0,0,0,.35)`;
      }
      if (winningCells.some(([wr,wc]) => wr===r&&wc===c)) cell.classList.add('c4-cell-win');
      cell.appendChild(inner); boardEl.appendChild(cell);
    }
  }
  init();
  return { handleRemoteAction: () => {} };
}
