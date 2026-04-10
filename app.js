/* ============================================================
   CORTISOL — Competitive Daily Quiz App
   Vanilla JS — No frameworks, no build step
   ============================================================ */

// ==================== CONFIG ====================
const CONFIG = {
  GITHUB_OWNER: 'dylanmichot',
  GITHUB_REPO: 'cortisol',
  GITHUB_TOKEN: localStorage.getItem('cortisol-gh-token') || '',
  SCORES_PATH: 'scores.json',
  PLAYERS: [
    'Didou la Déglingue',
    'Big Nono',
    'Raphou du Bus'
  ],
  DECK_REGISTRY: [
    { id: 'capitals', file: 'decks/capitals.json' }
  ]
};

// ==================== STATE ====================
const state = {
  player: null,
  decks: [],
  scores: { sessions: [] },
  scoresSha: null,
  currentDeck: null,
  currentQuestions: [],
  currentIndex: 0,
  currentCorrect: 0,
  quizTotal: 0,
  drawNumber: 0,
  isFlipped: false,
  timerStart: null,
  timerInterval: null,
  timerSeconds: 0,
  saving: false
};

// ==================== SEEDED RNG ====================
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getSeededQuestions(deck, drawNumber, count) {
  const today = new Date().toISOString().slice(0, 10);
  const seed = hashString(today + '|' + deck.id + '|' + drawNumber);
  const rng = mulberry32(seed);
  const cards = [...deck.cards];
  // Fisher-Yates shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards.slice(0, count);
}

// ==================== DATE HELPERS ====================
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ==================== GITHUB API ====================
async function fetchScores() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${CONFIG.SCORES_PATH}`,
      { headers: { Authorization: 'token ' + CONFIG.GITHUB_TOKEN, Accept: 'application/vnd.github.v3+json' } }
    );
    if (res.status === 404) {
      state.scores = { sessions: [] };
      state.scoresSha = null;
      return;
    }
    if (!res.ok) throw new Error('GitHub GET ' + res.status);
    const data = await res.json();
    state.scoresSha = data.sha;
    state.scores = JSON.parse(atob(data.content));
  } catch (e) {
    console.error('fetchScores error:', e);
    state.scores = { sessions: [] };
    state.scoresSha = null;
  }
}

async function saveSession(session) {
  if (state.saving) return;
  state.saving = true;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Re-fetch to get latest SHA
      if (attempt > 0) await fetchScores();
      state.scores.sessions.push(session);
      const body = {
        message: `score: ${session.player} — ${session.deck} — ${session.score}/20`,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(state.scores, null, 2)))),
        sha: state.scoresSha || undefined
      };
      if (!body.sha) delete body.sha;
      const res = await fetch(
        `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${CONFIG.SCORES_PATH}`,
        {
          method: 'PUT',
          headers: {
            Authorization: 'token ' + CONFIG.GITHUB_TOKEN,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );
      if (res.ok) {
        const result = await res.json();
        state.scoresSha = result.content.sha;
        state.saving = false;
        return true;
      }
      if (res.status === 409) {
        // Conflict — remove the session we just pushed, retry
        state.scores.sessions.pop();
        continue;
      }
      throw new Error('GitHub PUT ' + res.status);
    } catch (e) {
      console.error('saveSession attempt ' + attempt + ':', e);
      // Undo the push if it was added
      const idx = state.scores.sessions.indexOf(session);
      if (idx > -1) state.scores.sessions.splice(idx, 1);
    }
  }
  state.saving = false;
  return false;
}

// ==================== DECK MANAGEMENT ====================
async function loadDecks() {
  const decks = [];
  for (const entry of CONFIG.DECK_REGISTRY) {
    try {
      const res = await fetch(entry.file);
      if (!res.ok) throw new Error(res.status);
      decks.push(await res.json());
    } catch (e) {
      console.error('Failed to load deck:', entry.id, e);
    }
  }
  state.decks = decks;
}

// ==================== SCORING ====================
function computeScore(correct, total) {
  return Math.round((correct / total) * 40) / 2; // nearest 0.5, out of 20
}

function getLetterGrade(score) {
  if (score >= 18) return 'S';
  if (score >= 16) return 'A';
  if (score >= 14) return 'B';
  if (score >= 12) return 'C';
  if (score >= 10) return 'D';
  if (score >= 8)  return 'E';
  return 'F';
}

function getGradeLabel(grade) {
  const labels = { S: 'Exceptionnel', A: 'Très bien', B: 'Bien', C: 'Assez bien', D: 'Passable', E: 'Insuffisant', F: 'Éliminatoire' };
  return labels[grade] || '';
}

// ==================== TRASH TALK ====================
const ROASTS = {
  S: [
    "Perfection. Tu fais presque peur.",
    "Rien à dire. C'est propre.",
    "T'as avalé le cours ou quoi ?",
    "Impeccable. Les autres peuvent trembler."
  ],
  A: [
    "Solide. Continue comme ça.",
    "Y'a du niveau. Presque suspect.",
    "Tes potes vont pleurer en voyant ça.",
    "T'as un avenir. Peut-être."
  ],
  B: [
    "Pas mal. Pas ouf non plus.",
    "Honorable. Ton prof serait presque fier.",
    "Tu passes du bon côté. De justesse pour la fierté.",
    "C'est bien. C'est pas fou, mais c'est bien."
  ],
  C: [
    "Moyen. Comme un mardi.",
    "C'est la moyenne. Pile. Bravo ?",
    "T'es dans le ventre mou. Confortable, hein.",
    "Ni chaud ni froid. Tiède, quoi."
  ],
  D: [
    "Ça passe... techniquement.",
    "10/20. Le strict minimum. Signature move ?",
    "T'as validé. Champagne ? Non.",
    "Juste assez pour pas avoir honte. Quoique."
  ],
  E: [
    "Faut qu'on parle.",
    "Sous la moyenne. Ça pique un peu.",
    "C'est le genre de note qu'on montre à personne.",
    "T'étais où pendant les cours ?"
  ],
  F: [
    "… On va dire que c'était un échauffement.",
    "Catastrophique. Mais au moins t'as essayé.",
    "Retourne bosser. Maintenant.",
    "T'as répondu au pif, avoue."
  ]
};

function getTrashTalk(score) {
  const grade = getLetterGrade(score);
  const pool = ROASTS[grade];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ==================== LEADERBOARD ====================
function getPlayerBestToday(sessions, player) {
  const today = todayStr();
  const todaySessions = sessions.filter(s => s.player === player && s.date === today);
  if (todaySessions.length === 0) return null;
  return Math.max(...todaySessions.map(s => s.score));
}

function getPlayerAverage(sessions, player) {
  const playerSessions = sessions.filter(s => s.player === player);
  if (playerSessions.length === 0) return null;
  const sum = playerSessions.reduce((acc, s) => acc + s.score, 0);
  return Math.round((sum / playerSessions.length) * 2) / 2;
}

function computeLeaderboard(sessions, mode) {
  const entries = CONFIG.PLAYERS.map(player => {
    const score = mode === 'daily'
      ? getPlayerBestToday(sessions, player)
      : getPlayerAverage(sessions, player);
    const count = mode === 'daily'
      ? sessions.filter(s => s.player === player && s.date === todayStr()).length
      : sessions.filter(s => s.player === player).length;
    return { player, score, count };
  });
  // Sort: players with scores first (desc), then players without
  entries.sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  });
  return entries;
}

function getRankTitle(position) {
  const titles = ['BIG BRAIN', 'HOMME TIÈDE', 'GROS NUL'];
  return titles[position] || '';
}

function getRankClass(position) {
  return 'rank-' + (position + 1);
}

// ==================== STREAKS ====================
function computeStreak(sessions, player) {
  const dates = [...new Set(sessions.filter(s => s.player === player).map(s => s.date))].sort().reverse();
  if (dates.length === 0) return 0;
  let streak = 0;
  const today = todayStr();
  const checkDate = new Date(today + 'T00:00:00');
  // If they haven't played today, start from yesterday
  if (dates[0] !== today) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  for (let i = 0; i < 365; i++) {
    const dateStr = checkDate.toISOString().slice(0, 10);
    if (dates.includes(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// ==================== DRAW NUMBER ====================
function getDrawNumber(sessions, player, deckId) {
  const today = todayStr();
  return sessions.filter(s => s.player === player && s.deck === deckId && s.date === today).length + 1;
}

// ==================== TIMER ====================
function startTimer() {
  state.timerStart = Date.now();
  state.timerSeconds = 0;
  const el = document.getElementById('quiz-timer');
  state.timerInterval = setInterval(() => {
    state.timerSeconds = Math.floor((Date.now() - state.timerStart) / 1000);
    el.textContent = formatTime(state.timerSeconds);
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.timerSeconds = Math.floor((Date.now() - state.timerStart) / 1000);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// ==================== UI HELPERS ====================
function $(id) { return document.getElementById(id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  window.scrollTo(0, 0);
}

function triggerShake() {
  const app = $('app');
  app.classList.add('shake');
  setTimeout(() => app.classList.remove('shake'), 400);
}

function animateScore(element, target, duration) {
  duration = duration || 1200;
  const start = performance.now();
  const step = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - (1 - progress) * (1 - progress); // ease-out quad
    const current = eased * target;
    element.textContent = current.toFixed(1).replace('.0', '');
    if (progress < 1) requestAnimationFrame(step);
    else element.textContent = target % 1 === 0 ? target.toString() : target.toFixed(1);
  };
  requestAnimationFrame(step);
}

// ==================== GREETINGS ====================
const GREETINGS = [
  (name) => `Salut <strong>${name}</strong>. Prêt à souffrir ?`,
  (name) => `Tiens, <strong>${name}</strong>. Tes potes t'attendent.`,
  (name) => `Ah, <strong>${name}</strong>. J'espère que t'as révisé.`,
  (name) => `<strong>${name}</strong>. Aujourd'hui c'est ton jour. Ou pas.`,
  (name) => `<strong>${name}</strong>. Montre-nous ce que t'as dans le crâne.`,
  (name) => `Re <strong>${name}</strong>. Toujours en vie ?`
];

// ==================== RENDER: PLAYER SELECT ====================
function renderPlayerSelect() {
  const container = $('player-buttons');
  container.innerHTML = '';
  CONFIG.PLAYERS.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'btn-player';
    btn.textContent = name;
    btn.addEventListener('click', () => selectPlayer(name));
    container.appendChild(btn);
  });
}

function selectPlayer(name) {
  state.player = name;
  localStorage.setItem('cortisol-player', name);
  renderHome();
  showScreen('screen-home');
}

// ==================== RENDER: HOME ====================
function renderHome() {
  // Greeting
  const greet = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  $('home-greeting').innerHTML = greet(state.player);

  // Streak
  const streak = computeStreak(state.scores.sessions, state.player);
  const streakEl = $('home-streak');
  if (streak > 0) {
    const flame = streak >= 7 ? '🔥🔥🔥' : streak >= 3 ? '🔥🔥' : '🔥';
    streakEl.textContent = flame + ' ' + streak + ' jour' + (streak > 1 ? 's' : '') + ' de suite';
  } else {
    streakEl.textContent = '';
  }

  // Leaderboard preview
  renderLeaderboardPreview();
}

function renderLeaderboardPreview() {
  const container = $('home-leaderboard-preview');
  const lb = computeLeaderboard(state.scores.sessions, 'daily');
  const hasScores = lb.some(e => e.score !== null);

  if (!hasScores) {
    container.innerHTML = `
      <h3>CLASSEMENT DU JOUR</h3>
      <div class="lb-empty">Personne n'a joué aujourd'hui.<br>Sois le premier.</div>
    `;
    return;
  }

  let html = '<h3>CLASSEMENT DU JOUR</h3>';
  lb.forEach((entry, i) => {
    const isMe = entry.player === state.player;
    const rankTitle = entry.score !== null ? getRankTitle(i) : '';
    const rankClass = entry.score !== null ? getRankClass(i) : '';
    html += `
      <div class="lb-row">
        <div class="lb-pos lb-pos-${i + 1}">${entry.score !== null ? (i + 1) : '-'}</div>
        <div class="lb-name ${isMe ? 'is-me' : ''}">${entry.player}</div>
        <div class="lb-score">${entry.score !== null ? entry.score + '/20' : '—'}</div>
        ${rankTitle ? `<span class="lb-rank-title ${rankClass}">${rankTitle}</span>` : ''}
      </div>
    `;
  });
  container.innerHTML = html;
}

// ==================== RENDER: DECK SELECT ====================
function renderDecks() {
  const list = $('deck-list');
  list.innerHTML = '';
  state.decks.forEach(deck => {
    const card = document.createElement('div');
    card.className = 'deck-card';
    card.innerHTML = `
      <div class="deck-icon">${deck.icon || '📚'}</div>
      <div class="deck-info">
        <div class="deck-name">${deck.name}</div>
        <div class="deck-desc">${deck.description}</div>
      </div>
      <div class="deck-count">${deck.cards.length} cartes</div>
    `;
    card.addEventListener('click', () => {
      state.currentDeck = deck;
      renderConfig();
      showScreen('screen-config');
    });
    list.appendChild(card);
  });
}

// ==================== RENDER: CONFIG ====================
function renderConfig() {
  const deck = state.currentDeck;
  $('config-deck-name').textContent = deck.icon + ' ' + deck.name;
  $('config-deck-desc').textContent = deck.description;

  state.drawNumber = getDrawNumber(state.scores.sessions, state.player, deck.id);
  $('config-draw-info').textContent = 'Tirage #' + state.drawNumber + ' du jour';
}

// ==================== QUIZ ENGINE ====================
function startQuiz(count) {
  const deck = state.currentDeck;
  const total = count === 'all' ? deck.cards.length : Math.min(parseInt(count), deck.cards.length);
  state.quizTotal = total;
  state.currentQuestions = getSeededQuestions(deck, state.drawNumber, total);
  state.currentIndex = 0;
  state.currentCorrect = 0;
  state.isFlipped = false;

  showScreen('screen-quiz');
  renderQuizCard();
  startTimer();
}

function renderQuizCard() {
  const q = state.currentQuestions[state.currentIndex];
  $('card-question').textContent = q.q;
  $('card-answer').textContent = q.a;
  $('quiz-counter').textContent = (state.currentIndex + 1) + ' / ' + state.quizTotal;
  $('quiz-progress-bar').style.width = ((state.currentIndex / state.quizTotal) * 100) + '%';

  // Reset card
  const card = $('quiz-card');
  card.classList.remove('flipped');
  state.isFlipped = false;
  $('quiz-actions').classList.add('hidden');

  // Show card hint
  const hint = card.querySelector('.card-hint');
  if (hint) hint.style.display = '';
}

function flipCard() {
  if (state.isFlipped) return;
  state.isFlipped = true;
  $('quiz-card').classList.add('flipped');
  $('quiz-actions').classList.remove('hidden');
  const hint = $('quiz-card').querySelector('.card-hint');
  if (hint) hint.style.display = 'none';
}

function markAnswer(correct) {
  if (!state.isFlipped) return;

  if (correct) {
    state.currentCorrect++;
    $('app').classList.add('flash-correct');
    setTimeout(() => $('app').classList.remove('flash-correct'), 300);
  } else {
    triggerShake();
    $('app').classList.add('flash-wrong');
    setTimeout(() => $('app').classList.remove('flash-wrong'), 300);
  }

  state.currentIndex++;
  if (state.currentIndex >= state.quizTotal) {
    finishQuiz();
  } else {
    setTimeout(renderQuizCard, 250);
  }
}

async function finishQuiz() {
  stopTimer();

  const score = computeScore(state.currentCorrect, state.quizTotal);
  const grade = getLetterGrade(score);

  // Compute rank before saving
  const lbBefore = computeLeaderboard(state.scores.sessions, 'daily');
  const rankBefore = lbBefore.findIndex(e => e.player === state.player);

  // Build session object
  const session = {
    player: state.player,
    deck: state.currentDeck.id,
    date: todayStr(),
    draw: state.drawNumber,
    correct: state.currentCorrect,
    total: state.quizTotal,
    score: score,
    time: state.timerSeconds
  };

  // Render results
  renderResults(session, grade, rankBefore);
  showScreen('screen-results');

  // Save async
  const saved = await saveSession(session);
  if (!saved) {
    console.warn('Score non sauvegardé');
  }

  // Update rank after save
  const lbAfter = computeLeaderboard(state.scores.sessions, 'daily');
  const rankAfter = lbAfter.findIndex(e => e.player === state.player);
  renderRankChange(rankBefore, rankAfter, lbAfter);
}

// ==================== RENDER: RESULTS ====================
function renderResults(session, grade, rankBefore) {
  // Grade
  const gradeEl = $('results-grade');
  gradeEl.textContent = grade;
  gradeEl.className = 'results-grade grade-' + grade;

  // Score animation
  const scoreEl = $('results-score-num');
  scoreEl.textContent = '0';
  setTimeout(() => animateScore(scoreEl, session.score, 1200), 300);

  // Detail
  $('results-detail').textContent = session.correct + ' correct' + (session.correct > 1 ? 'es' : 'e') + ' sur ' + session.total + ' — ' + getGradeLabel(grade);

  // Time
  $('results-time').textContent = '⏱ ' + formatTime(session.time);

  // Roast
  $('results-roast').textContent = '« ' + getTrashTalk(session.score) + ' »';

  // Clear rank (will be filled after save)
  $('results-rank').innerHTML = '';
}

function renderRankChange(rankBefore, rankAfter, lb) {
  const container = $('results-rank');
  // Only show if player has a real rank and it changed
  if (rankAfter < 0 || lb[rankAfter].score === null) return;
  const title = getRankTitle(rankAfter);
  if (rankBefore < 0 || lb[rankBefore]?.score === null || rankAfter < rankBefore) {
    // Rank improved or first time
    container.innerHTML = `<div class="rank-change rank-up">↑ ${title}</div>`;
  } else if (rankAfter > rankBefore) {
    container.innerHTML = `<div class="rank-change rank-down">↓ ${title}</div>`;
  }
  // If same rank, show title anyway if it's interesting
  else if (rankAfter === 0) {
    container.innerHTML = `<div class="rank-change rank-up">${title}</div>`;
  }
}

// ==================== RENDER: LEADERBOARD ====================
function renderLeaderboard(mode) {
  const container = $('lb-content');
  const lb = computeLeaderboard(state.scores.sessions, mode);
  const hasScores = lb.some(e => e.score !== null);

  if (!hasScores) {
    container.innerHTML = `<div class="lb-empty">${mode === 'daily' ? "Personne n'a joué aujourd'hui." : "Aucune partie jouée."}<br>Lancez-vous !</div>`;
    return;
  }

  let html = '';
  lb.forEach((entry, i) => {
    const isMe = entry.player === state.player;
    const hasScore = entry.score !== null;
    const rankTitle = hasScore ? getRankTitle(i) : '';
    const rankClass = hasScore ? getRankClass(i) : '';
    const streak = computeStreak(state.scores.sessions, entry.player);
    const scoreLabel = hasScore
      ? (mode === 'daily' ? entry.score + '/20' : entry.score + '/20')
      : '—';
    const statsLabel = hasScore
      ? (mode === 'daily'
          ? entry.count + ' partie' + (entry.count > 1 ? 's' : '') + ' aujourd\'hui'
          : entry.count + ' partie' + (entry.count > 1 ? 's' : '') + ' au total')
      : 'Pas encore joué';

    html += `
      <div class="lb-player-card ${isMe ? 'is-me' : ''}">
        <div class="lb-pos lb-pos-${i + 1}">${hasScore ? (i + 1) : '-'}</div>
        <div class="lb-player-info">
          <div class="lb-player-name">
            ${entry.player}
            ${rankTitle ? `<span class="lb-rank-title ${rankClass}">${rankTitle}</span>` : ''}
          </div>
          <div class="lb-player-stats">
            ${statsLabel}
            ${streak > 0 ? ` · <span class="lb-streak">🔥 ${streak}j</span>` : ''}
          </div>
        </div>
        <div class="lb-player-score lb-pos-${i + 1}">${scoreLabel}</div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ==================== EVENT BINDINGS ====================
function bindEvents() {
  // Home
  $('btn-play').addEventListener('click', () => {
    renderDecks();
    showScreen('screen-decks');
  });
  $('btn-leaderboard').addEventListener('click', () => {
    renderLeaderboard('daily');
    showScreen('screen-leaderboard');
  });
  $('btn-change-player').addEventListener('click', () => {
    localStorage.removeItem('cortisol-player');
    state.player = null;
    showScreen('screen-select');
  });

  // Back buttons
  $('btn-back-decks').addEventListener('click', () => {
    renderHome();
    showScreen('screen-home');
  });
  $('btn-back-config').addEventListener('click', () => showScreen('screen-decks'));
  $('btn-back-lb').addEventListener('click', () => {
    renderHome();
    showScreen('screen-home');
  });

  // Config — question count
  document.querySelectorAll('.btn-option').forEach(btn => {
    btn.addEventListener('click', () => {
      startQuiz(btn.dataset.count);
    });
  });

  // Quiz — card flip
  $('card-container').addEventListener('click', flipCard);

  // Quiz — answer buttons
  $('btn-correct').addEventListener('click', (e) => { e.stopPropagation(); markAnswer(true); });
  $('btn-wrong').addEventListener('click', (e) => { e.stopPropagation(); markAnswer(false); });

  // Results
  $('btn-replay').addEventListener('click', () => {
    // Refresh draw number and replay same deck
    state.drawNumber = getDrawNumber(state.scores.sessions, state.player, state.currentDeck.id);
    renderConfig();
    showScreen('screen-config');
  });
  $('btn-home').addEventListener('click', () => {
    renderHome();
    showScreen('screen-home');
  });

  // Leaderboard tabs
  document.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderLeaderboard(tab.dataset.tab === 'alltime' ? 'alltime' : 'daily');
    });
  });

  // Keyboard support for quiz
  document.addEventListener('keydown', (e) => {
    if (!$('screen-quiz').classList.contains('active')) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (!state.isFlipped) flipCard();
    }
    if (state.isFlipped) {
      if (e.code === 'ArrowRight' || e.code === 'KeyJ') markAnswer(true);
      if (e.code === 'ArrowLeft' || e.code === 'KeyK') markAnswer(false);
    }
  });

  // Token setup
  $('btn-save-token').addEventListener('click', () => {
    const token = $('setup-token').value.trim();
    if (!token) return;
    localStorage.setItem('cortisol-gh-token', token);
    CONFIG.GITHUB_TOKEN = token;
    proceedAfterSetup();
  });
  $('btn-skip-token').addEventListener('click', () => {
    proceedAfterSetup();
  });
}

// ==================== INIT ====================
async function proceedAfterSetup() {
  const loading = $('loading-overlay');
  loading.classList.remove('hidden');
  loading.style.display = '';

  // Load decks and scores in parallel
  await Promise.all([loadDecks(), fetchScores()]);

  // Render player select
  renderPlayerSelect();

  // Check saved player
  const savedPlayer = localStorage.getItem('cortisol-player');
  if (savedPlayer && CONFIG.PLAYERS.includes(savedPlayer)) {
    state.player = savedPlayer;
    renderHome();
    showScreen('screen-home');
  } else {
    showScreen('screen-select');
  }

  // Hide loading
  loading.classList.add('hidden');
  setTimeout(() => loading.style.display = 'none', 500);
}

async function init() {
  const loading = $('loading-overlay');

  // Bind events first (always needed)
  bindEvents();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Check if token is configured
  if (!CONFIG.GITHUB_TOKEN) {
    loading.classList.add('hidden');
    setTimeout(() => loading.style.display = 'none', 500);
    showScreen('screen-setup');
    return;
  }

  // Token exists — proceed normally
  await proceedAfterSetup();
}

init();
