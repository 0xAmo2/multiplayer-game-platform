function initUNO(containerId, onComplete, socket, roomCode, currentUser, isHost) {
  const container = document.getElementById(containerId);
  const isMulti = !!(socket && roomCode);

  if (isMulti) return initUNO_multi(containerId, onComplete, socket, roomCode, currentUser, !!isHost);
  return initUNO_solo(containerId, onComplete, currentUser);
}

/* ============================================================
   MULTIPLAYER UNO — server authoritative
   ============================================================ */
function initUNO_multi(containerId, onComplete, socket, roomCode, currentUser, isHost) {
  const container = document.getElementById(containerId);
  let lastState = null;
  let waitingForColor = false;
  let pendingWildIdx = null;
  let finishedSent = false;

  function cardSymbol(value) {
    if (value === 'skip') return '⊘';
    if (value === 'reverse') return '⇄';
    if (value === 'draw2') return '+2';
    if (value === 'wild') return '★';
    if (value === 'wild4') return '+4';
    return value;
  }

  function cssColor(c) {
    return ({ red: '#E53935', blue: '#1E88E5', green: '#43A047', yellow: '#FDD835' })[c] || '#666';
  }

  function buildCardElement(card, options = {}) {
    const { faceDown = false, small = false, clickable = false } = options;
    const div = document.createElement('div');
    div.className = `uno-card ${faceDown ? 'back' : card.color}${small ? ' small' : ''}`;
    if (faceDown) {
      div.innerHTML = `<div class="uno-back-logo">UNO</div>`;
      return div;
    }
    const sym = cardSymbol(card.value);
    div.innerHTML = `
      <div class="uno-corner top-left">${sym}</div>
      <div class="uno-oval"><span class="uno-center-value">${sym}</span></div>
      <div class="uno-corner bottom-right">${sym}</div>
    `;
    if (!clickable) div.classList.add('disabled');
    return div;
  }

  function unoCanPlay(card, color, value) {
    if (!card) return false;
    if (card.color === 'wild') return true;
    if (card.color === color) return true;
    if (card.value === value) return true;
    return false;
  }

  function showWaiting() {
    container.innerHTML = `
      <div class="uno-table" style="text-align:center;padding:60px 20px;">
        <h2 style="font-family:'Orbitron',sans-serif;letter-spacing:3px;color:var(--gold);">UNO</h2>
        <p style="margin:20px 0;color:var(--muted);">All players take turns — first to empty your hand wins!</p>
        <div class="mem-loader"></div>
        <p style="margin-top:16px;color:var(--cyan);">Starting in a moment…</p>
        ${isHost ? '<button id="uno-host-restart" class="btn-game btn-game-secondary" style="margin-top:18px;">Tap to start UNO</button>' : ''}
      </div>
    `;
    document.getElementById('uno-host-restart')?.addEventListener('click', () => {
      socket.emit('uno-host-start', { roomCode });
    });
  }

  function render(state) {
    if (!state) return;
    lastState = state;
    const isMyTurn = state.currentPlayerSocketId === socket.id && !state.winner;
    const myName = currentUser?.name || 'You';

    // Turn banner text
    const turnLine = state.winner
      ? `🏆 ${state.players.find(p => p.socketId === state.winner)?.name || ''} wins UNO!`
      : (isMyTurn ? `🎯 Your turn (${myName})` : `Now it's ${state.currentPlayerName}'s turn`);

    const oppArranged = state.opponents;

    container.innerHTML = `
      <div class="uno-turn-banner ${isMyTurn ? 'my-turn' : ''}">${turnLine}</div>
      <div class="uno-table">
        <div class="uno-opponents-row">
          ${oppArranged.map(o => `
            <div class="uno-opp ${state.currentPlayerSocketId === o.socketId ? 'active' : ''}">
              <div class="uno-name-tag">
                <span class="uno-avatar">🧑</span>
                <span>${escapeHtmlSafe(o.name)}</span>
                <span class="uno-card-count">${o.cardCount}</span>
                ${o.cardCount === 1 ? '<span class="uno-call">UNO!</span>' : ''}
              </div>
              <div class="uno-opponent-hand"></div>
            </div>
          `).join('')}
        </div>

        <div class="uno-middle">
          <div class="uno-pile">
            <div class="uno-pile-label">DRAW</div>
            <div class="uno-deck" id="uno-draw-pile">
              ${state.drawCount > 0 ? '<div class="uno-card back small"><div class="uno-back-logo">UNO</div></div>' : '<div style="color:var(--muted);font-size:.8rem;">Empty</div>'}
            </div>
            <div class="uno-pile-count">${state.drawCount}</div>
          </div>
          <div class="uno-pile">
            <div class="uno-pile-label">DISCARD</div>
            <div class="uno-deck" id="uno-discard"></div>
            <div class="uno-color-indicator" style="background:${cssColor(state.currentColor)}"></div>
          </div>
        </div>

        ${state.message ? `<div class="uno-status">${escapeHtmlSafe(state.message)}</div>` : ''}

        <div class="uno-self">
          <div class="uno-name-tag self ${isMyTurn ? 'active' : ''}">
            <span class="uno-avatar">🧑</span>
            <span>${escapeHtmlSafe(myName)}</span>
            <span class="uno-card-count">${state.hand.length}</span>
            ${state.hand.length === 1 ? '<span class="uno-call">UNO!</span>' : ''}
          </div>
          <div class="uno-hand" id="uno-hand"></div>
          <div class="uno-actions">
            <button id="uno-draw-btn" class="btn-game btn-game-secondary" ${!isMyTurn ? 'disabled' : ''}>↓ Draw Card</button>
          </div>
        </div>
      </div>

      ${waitingForColor ? `
        <div class="uno-color-modal">
          <div class="uno-color-modal-inner">
            <h3>Choose a color</h3>
            <div class="uno-color-choices">
              <button class="uno-color-pick red" data-color="red">Red</button>
              <button class="uno-color-pick blue" data-color="blue">Blue</button>
              <button class="uno-color-pick green" data-color="green">Green</button>
              <button class="uno-color-pick yellow" data-color="yellow">Yellow</button>
            </div>
          </div>
        </div>` : ''}
    `;

    // Discard pile
    const discardEl = document.getElementById('uno-discard');
    if (discardEl && state.topCard) discardEl.appendChild(buildCardElement(state.topCard));

    // Opponents face-down hands
    document.querySelectorAll('.uno-opp').forEach((el, i) => {
      const handEl = el.querySelector('.uno-opponent-hand');
      const cnt = Math.min(state.opponents[i].cardCount, 8);
      for (let k = 0; k < cnt; k++) {
        handEl.appendChild(buildCardElement({}, { faceDown: true, small: true }));
      }
    });

    // Self hand
    const handEl = document.getElementById('uno-hand');
    if (handEl) {
      state.hand.forEach((card, idx) => {
        const playable = isMyTurn && unoCanPlay(card, state.currentColor, state.currentValue);
        const el = buildCardElement(card, { clickable: playable });
        if (playable) {
          el.classList.add('playable');
          el.addEventListener('click', () => {
            if (card.color === 'wild') {
              pendingWildIdx = idx;
              waitingForColor = true;
              render(lastState);
            } else {
              socket.emit('uno-play', { roomCode, cardIdx: idx });
            }
          });
        }
        handEl.appendChild(el);
      });
    }

    document.getElementById('uno-draw-btn')?.addEventListener('click', () => {
      if (!isMyTurn) return;
      socket.emit('uno-draw', { roomCode });
    });

    document.querySelectorAll('.uno-color-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        socket.emit('uno-play', { roomCode, cardIdx: pendingWildIdx, chosenColor: color });
        waitingForColor = false;
        pendingWildIdx = null;
      });
    });

    // If game is finished (winner), inform stage we're done
    if (state.winner && !finishedSent) {
      finishedSent = true;
      playVictorySound();
      if (onComplete) onComplete(null);
    }
  }

  function escapeHtmlSafe(s) {
    return String(s || '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  }

  // Listen for state from server
  const onState = (state) => render(state);
  socket.on('uno-state', onState);

  showWaiting();
  socket.emit('stage-ready', { roomCode, stage: 'uno' });

  const stuckTimer = setTimeout(() => {
    if (lastState) return;
    container.innerHTML = `
      <div class="uno-table" style="text-align:center;padding:60px 20px;">
        <h2 style="font-family:'Orbitron',sans-serif;letter-spacing:3px;color:var(--gold);">UNO</h2>
        <p style="margin:20px 0;color:var(--red);">UNO hasn't started yet.</p>
        ${isHost
          ? '<button id="uno-host-restart" class="btn-game btn-game-primary">▶ Start UNO now</button>'
          : '<p style="color:var(--cyan)">Ask the host to click \"Start UNO now\".</p>'}
      </div>
    `;
    document.getElementById('uno-host-restart')?.addEventListener('click', () => {
      socket.emit('uno-host-start', { roomCode });
    });
  }, 6000);
  const cancelStuck = (state) => { if (state) clearTimeout(stuckTimer); };
  socket.on('uno-state', cancelStuck);

  return {
    handleRemoteAction: () => {},
    cleanup: () => {
      socket.off('uno-state', onState);
      socket.off('uno-state', cancelStuck);
      clearTimeout(stuckTimer);
    }
  };
}

/* ============================================================
   SOLO UNO — vs CPU (single-player mode)
   ============================================================ */
function initUNO_solo(containerId, onComplete, currentUser) {
  const container = document.getElementById(containerId);
  const colors = ['red', 'blue', 'green', 'yellow'];
  const numberValues = ['0','1','2','3','4','5','6','7','8','9'];
  const actionValues = ['skip','reverse','draw2'];

  let drawPile = [];
  let discardPile = [];
  let players = [];
  let currentPlayerIndex = 0;
  let direction = 1;
  let currentColor = 'red';
  let currentValue = '0';
  let gameActive = false;
  let waitingForColor = false;
  let pendingWildIdx = null;
  const playerName = currentUser?.name || 'You';
  const playerId = currentUser?.id || 'player1';

  function createDeck() {
    const deck = [];
    for (const c of colors) {
      for (const v of numberValues) {
        deck.push({ color: c, value: v });
        if (v !== '0') deck.push({ color: c, value: v });
      }
      for (const v of actionValues) {
        deck.push({ color: c, value: v });
        deck.push({ color: c, value: v });
      }
    }
    for (let i = 0; i < 4; i++) deck.push({ color: 'wild', value: 'wild' });
    for (let i = 0; i < 4; i++) deck.push({ color: 'wild', value: 'wild4' });
    return shuffle(deck);
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function startGame() {
    drawPile = createDeck();
    discardPile = [];
    players = [
      { id: playerId, hand: [], name: playerName, isCPU: false },
      { id: 'cpu1', hand: [], name: 'CPU', isCPU: true }
    ];
    for (let i = 0; i < 7; i++) {
      players[0].hand.push(drawPile.pop());
      players[1].hand.push(drawPile.pop());
    }
    let firstCard = drawPile.pop();
    while (firstCard.value === 'wild' || firstCard.value === 'wild4') {
      drawPile.unshift(firstCard);
      firstCard = drawPile.pop();
    }
    discardPile.push(firstCard);
    currentColor = firstCard.color; currentValue = firstCard.value;
    currentPlayerIndex = 0; direction = 1; gameActive = true;
    render();
  }
  function canPlay(card) {
    if (card.color === 'wild') return true;
    if (card.color === currentColor) return true;
    if (card.value === currentValue) return true;
    return false;
  }
  function nextPlayerIdx() { return (currentPlayerIndex + direction + players.length) % players.length; }
  function advance() { currentPlayerIndex = nextPlayerIdx(); }
  function applyEffect(card) {
    if (card.value === 'skip') advance();
    else if (card.value === 'reverse') { direction *= -1; if (players.length === 2) advance(); }
    else if (card.value === 'draw2') { const n = nextPlayerIdx(); drawCards(n, 2); advance(); }
    else if (card.value === 'wild4') { const n = nextPlayerIdx(); drawCards(n, 4); advance(); }
  }
  function drawCards(idx, n) {
    for (let i = 0; i < n; i++) {
      if (drawPile.length === 0) replenish();
      if (drawPile.length === 0) return;
      players[idx].hand.push(drawPile.pop());
    }
  }
  function replenish() {
    if (discardPile.length <= 1) return;
    const top = discardPile.pop();
    drawPile = shuffle(discardPile.slice());
    discardPile = [top];
  }
  function playCard(playerIdx, cardIdx, chosenColor) {
    if (!gameActive || playerIdx !== currentPlayerIndex) return;
    if (waitingForColor && !chosenColor) return;
    const card = players[playerIdx].hand[cardIdx];
    if (!card || !canPlay(card)) return;
    if (card.color === 'wild' && !chosenColor && !players[playerIdx].isCPU) {
      pendingWildIdx = cardIdx; waitingForColor = true; render(); return;
    }
    players[playerIdx].hand.splice(cardIdx, 1);
    discardPile.push(card);
    if (card.color === 'wild') { currentColor = chosenColor || colors[Math.floor(Math.random()*4)]; currentValue = card.value; }
    else { currentColor = card.color; currentValue = card.value; }
    if (players[playerIdx].hand.length === 0) {
      gameActive = false;
      playVictorySound();
      if (onComplete) onComplete({ [players[playerIdx].id]: 500 });
      render(`🏆 ${players[playerIdx].name} wins!`);
      return;
    }
    applyEffect(card); advance();
    waitingForColor = false; pendingWildIdx = null;
    render();
    if (gameActive && players[currentPlayerIndex].isCPU) setTimeout(cpuPlay, 800);
  }
  function cpuPlay() {
    if (!gameActive || !players[currentPlayerIndex].isCPU) return;
    const hand = players[currentPlayerIndex].hand;
    let idx = hand.findIndex(c => c.color !== 'wild' && canPlay(c));
    if (idx === -1) idx = hand.findIndex(c => c.color === 'wild');
    if (idx !== -1) {
      const card = hand[idx];
      const chosen = card.color === 'wild' ? bestColor(hand) : null;
      playCard(currentPlayerIndex, idx, chosen);
    } else {
      drawCards(currentPlayerIndex, 1);
      const last = hand[hand.length-1];
      if (last && canPlay(last)) {
        const chosen = last.color === 'wild' ? bestColor(hand) : null;
        playCard(currentPlayerIndex, hand.length-1, chosen);
      } else { advance(); render(); if (gameActive && players[currentPlayerIndex].isCPU) setTimeout(cpuPlay, 800); }
    }
  }
  function bestColor(hand) {
    const cnt = { red:0, blue:0, green:0, yellow:0 };
    hand.forEach(c => cnt[c.color] !== undefined && cnt[c.color]++);
    return Object.keys(cnt).reduce((a,b) => cnt[a]>=cnt[b]?a:b);
  }
  function humanDraw() {
    if (!gameActive || currentPlayerIndex !== 0 || waitingForColor) return;
    if (drawPile.length === 0) replenish();
    if (drawPile.length === 0) return;
    players[0].hand.push(drawPile.pop()); advance(); render();
    if (gameActive && players[currentPlayerIndex].isCPU) setTimeout(cpuPlay, 800);
  }
  function chooseColor(c) { if (waitingForColor && pendingWildIdx !== null) playCard(0, pendingWildIdx, c); }

  function cardSymbol(v) {
    if (v === 'skip') return '⊘';
    if (v === 'reverse') return '⇄';
    if (v === 'draw2') return '+2';
    if (v === 'wild') return '★';
    if (v === 'wild4') return '+4';
    return v;
  }
  function cssColor(c) { return ({red:'#E53935',blue:'#1E88E5',green:'#43A047',yellow:'#FDD835'})[c] || '#666'; }
  function buildCardElement(card, opts={}) {
    const { faceDown=false, small=false, clickable=false } = opts;
    const div = document.createElement('div');
    div.className = `uno-card ${faceDown?'back':card.color}${small?' small':''}`;
    if (faceDown) { div.innerHTML = `<div class="uno-back-logo">UNO</div>`; return div; }
    const sym = cardSymbol(card.value);
    div.innerHTML = `
      <div class="uno-corner top-left">${sym}</div>
      <div class="uno-oval"><span class="uno-center-value">${sym}</span></div>
      <div class="uno-corner bottom-right">${sym}</div>`;
    if (!clickable) div.classList.add('disabled');
    return div;
  }

  function render(message) {
    const top = discardPile[discardPile.length-1];
    const me = players[0]; const opp = players[1];
    const isMyTurn = currentPlayerIndex === 0 && gameActive && !waitingForColor;
    container.innerHTML = `
      <div class="uno-turn-banner ${isMyTurn?'my-turn':''}">${
        message || (isMyTurn ? `🎯 Your turn (${me.name})` : `Now it's ${players[currentPlayerIndex]?.name}'s turn`)
      }</div>
      <div class="uno-table">
        <div class="uno-opponent">
          <div class="uno-name-tag ${currentPlayerIndex===1?'active':''}">
            <span class="uno-avatar">🤖</span>
            <span>${opp.name}</span>
            <span class="uno-card-count">${opp.hand.length}</span>
            ${opp.hand.length===1?'<span class="uno-call">UNO!</span>':''}
          </div>
          <div class="uno-opponent-hand" id="uno-opp-hand"></div>
        </div>
        <div class="uno-middle">
          <div class="uno-pile">
            <div class="uno-pile-label">DRAW</div>
            <div class="uno-deck">${drawPile.length>0?'<div class="uno-card back small"><div class="uno-back-logo">UNO</div></div>':''}</div>
            <div class="uno-pile-count">${drawPile.length}</div>
          </div>
          <div class="uno-pile">
            <div class="uno-pile-label">DISCARD</div>
            <div class="uno-deck" id="uno-discard"></div>
            <div class="uno-color-indicator" style="background:${cssColor(currentColor)}"></div>
          </div>
        </div>
        <div class="uno-self">
          <div class="uno-name-tag self ${isMyTurn?'active':''}">
            <span class="uno-avatar">🧑</span>
            <span>${me.name}</span>
            <span class="uno-card-count">${me.hand.length}</span>
            ${me.hand.length===1?'<span class="uno-call">UNO!</span>':''}
          </div>
          <div class="uno-hand" id="uno-hand"></div>
          <div class="uno-actions">
            <button id="uno-draw-btn" class="btn-game btn-game-secondary" ${!isMyTurn?'disabled':''}>↓ Draw Card</button>
          </div>
        </div>
      </div>
      ${waitingForColor?`
        <div class="uno-color-modal">
          <div class="uno-color-modal-inner">
            <h3>Choose a color</h3>
            <div class="uno-color-choices">
              <button class="uno-color-pick red" data-color="red">Red</button>
              <button class="uno-color-pick blue" data-color="blue">Blue</button>
              <button class="uno-color-pick green" data-color="green">Green</button>
              <button class="uno-color-pick yellow" data-color="yellow">Yellow</button>
            </div>
          </div>
        </div>`:''}
    `;
    const discardEl = document.getElementById('uno-discard');
    if (discardEl && top) discardEl.appendChild(buildCardElement(top));
    const oppEl = document.getElementById('uno-opp-hand');
    if (oppEl) for (let i=0;i<Math.min(opp.hand.length,12);i++) oppEl.appendChild(buildCardElement({},{faceDown:true,small:true}));
    const handEl = document.getElementById('uno-hand');
    if (handEl) {
      players[0].hand.forEach((card, idx) => {
        const playable = isMyTurn && canPlay(card);
        const el = buildCardElement(card, { clickable: playable });
        if (playable) { el.classList.add('playable'); el.addEventListener('click', () => playCard(0, idx)); }
        handEl.appendChild(el);
      });
    }
    document.getElementById('uno-draw-btn')?.addEventListener('click', humanDraw);
    document.querySelectorAll('.uno-color-pick').forEach(btn => btn.addEventListener('click', () => chooseColor(btn.dataset.color)));
  }

  startGame();
  return { handleRemoteAction: () => {} };
}
