function initDotsAndBoxes(containerId, onComplete, socket, roomCode, currentUser, isHost) {
  const container = document.getElementById(containerId);
  const isMulti = !!(socket && roomCode);
  if (isMulti) return initDots_multi(containerId, onComplete, socket, roomCode, currentUser, !!isHost);
  return initDots_solo(containerId, onComplete, currentUser);
}

/* ============================================================
   MULTIPLAYER Dots & Boxes — server authoritative
   ============================================================ */
function initDots_multi(containerId, onComplete, socket, roomCode, currentUser, isHost) {
  const container = document.getElementById(containerId);
  let myFinishSent = false;
  let lastState = null;
  const PALETTE = ['#2D8CFF', '#FF3B6B', '#00E5A0', '#FFB800'];

  function showWaiting() {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <h2 style="font-family:'Orbitron',sans-serif;letter-spacing:3px;color:var(--green);">DOTS &amp; BOXES</h2>
        <p style="margin:20px 0;color:var(--muted);">1v1 matches — claim the most boxes to win!</p>
        <div class="mem-loader"></div>
        <p style="margin-top:16px;color:var(--cyan);">Starting in a moment…</p>
        ${isHost ? '<button id="dots-host-restart" class="btn-game btn-game-secondary" style="margin-top:18px;">Tap to start Dots &amp; Boxes</button>' : ''}
      </div>
    `;
    document.getElementById('dots-host-restart')?.addEventListener('click', () => {
      socket.emit('dots-host-start', { roomCode });
    });
  }

  function colorFor(socketId, players) {
    const idx = players.findIndex(p => p.socketId === socketId);
    return PALETTE[idx % PALETTE.length] || '#888';
  }

  function render(state) {
    lastState = state;
    const m = state.matches[state.activeMatchIndex];
    const allDone = state.activeMatchIndex >= state.matches.length;
    const inThisMatch = m && (m.p1 === socket.id || m.p2 === socket.id);
    const isMyTurn = m && !m.finished && m.currentPlayer === socket.id;

    // Players for color mapping
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
      <div class="db-turn-banner ${isMyTurn ? 'my-turn' : ''}">
        ${allDone
          ? '✅ All Dots & Boxes matches complete!'
          : m
            ? (m.finished
                ? (m.winner ? `🏆 ${m.winner === m.p1 ? m.p1Name : m.p2Name} won this match` : `It's a draw`)
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
              ${mm.finished
                ? `<span class="db-match-result">${mm.scores[mm.p1]}–${mm.scores[mm.p2]}</span>`
                : (i === state.activeMatchIndex ? '<span class="db-match-result">▶ live</span>' : '')}
            </div>
          `).join('')}
        </div>` : ''}
      ${allDone ? `
        <div style="text-align:center;padding:40px 20px;">
          <div class="mem-loader"></div>
          <p style="margin-top:16px;color:var(--cyan);font-family:'Orbitron',sans-serif;letter-spacing:2px;">Moving to next game…</p>
        </div>
      ` : m ? `
        <div class="db-scoreboard">
          <div class="db-team" style="--c:${c1}"><div class="db-team-name">${escapeHtmlSafe(m.p1Name)}</div><div class="db-team-score">${m.scores[m.p1]}</div></div>
          <div class="db-vs">VS</div>
          <div class="db-team" style="--c:${c2}"><div class="db-team-name">${escapeHtmlSafe(m.p2Name)}</div><div class="db-team-score">${m.scores[m.p2]}</div></div>
        </div>
        <div class="db-board-wrap">
          <svg class="db-board" id="db-board" viewBox="0 0 ${30*2 + 70*5} ${30*2 + 70*5}" width="100%" preserveAspectRatio="xMidYMid meet"></svg>
        </div>
      ` : ''}
      ${state.message ? `<p class="db-hint">${escapeHtmlSafe(state.message)}</p>` : ''}
    `;

    if (!m) return;
    const svg = document.getElementById('db-board');
    const STEP = 70, PAD = 30, DOT_R = 8;

    // Box fills
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const owner = m.boxes[r][c];
        const x = PAD + c * STEP, y = PAD + r * STEP;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x); rect.setAttribute('y', y);
        rect.setAttribute('width', STEP); rect.setAttribute('height', STEP);
        rect.setAttribute('rx', '4');
        rect.setAttribute('fill', owner ? colorFor(owner, players) + '33' : 'rgba(255,255,255,0.015)');
        svg.appendChild(rect);
        if (owner) {
          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('x', x + STEP/2); txt.setAttribute('y', y + STEP/2 + 6);
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('font-family', 'Orbitron, sans-serif');
          txt.setAttribute('font-size', '20'); txt.setAttribute('font-weight', '900');
          txt.setAttribute('fill', colorFor(owner, players));
          const ownerName = (owner === m.p1 ? m.p1Name : m.p2Name) || '?';
          txt.textContent = ownerName[0].toUpperCase();
          svg.appendChild(txt);
        }
      }
    }

    // Edge drawing helpers
    const drawEdge = (etype, r, c) => {
      const isH = etype === 'h';
      const claimed = m.edges[etype][r][c];
      const x1 = isH ? PAD + c * STEP + DOT_R : PAD + c * STEP;
      const y1 = isH ? PAD + r * STEP : PAD + r * STEP + DOT_R;
      const x2 = isH ? PAD + (c + 1) * STEP - DOT_R : PAD + c * STEP;
      const y2 = isH ? PAD + r * STEP : PAD + (r + 1) * STEP - DOT_R;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', claimed ? colorFor(claimed, players) : 'rgba(255,255,255,0.06)');
      line.setAttribute('stroke-width', claimed ? '6' : '3');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
      if (!claimed && isMyTurn && !m.finished) {
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hit.setAttribute('x1', x1); hit.setAttribute('y1', y1);
        hit.setAttribute('x2', x2); hit.setAttribute('y2', y2);
        hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', '20');
        hit.style.cursor = 'pointer';
        const myColor = colorFor(socket.id, players);
        hit.addEventListener('mouseenter', () => line.setAttribute('stroke', myColor + '88'));
        hit.addEventListener('mouseleave', () => line.setAttribute('stroke', 'rgba(255,255,255,0.06)'));
        hit.addEventListener('click', () => socket.emit('dots-move', { roomCode, etype, r, c }));
        svg.appendChild(hit);
      }
    };

    for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) drawEdge('h', r, c);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) drawEdge('v', r, c);

    // Black-circle dots on top
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const cx = PAD + c * STEP, cy = PAD + r * STEP;
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('r', DOT_R);
        ring.setAttribute('fill', '#0A0E18'); ring.setAttribute('stroke', '#000'); ring.setAttribute('stroke-width', '2');
        svg.appendChild(ring);
      }
    }

    // When all matches done, signal completion
    if (allDone && !myFinishSent) {
      myFinishSent = true;
      if (onComplete) onComplete(null);
    }
  }

  function escapeHtmlSafe(s) {
    return String(s || '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  }

  const onState = (state) => render(state);
  socket.on('dots-state', onState);

  showWaiting();
  socket.emit('stage-ready', { roomCode, stage: 'dots' });

  const stuckTimer = setTimeout(() => {
    if (lastState) return;
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <h2 style="font-family:'Orbitron',sans-serif;letter-spacing:3px;color:var(--green);">DOTS &amp; BOXES</h2>
        <p style="margin:20px 0;color:var(--red);">Dots &amp; Boxes hasn't started yet.</p>
        ${isHost
          ? '<button id="dots-host-restart" class="btn-game btn-game-primary">▶ Start now</button>'
          : '<p style="color:var(--cyan)">Ask the host to start the game.</p>'}
      </div>
    `;
    document.getElementById('dots-host-restart')?.addEventListener('click', () => {
      socket.emit('dots-host-start', { roomCode });
    });
  }, 6000);
  const cancelStuck = (state) => { if (state) clearTimeout(stuckTimer); };
  socket.on('dots-state', cancelStuck);

  return {
    handleRemoteAction: () => {},
    cleanup: () => {
      socket.off('dots-state', onState);
      socket.off('dots-state', cancelStuck);
      clearTimeout(stuckTimer);
    }
  };
}

/* ============================================================
   SOLO Dots & Boxes (vs CPU) — used in singleplayer
   ============================================================ */
function initDots_solo(containerId, onComplete, currentUser) {
  const container = document.getElementById(containerId);
  const BOXES = 5, DOTS = 6;
  const playerName = currentUser?.name || 'Player 1';
  const playerId = currentUser?.id || 'player1';

  const players = [
    { name: playerName, color: '#2D8CFF', glow: 'rgba(45,140,255,.55)', isCPU: false, id: playerId },
    { name: 'CPU',      color: '#FF3B6B', glow: 'rgba(255,59,107,.55)', isCPU: true,  id: 'cpu' }
  ];

  let edges = { h: [], v: [] };
  let edgeOwner;
  let boxes = [];
  let scores = [0,0];
  let currentPlayer = 0;
  let gameActive = true;

  function init() {
    edges.h = Array.from({ length: DOTS }, () => Array(BOXES).fill(false));
    edges.v = Array.from({ length: BOXES }, () => Array(DOTS).fill(false));
    edgeOwner = { h: Array.from({ length: DOTS }, () => Array(BOXES).fill(-1)),
                  v: Array.from({ length: BOXES }, () => Array(DOTS).fill(-1)) };
    boxes = Array.from({ length: BOXES }, () => Array(BOXES).fill(-1));
    scores = [0,0]; currentPlayer = 0; gameActive = true;
    render();
  }
  function tryClaim(t,r,c) { if (!gameActive || currentPlayer !== 0) return false; return claim(t,r,c); }
  function claim(t,r,c) {
    if (!edges[t][r] || edges[t][r][c]) return false;
    edges[t][r][c] = true; edgeOwner[t][r][c] = currentPlayer;
    let claimed = false;
    for (let i=0;i<BOXES;i++) for (let j=0;j<BOXES;j++) {
      if (boxes[i][j] === -1 && isBox(i,j)) { boxes[i][j] = currentPlayer; scores[currentPlayer]++; claimed = true; }
    }
    if (scores[0]+scores[1] === BOXES*BOXES) {
      gameActive = false;
      const winner = scores[0]===scores[1]? -1 : (scores[0]>scores[1]?0:1);
      if (onComplete) {
        if (winner === -1) onComplete({});
        else onComplete({ [players[winner].id]: 100 + Math.max(...scores)*10 });
      }
      render(winner);
      return true;
    }
    if (!claimed) currentPlayer = 1 - currentPlayer;
    render();
    if (gameActive && currentPlayer === 1) setTimeout(cpuMove, 600);
    return true;
  }
  function isBox(r,c) { return edges.h[r][c]&&edges.h[r+1][c]&&edges.v[r][c]&&edges.v[r][c+1]; }
  function cpuMove() {
    if (!gameActive || currentPlayer !== 1) return;
    const moves = freeEdges();
    let chosen = moves.find(m => wouldComplete(m.t,m.r,m.c));
    if (!chosen) {
      const safe = moves.filter(m => !createsThird(m.t,m.r,m.c));
      chosen = (safe.length?safe:moves)[Math.floor(Math.random()*(safe.length||moves.length))];
    }
    if (chosen) claim(chosen.t, chosen.r, chosen.c);
  }
  function freeEdges() {
    const out = [];
    for (let r=0;r<DOTS;r++) for (let c=0;c<BOXES;c++) if (!edges.h[r][c]) out.push({t:'h',r,c});
    for (let r=0;r<BOXES;r++) for (let c=0;c<DOTS;c++) if (!edges.v[r][c]) out.push({t:'v',r,c});
    return out;
  }
  function boxEdgeCount(r,c) { return (edges.h[r][c]?1:0)+(edges.h[r+1][c]?1:0)+(edges.v[r][c]?1:0)+(edges.v[r][c+1]?1:0); }
  function wouldComplete(t,r,c) {
    edges[t][r][c]=true; let res=false;
    for (let i=0;i<BOXES&&!res;i++) for (let j=0;j<BOXES&&!res;j++) if (boxes[i][j]===-1 && isBox(i,j)) res=true;
    edges[t][r][c]=false; return res;
  }
  function createsThird(t,r,c) {
    edges[t][r][c]=true; let res=false;
    for (let i=0;i<BOXES&&!res;i++) for (let j=0;j<BOXES&&!res;j++) if (boxes[i][j]===-1 && boxEdgeCount(i,j)===3) res=true;
    edges[t][r][c]=false; return res;
  }
  const STEP=70, PAD=30, DOT_R=8;
  const SIZE = STEP*(DOTS-1) + PAD*2;
  function render(winnerIdx) {
    const turn = gameActive
      ? `<span style="color:${players[currentPlayer].color};font-weight:700;">${players[currentPlayer].name}</span>'s turn`
      : (winnerIdx === -1 ? '<span style="color:var(--gold)">It\'s a draw!</span>'
        : `<span style="color:${players[winnerIdx].color};font-weight:700;">🏆 ${players[winnerIdx].name} wins!</span>`);
    container.innerHTML = `
      <div class="db-scoreboard">
        <div class="db-team" style="--c:${players[0].color}"><div class="db-team-name">${players[0].name}</div><div class="db-team-score">${scores[0]}</div></div>
        <div class="db-vs">VS</div>
        <div class="db-team" style="--c:${players[1].color}"><div class="db-team-name">${players[1].name}</div><div class="db-team-score">${scores[1]}</div></div>
      </div>
      <div class="db-status">${turn}</div>
      <div class="db-board-wrap">
        <svg class="db-board" viewBox="0 0 ${SIZE} ${SIZE}" width="100%" preserveAspectRatio="xMidYMid meet"></svg>
      </div>
    `;
    const svg = container.querySelector('.db-board');
    for (let r=0;r<BOXES;r++) for (let c=0;c<BOXES;c++) {
      const owner = boxes[r][c]; const x = PAD+c*STEP, y = PAD+r*STEP;
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x',x); rect.setAttribute('y',y); rect.setAttribute('width',STEP); rect.setAttribute('height',STEP); rect.setAttribute('rx','4');
      rect.setAttribute('fill', owner===-1?'rgba(255,255,255,0.015)':`${players[owner].color}33`);
      svg.appendChild(rect);
      if (owner !== -1) {
        const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
        txt.setAttribute('x',x+STEP/2); txt.setAttribute('y',y+STEP/2+6); txt.setAttribute('text-anchor','middle');
        txt.setAttribute('font-family','Orbitron, sans-serif'); txt.setAttribute('font-size','20'); txt.setAttribute('font-weight','900');
        txt.setAttribute('fill', players[owner].color);
        txt.textContent = (players[owner].name[0]||'?').toUpperCase();
        svg.appendChild(txt);
      }
    }
    function drawEdge(etype,r,c) {
      const isH = etype==='h';
      const claimed = edges[etype][r][c];
      const owner = edgeOwner[etype][r][c];
      const x1 = isH ? PAD+c*STEP+DOT_R : PAD+c*STEP;
      const y1 = isH ? PAD+r*STEP : PAD+r*STEP+DOT_R;
      const x2 = isH ? PAD+(c+1)*STEP-DOT_R : PAD+c*STEP;
      const y2 = isH ? PAD+r*STEP : PAD+(r+1)*STEP-DOT_R;
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',x1); line.setAttribute('y1',y1); line.setAttribute('x2',x2); line.setAttribute('y2',y2);
      line.setAttribute('stroke', claimed ? players[owner].color : 'rgba(255,255,255,0.06)');
      line.setAttribute('stroke-width', claimed?'6':'3'); line.setAttribute('stroke-linecap','round');
      svg.appendChild(line);
      if (!claimed && gameActive && currentPlayer === 0) {
        const hit = document.createElementNS('http://www.w3.org/2000/svg','line');
        hit.setAttribute('x1',x1); hit.setAttribute('y1',y1); hit.setAttribute('x2',x2); hit.setAttribute('y2',y2);
        hit.setAttribute('stroke','transparent'); hit.setAttribute('stroke-width','20'); hit.style.cursor='pointer';
        hit.addEventListener('mouseenter', () => line.setAttribute('stroke', players[0].color+'88'));
        hit.addEventListener('mouseleave', () => line.setAttribute('stroke', 'rgba(255,255,255,0.06)'));
        hit.addEventListener('click', () => tryClaim(etype,r,c));
        svg.appendChild(hit);
      }
    }
    for (let r=0;r<DOTS;r++) for (let c=0;c<BOXES;c++) drawEdge('h',r,c);
    for (let r=0;r<BOXES;r++) for (let c=0;c<DOTS;c++) drawEdge('v',r,c);
    for (let r=0;r<DOTS;r++) for (let c=0;c<DOTS;c++) {
      const cx=PAD+c*STEP, cy=PAD+r*STEP;
      const ring = document.createElementNS('http://www.w3.org/2000/svg','circle');
      ring.setAttribute('cx',cx); ring.setAttribute('cy',cy); ring.setAttribute('r',DOT_R);
      ring.setAttribute('fill','#0A0E18'); ring.setAttribute('stroke','#000'); ring.setAttribute('stroke-width','2');
      svg.appendChild(ring);
    }
  }
  init();
  return { handleRemoteAction: () => {} };
}
