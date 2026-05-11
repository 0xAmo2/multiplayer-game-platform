function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }
  
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function playVictorySound() {
    try {
      const audio = new Audio('/sounds/victory.wav');
      audio.volume = 0.7;
      audio.play().catch(() => {});
    } catch (e) { /* ignore */ }
  }
