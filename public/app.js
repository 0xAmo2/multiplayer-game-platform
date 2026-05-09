let socket = null;
let currentUser = null;
let currentRoom = null;
let currentView = 'login';
let currentGameInstance = null;

const pages = {
  login: `
    <div class="login-wrapper">
      <div class="card" style="text-align:center;">
        <h1 class="arena-logo">ARENA</h1>
        <p class="arena-subtitle">Multiplayer Game Platform</p>
        <div class="input-group">
          <span class="input-icon">👤</span>
          <input type="text" id="nickname" placeholder="Enter your username" autocomplete="off">
        </div>
        <button class="btn-primary" id="login-btn">⚡ Enter Arena</button>
      </div>
    </div>
  `,

  modeSelect: `
    <div class="mode-wrapper">
      <div class="mode-header">
        <h2>Select Mode</h2>
        <p>Welcome, <span id="welcome-name" style="color:#E8EDF2;"></span></p>
      </div>
      <div class="mode-grid">
        <div class="mode-card solo" id="singleplayer-btn">
          <div class="mode-icon">🎮</div>
          <h3>SINGLEPLAYER</h3>
          <p>Play solo against AI challenges. Test your skills across all four games at your own pace.</p>
          <button class="mode-btn">▶ Play Solo</button>
        </div>
        <div class="mode-card multi" id="multiplayer-btn">
          <div class="mode-icon">🌐</div>
          <h3>MULTIPLAYER</h3>
          <p>Challenge real players online. Create a private party or join one with a room code.</p>
          <button class="mode-btn">🎯 Play With Friends</button>
        </div>
      </div>
    </div>
  `,

  singleplayer: `
    <div class="games-wrapper">
      <div class="games-header">
        <button class="btn-back" id="back-mode">← Back</button>
        <h2>Choose a Game</h2>
      </div>
      <div class="games-grid">
        <div class="game-tile memory" data-game="memory">
          <div class="tile-icon">🧠</div>
          <span class="tile-badge">Memory</span>
          <div class="tile-title">Memory Match</div>
          <div class="tile-desc">Test your focus and memory in this classic card matching challenge. Flip, remember, and match!</div>
          <button class="tile-play">Play Now →</button>
        </div>
        <div class="game-tile uno" data-game="uno">
          <div class="tile-icon">🃏</div>
          <span class="tile-badge">Cards</span>
          <div class="tile-title">UNO</div>
          <div class="tile-desc">Play the iconic card game. Use action cards strategically and be the first to empty your hand.</div>
          <button class="tile-play">Play Now →</button>
        </div>
        <div class="game-tile dots" data-game="dots">
          <div class="tile-icon">⬛</div>
          <span class="tile-badge">Strategy</span>
          <div class="tile-title">Dots & Boxes</div>
          <div class="tile-desc">Connect dots to form boxes. Outsmart your opponent and claim the most territory on the board.</div>
          <button class="tile-play">Play Now →</button>
        </div>
        <div class="game-tile c4" data-game="connect4">
          <div class="tile-icon">🔴</div>
          <span class="tile-badge">Classic</span>
          <div class="tile-title">4 in a Row</div>
          <div class="tile-desc">Drop discs and line up four in a row — vertically, horizontally, or diagonally. First to four wins!</div>
          <button class="tile-play">Play Now →</button>
        </div>
      </div>
    </div>
  `,

  multiplayerSetup: `
    <div class="card mp-card">
      <h2>Multiplayer Setup</h2>
      <div class="flex-row">
        <select id="difficulty" style="flex:1;">
          <option value="easy">🟢 Easy</option>
          <option value="medium">🟡 Medium</option>
          <option value="hard">🔴 Hard</option>
        </select>
        <select id="player-count" style="flex:1;">
          <option value="2">👥 2 Players</option>
          <option value="3">👥 3 Players</option>
          <option value="4">👥 4 Players</option>
        </select>
      </div>
      <button id="create-party-btn" class="btn-primary" style="margin:18px 0;">🎮 Create Party</button>
      <hr>
      <p class="text-muted" style="margin-bottom:12px;">Have a room code? Join an existing party:</p>
      <input type="text" id="room-code-input" placeholder="Enter room code (e.g. AB12CD)" style="text-transform:uppercase; letter-spacing:3px; text-align:center;">
      <button id="join-room-btn" style="margin-top:12px; width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#E8EDF2; padding:14px; border-radius:12px; font-weight:600;">🔗 Join Party</button>
      <button id="back-mode-mp" class="btn-back" style="margin-top:12px; width:100%; text-align:center;">← Back</button>
    </div>
  `,

  lobby: `
    <div class="card" style="max-width:640px; width:100%;">
      <div class="flex-between" style="margin-bottom:20px;">
        <div>
          <h2 style="font-family:'Orbitron',sans-serif; font-size:1.3rem; letter-spacing:2px;">Party Lobby</h2>
          <p class="text-muted" style="margin-top:4px;">Share the code or link with your friends to invite them.</p>
        </div>
        <div class="room-code" id="room-code-display"></div>
      </div>

      <p class="text-muted" style="font-size:0.75rem; letter-spacing:2px; margin-bottom:6px;">INVITE LINK</p>
      <div class="invite-row">
        <input type="text" id="invite-link" readonly>
        <button class="btn-copy" id="copy-link-btn">📋 Copy</button>
      </div>

      <p class="text-muted" style="font-size:0.75rem; letter-spacing:2px; margin:18px 0 6px;">PLAYERS IN ROOM</p>
      <div id="players-list"></div>

      <div class="flex-row" style="margin-top:24px;">
        <button id="start-party-btn" class="btn-primary" style="flex:1;">🚀 Start 4-Game Party</button>
        <button id="leave-lobby-btn" class="btn-danger">Leave</button>
      </div>
    </div>
  `
};

function loadPage(pageName) {
  document.getElementById('app').innerHTML = pages[pageName];
  attachEvents(pageName);
}

function attachEvents(pageName) {
  if (pageName === 'login') {
    const input = document.getElementById('nickname');
    const btn = document.getElementById('login-btn');

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btn.click();
    });

    btn?.addEventListener('click', () => {
      const nick = input.value.trim();
      if (!nick) {
        input.style.borderColor = '#FF3B6B';
        input.style.boxShadow = '0 0 0 3px rgba(255,59,107,0.2)';
        input.placeholder = 'Please enter a username!';
        return;
      }
      currentUser = { id: generateId(), name: nick, points: 0 };
      currentView = 'modeSelect';
      loadPage('modeSelect');
    });
  }

  else if (pageName === 'modeSelect') {
    const nameEl = document.getElementById('welcome-name');
    if (nameEl) nameEl.textContent = currentUser?.name || '';

    document.getElementById('singleplayer-btn')?.addEventListener('click', () => {
      currentView = 'singleplayer';
      loadPage('singleplayer');
    });
    document.getElementById('multiplayer-btn')?.addEventListener('click', () => {
      currentView = 'multiplayerSetup';
      loadPage('multiplayerSetup');
    });
  }

  else if (pageName === 'singleplayer') {
    document.querySelectorAll('.game-tile').forEach(tile => {
      tile.addEventListener('click', (e) => {
        const game = tile.dataset.game;
        if (game) startSingleplayerGame(game);
      });
    });
    document.getElementById('back-mode')?.addEventListener('click', () => {
      currentView = 'modeSelect';
      loadPage('modeSelect');
    });
  }

  else if (pageName === 'multiplayerSetup') {
    document.getElementById('create-party-btn')?.addEventListener('click', () => {
      const btn = document.getElementById('create-party-btn');
      const difficulty = document.getElementById('difficulty').value;
      const maxPlayers = parseInt(document.getElementById('player-count').value);
      if (!currentUser?.name) {
        showMpError('Please enter a username first.');
        return;
      }
      btn.disabled = true;
      btn.textContent = '⏳ Creating party…';
      initSocket(() => {
        const ackTimer = setTimeout(() => {
          showMpError('Could not reach the server. Make sure the game server is running on this host.');
          btn.disabled = false;
          btn.textContent = '🎮 Create Party';
        }, 6000);
        socket.emit('createRoom', { hostName: currentUser.name, difficulty, maxPlayers }, (res) => {
          clearTimeout(ackTimer);
          if (res && res.success) {
            currentRoom = { roomCode: res.roomCode, isHost: true, difficulty, maxPlayers };
            currentView = 'lobby';
            loadPage('lobby');
            populateLobby(res.roomCode);
            updateScoreboard();
          } else {
            showMpError((res && res.error) || 'Failed to create party.');
            btn.disabled = false;
            btn.textContent = '🎮 Create Party';
          }
        });
      });
    });
    document.getElementById('join-room-btn')?.addEventListener('click', () => {
      const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
      if (!roomCode) { showMpError('Enter a room code to join.'); return; }
      if (!currentUser?.name) { showMpError('Please enter a username first.'); return; }
      const btn = document.getElementById('join-room-btn');
      btn.disabled = true;
      btn.textContent = '⏳ Joining…';
      initSocket(() => {
        const ackTimer = setTimeout(() => {
          showMpError('Could not reach the server.');
          btn.disabled = false;
          btn.textContent = '🔗 Join Party';
        }, 6000);
        socket.emit('joinRoom', { roomCode, playerName: currentUser.name }, (res) => {
          clearTimeout(ackTimer);
          if (res && res.success) {
            currentRoom = { roomCode, isHost: false };
            currentView = 'lobby';
            loadPage('lobby');
            populateLobby(roomCode);
            updateScoreboard();
          } else {
            showMpError((res && res.error) || 'Failed to join party.');
            btn.disabled = false;
            btn.textContent = '🔗 Join Party';
          }
        });
      });
    });
    document.getElementById('back-mode-mp')?.addEventListener('click', () => {
      currentView = 'modeSelect';
      loadPage('modeSelect');
    });

    // Auto-fill room code from URL param ?room=XXXXXX
    const params = new URLSearchParams(window.location.search);
    const sharedRoom = params.get('room');
    if (sharedRoom) {
      const input = document.getElementById('room-code-input');
      if (input) input.value = sharedRoom.toUpperCase();
    }

    // Warn early if running under a static server (Live Server etc.)
    if (typeof io === 'undefined') {
      showMpError(
        'Static-server detected — multiplayer is disabled. ' +
        'Run "npm install && npm start" in a terminal and open http://localhost:3000 instead.'
      );
    }
  }

  else if (pageName === 'lobby') {
    document.getElementById('start-party-btn')?.addEventListener('click', () => {
      if (!socket || !currentRoom) return;
      socket.emit('startGame', currentRoom.roomCode);
    });
    document.getElementById('leave-lobby-btn')?.addEventListener('click', () => {
      if (socket) socket.disconnect();
      socket = null;
      currentRoom = null;
      currentView = 'multiplayerSetup';
      loadPage('multiplayerSetup');
    });
    document.getElementById('copy-link-btn')?.addEventListener('click', () => {
      const linkInput = document.getElementById('invite-link');
      if (!linkInput) return;
      linkInput.select();
      try {
        navigator.clipboard.writeText(linkInput.value).then(() => {
          const btn = document.getElementById('copy-link-btn');
          btn.classList.add('done');
          btn.textContent = '✓ Copied';
          setTimeout(() => { btn.classList.remove('done'); btn.textContent = '📋 Copy'; }, 1500);
        });
      } catch (_) {
        document.execCommand && document.execCommand('copy');
      }
    });
  }
}

function showMpError(msg) {
  const card = document.querySelector('.mp-card');
  if (!card) { alert(msg); return; }
  let banner = document.getElementById('mp-error');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'mp-error';
    banner.style.cssText = 'background:rgba(255,59,107,0.12);border:1px solid rgba(255,59,107,0.4);color:#FF3B6B;padding:10px 14px;border-radius:10px;font-size:0.85rem;margin-bottom:14px;';
    card.insertBefore(banner, card.firstChild.nextSibling);
  }
  banner.textContent = '⚠ ' + msg;
}

function populateLobby(roomCode) {
  const codeEl = document.getElementById('room-code-display');
  if (codeEl) codeEl.innerText = roomCode;
  const linkEl = document.getElementById('invite-link');
  if (linkEl) {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomCode);
    // strip hash and any extra path components for cleanliness
    linkEl.value = url.origin + url.pathname + '?room=' + roomCode;
  }
  // Hide start button for non-hosts
  const startBtn = document.getElementById('start-party-btn');
  if (startBtn && currentRoom && currentRoom.isHost === false) {
    startBtn.disabled = true;
    startBtn.style.opacity = '0.5';
    startBtn.style.cursor = 'not-allowed';
    startBtn.textContent = '⌛ Waiting for host…';
  }
}

function initSocket(callback) {
  if (typeof io === 'undefined') {
    showMpError(
      'Multiplayer requires the Node server (server.js). ' +
      'You appear to be running a static file server (e.g. VS Code Live Server). ' +
      'In a terminal, run: npm install && npm start, then open http://localhost:3000'
    );
    const btnA = document.getElementById('create-party-btn');
    if (btnA) { btnA.disabled = false; btnA.textContent = '🎮 Create Party'; }
    const btnB = document.getElementById('join-room-btn');
    if (btnB) { btnB.disabled = false; btnB.textContent = '🔗 Join Party'; }
    return;
  }
  if (!socket) {
    socket = io({ reconnectionAttempts: 3, timeout: 5000 });
    setupSocketListeners();
    socket.on('connect_error', (err) => {
      console.error('Socket connect_error:', err && err.message);
      if (currentView === 'multiplayerSetup') {
        showMpError('Cannot connect to server: ' + (err && err.message ? err.message : 'unknown error'));
      }
    });
  }
  callback();
}

function setupSocketListeners() {
  socket.on('roomUpdate', (data) => {
    if (currentView === 'lobby') {
      const playersList = document.getElementById('players-list');
      if (playersList) {
        playersList.innerHTML = data.players.map((p, i) =>
          `<div class="player-row">
            <span class="player-dot"></span>
            <span style="flex:1;">${escapeHtml(p.name)} ${p.id === socket.id ? '<span style="color:#6B7A90;font-size:0.75rem;">(you)</span>' : ''}</span>
            ${i === 0 ? '<span class="player-host-tag">HOST</span>' : ''}
          </div>`
        ).join('');
      }
    }
    if (currentRoom) currentRoom.players = data.players;
    updateScoreboard();
  });

  socket.on('gameStarted', (data) => {
    currentView = 'game';
    currentRoom.players = data.players;
    loadGameStage(data.gameOrder[0]);
  });

  socket.on('scoreUpdate', (data) => {
    if (currentRoom) currentRoom.players = data.players;
    updateScoreboard();
  });

  socket.on('nextGame', (data) => {
    const games = ['memory', 'uno', 'dots', 'connect4'];
    loadGameStage(games[data.index]);
  });

  socket.on('gameComplete', (data) => {
    currentRoom.players = data.players;
    updateScoreboard();
    document.getElementById('app').innerHTML = `
      <div class="card" style="max-width:560px;width:100%;text-align:center;">
        <h2 style="font-family:'Orbitron',sans-serif;font-size:1.5rem;letter-spacing:2px;margin-bottom:8px;">🏆 Game Complete!</h2>
        <p class="text-muted" style="margin-bottom:24px;">Final Rankings</p>
        <div id="final-rankings"></div>
        <button id="back-to-lobby" style="margin-top:24px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#E8EDF2; padding:14px 28px; border-radius:12px; font-weight:600;">Back to Lobby</button>
      </div>
    `;
    const sorted = [...currentRoom.players].sort((a, b) => b.points - a.points);
    document.getElementById('final-rankings').innerHTML = sorted.map((p, i) =>
      `<div style="padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:700; color:${i===0?'#FFB800':i===1?'#6B7A90':'#7D8B9F'};">${['🥇','🥈','🥉'][i] || `${i+1}.`}</span>
        <span>${escapeHtml(p.name)}</span>
        <span style="color:#FFB800; font-weight:700;">${p.points} pts</span>
      </div>`
    ).join('');
    document.getElementById('back-to-lobby')?.addEventListener('click', () => {
      currentView = 'lobby';
      loadPage('lobby');
      if (document.getElementById('room-code-display')) {
        document.getElementById('room-code-display').innerText = currentRoom.roomCode;
      }
    });
  });

  socket.on('gameAction', (data) => {
    if (currentGameInstance && data.action) {
      currentGameInstance.handleRemoteAction(data.action, data.gameData, data.senderId);
    }
  });

  socket.on('finishStatus', (data) => {
    const total = data?.totalPlayers || 0;
    const finishedIds = data?.finishedIds || [];
    const remaining = Math.max(0, total - finishedIds.length);
    const iAmFinished = finishedIds.includes(socket.id);
    const statusEl = document.getElementById('game-status');
    const overlay = document.getElementById('finish-overlay');

    if (statusEl) {
      if (iAmFinished && remaining > 0) {
        statusEl.style.display = 'inline-block';
        statusEl.textContent = `🏁 Finished — waiting for ${remaining} other${remaining === 1 ? '' : 's'}…`;
      } else if (iAmFinished) {
        statusEl.style.display = 'inline-block';
        statusEl.textContent = '✅ Everyone done — next game in 1s…';
      }
      // If I'm not finished, leave the status hidden / unchanged.
    }

    if (overlay && iAmFinished) {
      const others = (currentRoom?.players || [])
        .filter(p => !finishedIds.includes(p.socketId || p.id))
        .map(p => p.name);
      overlay.style.display = 'flex';
      overlay.innerHTML = remaining > 0
        ? `<div class="finish-overlay-card">
             <div class="finish-overlay-icon">🏁</div>
             <h3>You're done!</h3>
             <p>Waiting for ${remaining} other player${remaining === 1 ? '' : 's'} to finish:</p>
             <p class="finish-overlay-names">${others.map(n => '· ' + escapeHtml(n)).join('  ')}</p>
           </div>`
        : `<div class="finish-overlay-card finish-overlay-card-go">
             <div class="finish-overlay-icon">✅</div>
             <h3>Everyone finished!</h3>
             <p>Loading the next game…</p>
           </div>`;
    }
  });
}

function loadGameStage(gameName) {
  if (currentGameInstance && currentGameInstance.cleanup) currentGameInstance.cleanup();
  currentGameInstance = null;
  const labels = { memory: 'Memory Match', uno: 'UNO', dots: 'Dots & Boxes', connect4: '4 in a Row' };
  const container = document.getElementById('app');
  container.innerHTML = `
    <div class="card game-stage-card" style="width:100%; max-width:900px;">
      <div class="flex-between" style="margin-bottom:20px;">
        <h2>${labels[gameName] || gameName.toUpperCase()}</h2>
        <div id="game-status" class="status-message" style="display:none;"></div>
      </div>
      <div id="game-container" class="game-container"></div>
      <div id="finish-overlay" class="finish-overlay" style="display:none;"></div>
    </div>
  `;

  const finishMP = () => {
    if (socket && currentRoom) {
      socket.emit('playerFinished', { roomCode: currentRoom.roomCode });
    }
  };

  if (gameName === 'memory') {
    currentGameInstance = initMemoryValues(
      'game-container',
      currentRoom?.difficulty || 'medium',
      finishMP,
      socket,
      currentRoom?.roomCode,
      !!currentRoom?.isHost
    );
  } else if (gameName === 'uno') {
    currentGameInstance = initUNO('game-container', (scores) => {
      if (socket && currentRoom && scores) {
        socket.emit('updateScores', { roomCode: currentRoom.roomCode, scores });
      }
      // multiplayer flow advances via server (uno-winner triggers nextGame),
      // singleplayer flow uses finishMP only when there's a socket.
      if (socket && currentRoom) finishMP();
    }, socket, currentRoom?.roomCode, currentUser, !!currentRoom?.isHost);
  } else if (gameName === 'dots') {
    currentGameInstance = initDotsAndBoxes('game-container', (scores) => {
      if (socket && currentRoom && scores) {
        socket.emit('updateScores', { roomCode: currentRoom.roomCode, scores });
      }
      if (socket && currentRoom) finishMP();
    }, socket, currentRoom?.roomCode, currentUser, !!currentRoom?.isHost);
  } else if (gameName === 'connect4') {
    currentGameInstance = initConnect4('game-container', (scores) => {
      if (socket && currentRoom && scores) {
        socket.emit('updateScores', { roomCode: currentRoom.roomCode, scores });
      }
      if (socket && currentRoom) finishMP();
    }, socket, currentRoom?.roomCode, currentUser, !!currentRoom?.isHost);
  }
}

function startSingleplayerGame(game) {
  const container = document.getElementById('app');
  const names = { memory: 'Memory Match', uno: 'UNO', dots: 'Dots & Boxes', connect4: '4 in a Row' };
  container.innerHTML = `
    <div class="card game-stage-card" style="width:100%; max-width:900px;">
      <div class="flex-between" style="margin-bottom:20px;">
        <h2>${names[game] || game.toUpperCase()}</h2>
        <button id="back-single" class="btn-back">← Back</button>
      </div>
      <div id="game-container" class="game-container"></div>
    </div>
  `;

  if (game === 'memory') initMemoryValues('game-container', 'medium', () => {}, null, null);
  else if (game === 'uno') initUNO('game-container', () => {}, null, null, currentUser);
  else if (game === 'dots') initDotsAndBoxes('game-container', () => {}, null, null, currentUser);
  else if (game === 'connect4') initConnect4('game-container', () => {}, null, null, currentUser);

  document.getElementById('back-single')?.addEventListener('click', () => {
    currentView = 'singleplayer';
    loadPage('singleplayer');
  });
}

function updateScoreboard() {
  const container = document.getElementById('scoreboard-container');
  if (!currentRoom?.players?.length || (currentView !== 'lobby' && currentView !== 'game')) {
    container.innerHTML = '';
    return;
  }
  const sorted = [...currentRoom.players].sort((a, b) => b.points - a.points);
  container.innerHTML = `
    <div class="scoreboard">
      <div class="scoreboard-header">🏆 Live Rankings</div>
      <ul class="rank-list">
        ${sorted.map((p, i) => `
          <li>
            <span class="rank-number">${i + 1}</span>
            <span class="player-name">${escapeHtml(p.name)} ${p.id === socket?.id ? '<span style="color:#6B7A90;font-size:0.75rem;">(you)</span>' : ''}</span>
            <span class="player-points">${p.points} pts</span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

function escapeHtml(str) {
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

loadPage('login');