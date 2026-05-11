function initMemoryValues(containerId, difficulty, onComplete, socket, roomCode, isHost) {
  const isMulti = !!(socket && roomCode);
  if (isMulti) return initMemory_multi(containerId, socket, roomCode, !!isHost, onComplete);
  return initMemory_solo(containerId, difficulty, onComplete);
}

/* ============================================================
   MULTIPLAYER Memory — server-controlled levels (auto-starts)
   ============================================================ */
function initMemory_multi(containerId, socket, roomCode, isHost, onComplete) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('[memory] container not found:', containerId);
    return { handleRemoteAction: () => {}, cleanup: () => {} };
  }

  let lastState = null;
  let mySelections = [];
  let submitted = false;
  let countdownSeconds = null;

  function escapeHtmlSafe(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  }

  function showWaiting() {
    container.innerHTML = `
      <div class="mem-waiting">
        <h2 class="mem-waiting-title">MEMORY MATCH</h2>
        <p class="mem-waiting-sub">Everyone plays the same pattern at the same time.<br>Score per level — game auto-starts in a moment…</p>
        <div class="mem-loader"></div>
        ${isHost ? '<button id="mem-host-restart" class="btn-game btn-game-secondary" style="margin-top:18px;">Tap to (re)start memory</button>' : ''}
      </div>
    `;
    document.getElementById('mem-host-restart')?.addEventListener('click', () => {
      socket.emit('mem-host-start', { roomCode });
    });
  }

  function buildGrid(parent) {
    const grid = document.createElement('div');
    grid.className = 'memory-grid';
    grid.id = 'memory-grid';
    for (let i = 0; i < 64; i++) {
      const cell = document.createElement('div');
      cell.className = 'memory-cell';
      cell.dataset.index = i;
      cell.addEventListener('click', () => onCellClick(i));
      grid.appendChild(cell);
    }
    parent.appendChild(grid);
  }

  function onCellClick(index) {
    if (!lastState || lastState.phase !== 'recall' || submitted) return;
    if (mySelections.includes(index)) return;
    mySelections.push(index);
    const cell = document.querySelectorAll('.memory-cell')[index];
    if (cell) cell.classList.add('picked');
    if (mySelections.length >= lastState.patternLength) submit();
    else updateRecallStatus();
  }

  function updateRecallStatus() {
    const el = document.getElementById('mem-status');
    if (!el || !lastState) return;
    const remaining = lastState.patternLength - mySelections.length;
    if (submitted) {
      el.innerHTML = `<span style="color:var(--gold)">⌛ Submitted — waiting for others to finish this level…</span>`;
    } else if (remaining > 0) {
      el.innerHTML = `<span style="color:var(--gold)">🎯 Recall! Click ${remaining} more cell${remaining === 1 ? '' : 's'}</span>`;
    }
  }

  function submit() {
    if (submitted) return;
    submitted = true;
    socket.emit('mem-submit', { roomCode, cells: mySelections });
    updateRecallStatus();
  }

  function statusForPhase(state) {
    if (state.phase === 'memorize') return `<span style="color:var(--cyan)">👁 Memorize the highlighted cells… (${(state.memTime || 3).toFixed(1)}s)</span>`;
    if (state.phase === 'recall') return submitted
      ? `<span style="color:var(--gold)">⌛ Submitted — waiting for others to finish this level…</span>`
      : `<span style="color:var(--gold)">🎯 Recall! Click ${state.patternLength} cells</span>`;
    if (state.phase === 'result') {
      const last = state.lastResults && state.lastResults[socket.id];
      if (!last) return 'Calculating…';
      return last.correct
        ? `<span style="color:var(--green)">✓ Level ${state.level}: +${last.points} points!</span>`
        : `<span style="color:var(--red)">✗ Level ${state.level}: incorrect (0 points)</span>`;
    }
    return '';
  }

  function labelForPhase(p) {
    if (p === 'memorize') return 'Memorize';
    if (p === 'recall') return 'Recall';
    if (p === 'result') return 'Result';
    if (p === 'gameover') return 'Done';
    return p || '—';
  }

  function render(state) {
    try {
      lastState = state;
      if (state.phase === 'gameover') return renderGameOver(state);

      // Reset selections at start of each new memorize phase (level transition)
      if (state.phase === 'memorize') {
        mySelections = [];
        submitted = false;
      }

      container.innerHTML = `
        <div class="mem-hud">
          <div class="mem-stat"><span class="mem-stat-label">Level</span><span class="mem-stat-value">${state.level}/${state.maxLevel}</span></div>
          <div class="mem-stat"><span class="mem-stat-label">Phase</span><span class="mem-stat-value">${labelForPhase(state.phase)}</span></div>
          <div class="mem-stat"><span class="mem-stat-label">My Score</span><span class="mem-stat-value">${(state.scores && state.scores[socket.id]) || 0}</span></div>
          <div class="mem-stat"><span class="mem-stat-label">Pattern</span><span class="mem-stat-value">${state.patternLength} cells</span></div>
        </div>
        <div id="mem-grid-wrap"></div>
        <div id="mem-status" class="status-message">${statusForPhase(state)}</div>
        <div class="mem-players-row">
          ${(state.players || []).map(p => {
            const sub = state.submissions && state.submissions[p.socketId];
            const last = state.lastResults && state.lastResults[p.socketId];
            const myFlag = p.socketId === socket.id ? ' (you)' : '';
            let badge = '';
            if (state.phase === 'recall') badge = sub ? '<span class="mem-tag-done">✓ submitted</span>' : '<span class="mem-tag-wait">…thinking</span>';
            if (state.phase === 'result' && last) badge = last.correct
              ? `<span class="mem-tag-correct">✓ +${last.points}</span>`
              : `<span class="mem-tag-wrong">✗ 0</span>`;
            return `<div class="mem-player-chip">
              <span class="mem-player-name">${escapeHtmlSafe(p.name)}${myFlag}</span>
              <span class="mem-player-score">${(state.scores && state.scores[p.socketId]) || 0}</span>
              ${badge}
            </div>`;
          }).join('')}
        </div>
      `;

      const wrap = document.getElementById('mem-grid-wrap');
      if (!wrap) return;
      buildGrid(wrap);
      const cells = document.querySelectorAll('.memory-cell');

      if (state.phase === 'memorize' && Array.isArray(state.pattern)) {
        state.pattern.forEach(idx => cells[idx]?.classList.add('dark'));
      } else if (state.phase === 'recall') {
        mySelections.forEach(idx => cells[idx]?.classList.add('picked'));
      } else if (state.phase === 'result') {
        const myLast = state.lastResults && state.lastResults[socket.id];
        if (myLast?.correct) {
          mySelections.forEach(idx => cells[idx]?.classList.add('reveal-correct'));
        } else {
          mySelections.forEach(idx => cells[idx]?.classList.add('reveal-wrong'));
        }
      }
    } catch (err) {
      console.error('[memory] render error:', err);
      container.innerHTML = `<div style="padding:24px;color:var(--red)">Memory render error: ${escapeHtmlSafe(err.message)}<br><button class="btn-game btn-game-secondary" onclick="location.reload()">Reload</button></div>`;
    }
  }

  function renderGameOver(state) {
    playVictorySound();
    try {
      const ranked = (state.players || [])
        .map(p => ({ ...p, score: (state.finalScores && state.finalScores[p.socketId]) || 0 }))
        .sort((a, b) => b.score - a.score);
      container.innerHTML = `
        <div style="text-align:center;padding:30px 20px;">
          <h2 style="font-family:'Orbitron',sans-serif;letter-spacing:3px;color:var(--gold);">🏆 Memory Complete!</h2>
          <p style="color:var(--muted);margin:10px 0 24px;">Final scores</p>
          <div class="mem-final-list">
            ${ranked.map((p, i) => `
              <div class="mem-final-row">
                <span class="mem-final-rank">${['🥇','🥈','🥉'][i] || (i+1)+'.'}</span>
                <span class="mem-final-name">${escapeHtmlSafe(p.name)}${p.socketId === socket.id ? ' (you)' : ''}</span>
                <span class="mem-final-score">${p.score}</span>
              </div>
            `).join('')}
          </div>
          <div id="mem-countdown" class="mem-countdown">Waiting to move to next game…</div>
        </div>
      `;
      if (countdownSeconds != null) updateCountdownText(countdownSeconds);
    } catch (err) {
      console.error('[memory] gameover render error:', err);
    }
  }

  function updateCountdownText(secs) {
    const el = document.getElementById('mem-countdown');
    if (el) el.textContent = `Next game in ${secs}…`;
  }

  // Listeners
  const onState = (state) => render(state);
  const onCountdown = (data) => { countdownSeconds = data.seconds; updateCountdownText(data.seconds); };
  socket.on('mem-state', onState);
  socket.on('mem-countdown', onCountdown);

  // Initial waiting screen
  showWaiting();

  // Tell the server we're ready to receive memory state. Server starts memory once everyone has confirmed.
  socket.emit('stage-ready', { roomCode, stage: 'memory' });

  // Safety net: if no mem-state arrives in 6 seconds, surface a retry button.
  const stuckTimer = setTimeout(() => {
    if (lastState) return;
    container.innerHTML = `
      <div class="mem-waiting">
        <h2 class="mem-waiting-title">MEMORY MATCH</h2>
        <p class="mem-waiting-sub" style="color:var(--red)">Memory hasn't started yet. The server may not have received your ready signal.</p>
        ${isHost
          ? '<button id="mem-host-restart" class="btn-game btn-game-primary">▶ Start Memory now</button>'
          : '<p style="color:var(--cyan)">Ask the host to click "Start Memory now".</p>'}
      </div>
    `;
    document.getElementById('mem-host-restart')?.addEventListener('click', () => {
      socket.emit('mem-host-start', { roomCode });
    });
  }, 6000);

  // First state cancels the safety net
  const cancelStuck = (state) => { if (state) clearTimeout(stuckTimer); };
  socket.on('mem-state', cancelStuck);

  return {
    handleRemoteAction: () => {},
    cleanup: () => {
      socket.off('mem-state', onState);
      socket.off('mem-state', cancelStuck);
      socket.off('mem-countdown', onCountdown);
      clearTimeout(stuckTimer);
    }
  };
}

/* ============================================================
   SOLO Memory (singleplayer, unchanged)
   ============================================================ */
function initMemory_solo(containerId, difficulty, onComplete) {
  const container = document.getElementById(containerId);
  let currentLevel = 1;
  let score = 0;
  let patternCells = [];
  let userSelections = [];
  let gameActive = false;
  let timeoutId = null;
  let isRecallPhase = false;

  const maxLevel = 8;
  const totalCells = 64;
  const mult = ({ easy: 0.8, medium: 1, hard: 1.3 })[difficulty] || 1;
  const getPatternCount = (level) => Math.min(14, Math.floor(2 + level * 0.9 * mult));
  const getMemorizeTime = (level) => Math.min(8, 2.5 + (level - 1) * 0.55 / mult);

  container.innerHTML = `
    <div class="mem-hud">
      <div class="mem-stat"><span class="mem-stat-label">Level</span><span class="mem-stat-value"><span id="mem-level">1</span>/${maxLevel}</span></div>
      <div class="mem-stat"><span class="mem-stat-label">Score</span><span class="mem-stat-value" id="mem-score">0</span></div>
      <div class="mem-stat"><span class="mem-stat-label">Memorize</span><span class="mem-stat-value"><span id="mem-time">${getMemorizeTime(1).toFixed(1)}</span>s</span></div>
    </div>
    <div class="memory-grid" id="memory-grid"></div>
    <div id="mem-status" class="status-message">Press Start to begin</div>
    <div style="text-align:center; margin-top:10px;">
      <button id="mem-start" class="btn-game btn-game-primary">▶ Start Game</button>
    </div>
  `;
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.classList.add('memory-cell');
    cell.dataset.index = i;
    cell.addEventListener('click', () => onClick(parseInt(cell.dataset.index)));
    document.getElementById('memory-grid').appendChild(cell);
  }
  const cells = document.querySelectorAll('.memory-cell');
  const startBtn = document.getElementById('mem-start');
  const statusDiv = document.getElementById('mem-status');
  const scoreSpan = document.getElementById('mem-score');
  const levelSpan = document.getElementById('mem-level');
  const timeSpan = document.getElementById('mem-time');

  function onClick(idx) {
    if (!gameActive || !isRecallPhase) return;
    if (userSelections.includes(idx)) return;
    userSelections.push(idx);
    if (patternCells.includes(idx)) cells[idx].classList.add('correct');
    else cells[idx].classList.add('wrong');
    if (userSelections.length === patternCells.length) verify();
  }
  function showPattern() {
    cells.forEach(c => c.classList.remove('dark','correct','wrong','reveal-correct','reveal-wrong'));
    patternCells.forEach(i => cells[i].classList.add('dark'));
  }
  function genPattern(level) {
    const cnt = getPatternCount(level); const set = new Set();
    while (set.size < cnt) set.add(Math.floor(Math.random() * totalCells));
    return Array.from(set);
  }
  function verify() {
    const sp = [...patternCells].sort((a,b)=>a-b);
    const su = [...userSelections].sort((a,b)=>a-b);
    const ok = sp.length === su.length && sp.every((v,i)=>v===su[i]);
    if (ok) {
      patternCells.forEach(i => cells[i].classList.add('reveal-correct'));
      const pts = currentLevel * 100; score += pts; scoreSpan.innerText = score;
      if (currentLevel === maxLevel) {
        statusDiv.innerHTML = '<span style="color:var(--green)">🎉 Perfect Memory!</span>';
        playVictorySound();
        gameActive = false; startBtn.style.display = 'inline-block'; startBtn.textContent = '🔄 Play Again';
        if (onComplete) onComplete({ single: score });
        return;
      }
      currentLevel++; levelSpan.innerText = currentLevel; timeSpan.innerText = getMemorizeTime(currentLevel).toFixed(1);
      statusDiv.innerHTML = `<span style="color:var(--green)">✓ +${pts} pts!</span>`;
      setTimeout(begin, 1400);
    } else {
      patternCells.forEach(i => { if (!userSelections.includes(i)) cells[i].classList.add('reveal-correct'); });
      userSelections.forEach(i => { if (!patternCells.includes(i)) cells[i].classList.add('reveal-wrong'); });
      statusDiv.innerHTML = `<span style="color:var(--red)">✗ Wrong! Final score: ${score}</span>`;
      gameActive = false; startBtn.style.display = 'inline-block'; startBtn.textContent = '🔄 Play Again';
      if (onComplete) onComplete({ single: score });
    }
  }
  function begin() {
    patternCells = genPattern(currentLevel); showPattern(); isRecallPhase = false;
    statusDiv.innerHTML = '<span style="color:var(--cyan)">👁 Memorize…</span>';
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      cells.forEach(c => c.classList.remove('dark'));
      userSelections = []; isRecallPhase = true;
      statusDiv.innerHTML = '<span style="color:var(--gold)">🎯 Recall!</span>';
    }, getMemorizeTime(currentLevel) * 1000);
  }
  startBtn.addEventListener('click', () => {
    cells.forEach(c => c.classList.remove('dark','correct','wrong','reveal-correct','reveal-wrong'));
    gameActive = true; currentLevel = 1; score = 0;
    scoreSpan.innerText = '0'; levelSpan.innerText = '1'; timeSpan.innerText = getMemorizeTime(1).toFixed(1);
    startBtn.style.display = 'none';
    begin();
  });
  return { handleRemoteAction: () => {} };
}
