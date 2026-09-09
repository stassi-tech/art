const $ = (id) => document.getElementById(id);
const state = {
  questions: [],
  answers: [],
  index: 0,
  imageFiles: new Map(),
  selectedFieldKeys: ['artist', 'date', 'location', 'title'],
  mode: 'normal', // 'normal' | 'review'
  fullQuestions: [], // toutes les questions du fichier importé (pour revenir après une révision)
};

// --- Authentification et sauvegarde des scores (Firebase) ---
// ⚠️ Remplacez les valeurs ci-dessous par la configuration de VOTRE projet Firebase
// (Console Firebase → Paramètres du projet → Vos applications → configuration SDK).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCIc15-0fy_OziKdcOHAv-CYxOku9iFX94",
  authDomain: "quiz-art-7378d.firebaseapp.com",
  projectId: "quiz-art-7378d",
  storageBucket: "quiz-art-7378d.firebasestorage.app",
  messagingSenderId: "489975323244",
  appId: "1:489975323244:web:d7070100f3a0e63cec9649",
};
let auth = null;
let db = null;
let currentUser = null;
let accountMode = 'login'; // 'login' | 'register'
const firebaseReady = FIREBASE_CONFIG.apiKey !== "VOTRE_API_KEY" && typeof firebase !== 'undefined';
if (firebaseReady) {
  firebase.initializeApp(FIREBASE_CONFIG);
  auth = firebase.auth();
  db = firebase.firestore();
}

// La mémorisation (des choix comme des scores) est un service lié au compte : sans connexion,
// les cases correspondantes sont visibles mais désactivées, avec une info-bulle explicative.
function updateRememberCheckboxesAvailability() {
  const disabled = !currentUser;
  const title = disabled ? 'Connectez-vous pour mémoriser vos choix' : '';
  document.querySelectorAll('[id$="-extend-all"], [id$="-remember-session"]').forEach((el) => {
    el.disabled = disabled;
    el.closest('label').title = title;
  });
}
function updateAccountBar() {
  const statusEl = $('account-status');
  const loginBtn = $('account-login-button');
  const logoutBtn = $('account-logout-button');
  const pageBtn = $('account-page-button');
  updateRememberCheckboxesAvailability();
  if (!statusEl) return;
  if (!firebaseReady) {
    statusEl.textContent = "Comptes non configurés pour l'instant";
    loginBtn.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    pageBtn.classList.add('hidden');
    return;
  }
  if (currentUser) {
    statusEl.textContent = '';
    statusEl.classList.add('hidden');
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    pageBtn.classList.remove('hidden');
    pageBtn.innerHTML = `Mon compte<br><span class="account-slot-email">${escapeHtml(currentUser.email)}</span>`;
  } else {
    statusEl.textContent = 'Non connecté';
    statusEl.classList.remove('hidden');
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    pageBtn.classList.add('hidden');
    if (!$('account-panel')?.classList.contains('hidden')) showPanel('welcome'); // déconnecté pendant qu'on consultait « Mon compte »
  }
  // La page de résultats affiche « Voir mes résultats » / « Télécharger mon bilan » selon la connexion.
  $('view-my-results-button')?.classList.toggle('hidden', !firebaseReady || !currentUser);
  $('download-my-report-button')?.classList.toggle('hidden', !firebaseReady || !currentUser);
}

function setAccountMode(mode) {
  accountMode = mode;
  $('account-modal-title').textContent = mode === 'login' ? 'Se connecter' : 'Créer un compte';
  $('account-submit-button').textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
  $('account-toggle-mode').textContent = mode === 'login' ? 'Pas encore de compte ? Créez-en un' : 'Déjà un compte ? Connectez-vous';
  $('account-error').classList.add('hidden');
  $('account-notice').classList.add('hidden');
  $('account-forgot-row').classList.toggle('hidden', mode !== 'login'); // pas de sens en mode inscription
  $('account-password').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
}

if (firebaseReady) {
  $('account-login-button')?.addEventListener('click', () => { setAccountMode('login'); openModal('modal-account'); });
  $('account-logout-button')?.addEventListener('click', () => auth.signOut());
  $('account-toggle-mode')?.addEventListener('click', () => setAccountMode(accountMode === 'login' ? 'register' : 'login'));
  $('account-forgot-button')?.addEventListener('click', async () => {
    const email = $('account-email').value.trim();
    const errorEl = $('account-error'); const noticeEl = $('account-notice');
    errorEl.classList.add('hidden'); noticeEl.classList.add('hidden');
    if (!email) {
      errorEl.textContent = "Indiquez d'abord votre adresse e-mail dans le champ ci-dessus, puis recliquez sur « Mot de passe oublié ? ».";
      errorEl.classList.remove('hidden');
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      noticeEl.textContent = `Un e-mail de réinitialisation a été envoyé à ${email}. Vérifiez votre boîte de réception (et les spams).`;
      noticeEl.classList.remove('hidden');
    } catch (error) {
      errorEl.textContent = firebaseAuthErrorMessage(error);
      errorEl.classList.remove('hidden');
    }
  });
  $('account-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('account-email').value.trim();
    const password = $('account-password').value;
    const errorEl = $('account-error'); const noticeEl = $('account-notice');
    errorEl.classList.add('hidden'); noticeEl.classList.add('hidden');
    try {
      if (accountMode === 'login') await auth.signInWithEmailAndPassword(email, password);
      else await auth.createUserWithEmailAndPassword(email, password);
      $('account-form').reset();
      $('modal-account').classList.add('hidden');
    } catch (error) {
      errorEl.textContent = firebaseAuthErrorMessage(error);
      errorEl.classList.remove('hidden');
    }
  });
  auth.onAuthStateChanged((user) => { currentUser = user; updateAccountBar(); });
} else {
  updateAccountBar();
}

function firebaseAuthErrorMessage(error) {
  const map = {
    'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse e-mail.',
    'auth/invalid-email': 'Adresse e-mail invalide.',
    'auth/weak-password': 'Le mot de passe doit contenir au moins 6 caractères.',
    'auth/user-not-found': 'Aucun compte ne correspond à cette adresse e-mail.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
  };
  return map[error.code] || 'Une erreur est survenue. Réessayez.';
}

async function saveCurrentScore() {
  if (!firebaseReady || !currentUser) return;
  const statusEl = $('auto-save-status');
  const correct = totalCorrect();
  const possible = state.questions.length * activeFields().length;
  const percent = possible ? Math.round((correct / possible) * 100) : 0;
  const config = state.quizConfig || { label: 'Quiz' };
  // Détail par rubrique (Artiste / Titre / Date / Lieu), nécessaire pour le bilan téléchargeable.
  const perField = {};
  activeFields().forEach(({ key }) => { perField[key] = { correct: 0, possible: 0 }; });
  state.questions.forEach((question, index) => {
    const answer = state.answers[index];
    if (!answer?.checked) return;
    activeFields().forEach(({ key }) => {
      perField[key].possible += 1;
      if (isMatchAny(answer[key], question, key)) perField[key].correct += 1;
    });
  });
  try {
    await db.collection('users').doc(currentUser.uid).collection('scores').add({
      type: 'quiz',
      correct, possible, percent,
      questionCount: state.questions.length,
      quizLabel: config.label || 'Quiz',
      quizLevel: config.level || '',
      quizSignature: config.signature || config.label || 'quiz',
      quizArts: config.arts || [],
      quizCenturies: config.centuries || [],
      quizRubriques: config.rubriques || [],
      perField,
      timeSpent: quizTimer.stop(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    if (statusEl) { statusEl.textContent = 'Score enregistré automatiquement sur votre compte.'; statusEl.classList.remove('hidden'); }
  } catch (error) {
    if (statusEl) { statusEl.textContent = "Le score n'a pas pu être enregistré automatiquement."; statusEl.classList.remove('hidden'); }
  }
}

// --- Page « Mon compte » : historique complet, groupé par type de quiz, avec évolution ---
let accountScoreFilter = 'quiz'; // 'quiz' | 'entrainement' — bascule via les 2 boutons de la page compte
async function fetchScoreLevelGroups() {
  if (!firebaseReady || !currentUser) return null;
  const snapshot = await db.collection('users').doc(currentUser.uid).collection('scores')
    .orderBy('createdAt', 'asc').get(); // ordre chronologique croissant : pratique pour calculer l'évolution
  if (snapshot.empty) return new Map();
  const levelGroups = new Map(); // niveau -> liste des scores (docs Firestore)
  snapshot.docs.forEach((doc) => {
    const d = { id: doc.id, ...doc.data() };
    // Les scores enregistrés avant l'ajout du champ « type » sont considérés comme des quiz.
    const scoreType = d.type || 'quiz';
    if (scoreType !== accountScoreFilter) return;
    const level = d.quizLevel || 'Autre';
    if (!levelGroups.has(level)) levelGroups.set(level, []);
    levelGroups.get(level).push(d);
  });
  lastAccountLevelGroups = levelGroups; // conservé pour le téléchargement, sans refaire de requête
  return levelGroups;
}
async function loadAccountPage() {
  const groupsBox = $('account-page-groups');
  const emptyMsg = $('account-page-empty');
  const downloadButton = $('account-page-download-button');
  $('account-resume-exercise-button')?.classList.toggle('hidden', !returnToExercisePanel);
  if (!firebaseReady || !currentUser) return;
  groupsBox.innerHTML = '';
  emptyMsg.classList.add('hidden');
  downloadButton?.classList.add('hidden');
  try {
    const levelGroups = await fetchScoreLevelGroups();
    if (!levelGroups || !levelGroups.size) { emptyMsg.classList.remove('hidden'); return; }

    // Liste chronologique de tous les scores, tous niveaux confondus, une ligne par quiz.
    const allDocs = Array.from(levelGroups.values()).flat()
      .slice()
      .sort((a, b) => (a.createdAt?.toDate?.() || 0) - (b.createdAt?.toDate?.() || 0));

    // Évolution : comparée à la dernière valeur rencontrée pour un contenu identique (même
    // signature art + siècles + niveau + rubriques), en suivant l'ordre chronologique.
    const lastPercentBySignature = {};
    const rows = allDocs.map((entry) => {
      const dateLabel = entry.createdAt ? entry.createdAt.toDate().toLocaleDateString('fr-FR') : '';
      const levelNum = levelNumberOf(entry.quizLevel || '');
      const arts = (entry.quizArts || []).map((a) => (a === 'Peinture' ? 'Peint.' : a === 'Sculpture' ? 'Sculp.' : a));
      const centuriesText = (entry.quizCenturies || []).join(', ');
      const contentLabel = [arts.join(' + '), centuriesText].filter(Boolean).join(' ');
      const rubriquesText = (entry.quizRubriques || []).join(', ');
      const sig = entry.quizSignature || entry.quizLabel || 'quiz';
      let evolutionHtml = '';
      if (lastPercentBySignature[sig] !== undefined) {
        const diff = entry.percent - lastPercentBySignature[sig];
        evolutionHtml = diff > 0 ? `<span class="evolution-up">▲ +${diff} pts</span>`
          : diff < 0 ? `<span class="evolution-down">▼ ${diff} pts</span>`
          : `<span class="evolution-flat">= stable</span>`;
      }
      lastPercentBySignature[sig] = entry.percent;
      const timeLabel = entry.timeSpent ? `${Math.floor(entry.timeSpent / 60)}:${String(entry.timeSpent % 60).padStart(2, '0')}` : '—';
      return `<tr>
        <td>${escapeHtml(dateLabel)}</td>
        <td class="col-contenu">${escapeHtml(contentLabel)}</td>
        <td>${levelNum ? `Niveau ${levelNum}` : '—'}</td>
        <td class="rubriques-tested">${escapeHtml(rubriquesText)}</td>
        <td><strong>${entry.correct} / ${entry.possible} (${entry.percent} %)</strong></td>
        <td>${timeLabel}</td>
        <td>${evolutionHtml}</td>
        <td><button type="button" class="delete-score-button" data-doc-id="${entry.id}" title="Éliminer ce résultat" aria-label="Éliminer ce résultat">✕</button></td>
      </tr>`;
    });
    // Le plus récent en premier, plus naturel à lire.
    groupsBox.innerHTML = `<div class="account-table-scroll"><table class="account-table">
      <thead><tr><th>Date</th><th class="col-contenu">Contenu</th><th>Niveau</th><th>Rubriques</th><th>Score</th><th>Temps</th><th>Évolution</th><th></th></tr></thead>
      <tbody>${rows.slice().reverse().join('')}</tbody>
    </table></div>`;
    groupsBox.querySelectorAll('.delete-score-button').forEach((button) => {
      button.addEventListener('click', () => deleteScore(button.dataset.docId));
    });
    downloadButton?.classList.remove('hidden');
  } catch (error) {
    groupsBox.innerHTML = '';
    emptyMsg.textContent = "Impossible de charger l'historique pour le moment.";
    emptyMsg.classList.remove('hidden');
  }
}
let lastAccountLevelGroups = null;
const CENTURY_KEYS = ['14e', '15e', '16e', '17e', '18e', '19e', '20e'];
const ART_KEYS = ['peinture', 'sculpture'];
const RUBRIQUE_COLUMNS = [
  { label: 'Artiste', match: (r) => r.startsWith('Artiste') },
  { label: 'Titre', match: (r) => r.startsWith('Titre') },
  { label: 'Date', match: (r) => r.startsWith('Date') },
  { label: 'Lieu', match: (r) => r.startsWith('Lieu') },
];
function centuryKeyOf(label) { return String(label).trim().split(' ')[0]; } // "16e siècle" -> "16e"
function levelNumberOf(label) { const m = String(label).match(/Niveau (\d)/); return m ? m[1] : null; }
function centerAllCells(sheet) {
  // Centre horizontalement toutes les cellules remplies. Comme pour les couleurs, la version
  // gratuite de la bibliothèque Excel utilisée ici peut ignorer cette mise en forme selon le
  // logiciel qui ouvre le fichier ensuite — à vérifier après téléchargement.
  Object.keys(sheet).forEach((key) => {
    if (key.startsWith('!')) return;
    const cell = sheet[key];
    cell.s = { ...(cell.s || {}), alignment: { horizontal: 'center', vertical: 'center' } };
  });
}
function downloadAccountTable() {
  if (!lastAccountLevelGroups || !window.XLSX) return;
  const allDocs = Array.from(lastAccountLevelGroups.values()).flat()
    .slice()
    .sort((a, b) => (a.createdAt?.toDate?.() || 0) - (b.createdAt?.toDate?.() || 0));
  const workbook = XLSX.utils.book_new();

  // --- Feuille 1 : détail de chaque quiz joué, une ligne par date ---
  const header1 = ['DATE', 'ARTS', ...Array(13).fill(''), 'RUBRIQUES', '', '', '', 'NIVEAU', '', '', 'SCORE'];
  const header2 = ['', 'peinture', ...Array(6).fill(''), 'sculpture', ...Array(6).fill(''), 'Artiste', 'Titre', 'Date', 'Lieu', 1, 2, 3, ''];
  const header3 = ['', ...CENTURY_KEYS, ...CENTURY_KEYS, '', '', '', '', '', '', '', ''];
  const detailRows = allDocs.map((d) => {
    const dateLabel = d.createdAt ? d.createdAt.toDate().toLocaleDateString('fr-FR') : '';
    const arts = (d.quizArts || []).map((a) => a.toLowerCase());
    const centuries = (d.quizCenturies || []).map(centuryKeyOf);
    const rubriques = d.quizRubriques || [];
    const levelNum = levelNumberOf(d.quizLevel || '');
    const row = [dateLabel];
    ART_KEYS.forEach((art) => {
      CENTURY_KEYS.forEach((century) => {
        row.push(arts.includes(art) && centuries.includes(century) ? 'X' : '');
      });
    });
    RUBRIQUE_COLUMNS.forEach(({ match }) => {
      row.push(rubriques.some((r) => match(r)) ? 'X' : '');
    });
    [1, 2, 3].forEach((n) => row.push(levelNum === String(n) ? 'X' : ''));
    row.push(`${Math.round(d.percent || 0)}%`);
    return row;
  });
  const sheet1 = XLSX.utils.aoa_to_sheet([header1, header2, header3, ...detailRows]);
  sheet1['!merges'] = [
    { s: { r: 0, c: 1 }, e: { r: 0, c: 14 } }, // ARTS
    { s: { r: 0, c: 15 }, e: { r: 0, c: 18 } }, // RUBRIQUES
    { s: { r: 0, c: 19 }, e: { r: 0, c: 21 } }, // NIVEAU
    { s: { r: 1, c: 1 }, e: { r: 1, c: 7 } }, // peinture
    { s: { r: 1, c: 8 }, e: { r: 1, c: 14 } }, // sculpture
  ];
  sheet1['!cols'] = [{ wch: 12 }, ...Array(21).fill({ wch: 6 }), { wch: 9 }];
  centerAllCells(sheet1);
  XLSX.utils.book_append_sheet(workbook, sheet1, 'Détail');

  // --- Feuille 2 : bilan des moyennes par contenu (art x siècle), avec évolution ---
  function matchingDocs(art, century) {
    return allDocs.filter((d) => (d.quizArts || []).map((a) => a.toLowerCase()).includes(art)
      && (d.quizCenturies || []).map(centuryKeyOf).includes(century));
  }
  function trendArrow(values) {
    // Compare la dernière valeur à la moyenne des précédentes : ▲ progression, ▼ recul, = stable.
    if (values.length < 2) return '';
    const last = values[values.length - 1];
    const previousAvg = values.slice(0, -1).reduce((s, v) => s + v, 0) / (values.length - 1);
    if (last > previousAvg) return ' ▲';
    if (last < previousAvg) return ' ▼';
    return ' =';
  }
  function overallCell(art, century) {
    const docs = matchingDocs(art, century);
    if (!docs.length) return '';
    const values = docs.map((d) => d.percent || 0);
    const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
    return `${avg}%${trendArrow(values)}`;
  }
  function fieldCell(art, century, fieldKey) {
    const docs = matchingDocs(art, century).filter((d) => d.perField?.[fieldKey]?.possible);
    if (!docs.length) return '';
    const values = docs.map((d) => Math.round((d.perField[fieldKey].correct / d.perField[fieldKey].possible) * 100));
    const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
    return `${avg}%${trendArrow(values)}`;
  }
  const bHeader1 = ['BILAN DE RÉUSSITE (moyennes des scores)'];
  const bHeader2 = ['RUBRIQUES', 'peinture', '', '', '', '', '', '', 'sculpture', '', '', '', '', '', ''];
  const bHeader3 = ['', ...CENTURY_KEYS, ...CENTURY_KEYS];
  const overallRow = ['TOUTES RUBRIQUES'];
  ART_KEYS.forEach((art) => CENTURY_KEYS.forEach((century) => overallRow.push(overallCell(art, century))));
  const fieldRows = [
    { label: 'ARTISTE', key: 'artist' },
    { label: 'TITRE', key: 'title' },
    { label: 'DATE', key: 'date' },
    { label: 'LIEU', key: 'location' },
  ].map(({ label, key }) => {
    const row = [label];
    ART_KEYS.forEach((art) => CENTURY_KEYS.forEach((century) => row.push(fieldCell(art, century, key))));
    return row;
  });
  const sheet2 = XLSX.utils.aoa_to_sheet([bHeader1, bHeader2, bHeader3, overallRow, ...fieldRows]);
  sheet2['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 14 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 7 } },
    { s: { r: 1, c: 8 }, e: { r: 1, c: 14 } },
  ];
  sheet2['!cols'] = [{ wch: 16 }, ...Array(14).fill({ wch: 9 })];
  centerAllCells(sheet2);
  XLSX.utils.book_append_sheet(workbook, sheet2, 'Bilan');

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `mes-scores-quiz-art-${stamp}.xlsx`);
}
$('account-page-download-button')?.addEventListener('click', downloadAccountTable);
async function deleteScore(docId) {
  if (!firebaseReady || !currentUser || !docId) return;
  try {
    await db.collection('users').doc(currentUser.uid).collection('scores').doc(docId).delete();
    loadAccountPage();
  } catch (error) {
    alert('Impossible de supprimer ce résultat pour le moment.');
  }
}
$('account-page-button')?.addEventListener('click', () => { showPanel('profile'); initProfilePage(); });
$('profile-back-button')?.addEventListener('click', () => showPanel('welcome'));
// --- Bascule entre les 2 sections restantes (technique/champs), et accès direct aux scores ---
document.querySelectorAll('.profile-menu-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.id === 'profile-menu-scores') { showPanel('account'); loadAccountPage(); return; }
    document.querySelectorAll('.profile-menu-btn').forEach((b) => b.classList.toggle('inactive', b !== btn));
    ['profile-section-tech', 'profile-section-fields', 'profile-section-rubriques'].forEach((id) => {
      $(id)?.classList.toggle('hidden', id !== btn.dataset.target);
    });
  });
});

// --- Photo de profil (mémorisée localement, en base64) ---
function loadProfilePhoto() {
  const saved = localStorage.getItem('profilePhoto');
  if (saved) {
    $('profile-photo-preview').src = saved;
    $('profile-photo-preview').style.display = 'block';
    $('profile-photo-placeholder').style.display = 'none';
  }
}
$('profile-photo-input')?.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem('profilePhoto', reader.result);
    loadProfilePhoto();
  };
  reader.readAsDataURL(file);
});

// --- Réglages techniques (section 1), reliés aux mêmes préférences globales que l'icône ⚙ ---
function initProfilePage() {
  loadProfilePhoto();
  $('profile-email').textContent = currentUser?.email || '';
  $('profile-resume-exercise-button')?.classList.toggle('hidden', !returnToExercisePanel);
  const prefs = getGlobalPrefs();
  $('pf-show-timer').checked = prefs.showTimer;
  $('pf-enter-validate').checked = prefs.enterValidate;
  $('pf-show-explanations').checked = prefs.showExplanations;
  $('pf-audio').checked = prefs.audioOn;
  $('pf-handedness').value = document.body.classList.contains('lefty') ? 'left' : 'right';
  $('pf-advance').value = prefs.defaultAdvance;
  $('pf-delay').value = String(prefs.defaultDelay);
  $('pf-delay-row').style.display = prefs.defaultAdvance === 'auto' ? 'flex' : 'none';
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('fr'));
  $('pf-voice').innerHTML = voices.length
    ? voices.map((v) => `<option value="${escapeHtml(v.name)}" ${v.name === prefs.voiceName ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')
    : '<option value="">Voix par défaut du système</option>';
  let fieldDefaults = {};
  try { fieldDefaults = JSON.parse(localStorage.getItem('globalFieldDefaults') || '{}'); } catch (e) {}
  document.querySelectorAll('.pf-field-art').forEach((el) => { el.checked = (fieldDefaults.arts || []).includes(el.value); });
  document.querySelectorAll('.pf-field-century').forEach((el) => { el.checked = (fieldDefaults.centuries || []).includes(el.value); });
  document.querySelectorAll('.pf-field-zone').forEach((el) => { el.checked = (fieldDefaults.zones || []).includes(el.value); });
  let rubriqueDefaults = {};
  try { rubriqueDefaults = JSON.parse(localStorage.getItem('globalRubriqueDefaults') || '{}'); } catch (e) {}
  document.querySelectorAll('.pf-rubrique-field').forEach((el) => { el.checked = (rubriqueDefaults.rubriques || []).includes(el.value); });
  document.querySelectorAll('.pf-rubrique-level').forEach((el) => { el.checked = (rubriqueDefaults.levels || []).includes(el.value); });
  if (rubriqueDefaults.count) {
    if (rubriqueDefaults.count === 'max' || rubriqueDefaults.count === '5' || rubriqueDefaults.count === '10' || rubriqueDefaults.count === '20') {
      const el = document.querySelector(`input[name="pf-count"][value="${rubriqueDefaults.count}"]`);
      if (el) el.checked = true;
    } else {
      $('pf-count-custom').value = rubriqueDefaults.count;
      document.querySelector('input[name="pf-count"][value="custom"]').checked = true;
    }
  }
  renderExerciseOverrides();
}
// Liste, sous chaque tableau (champ / rubrique), les exercices pour lesquels une sélection
// spécifique a été mémorisée (via l'icône ✏️ sur leur bouton) — avec un bouton pour l'oublier.
function renderExerciseOverrides() {
  const artLabel = { peinture: 'Peinture', sculpture: 'Sculpture' };
  const rows = { fields: [], rubriques: [] };
  Object.entries(EXERCISE_INFO).forEach(([prefix, info]) => {
    let state;
    try { state = JSON.parse(localStorage.getItem(`lastSelection_${info.panel}`) || '{}'); } catch (e) { state = {}; }
    const checkedKeys = Object.keys(state).filter((k) => state[k]);
    if (!checkedKeys.length) return;
    const arts = checkedKeys.filter((k) => k.startsWith(`${prefix}-art-`)).map((k) => artLabel[k.replace(`${prefix}-art-`, '')]);
    const centuries = checkedKeys.filter((k) => k.startsWith(`${prefix}-century-`)).map((k) => k.replace(`${prefix}-century-`, ''));
    const zones = checkedKeys.filter((k) => k.startsWith(`${prefix}-zone-`)).map((k) => k.replace(`${prefix}-zone-`, ''));
    const levels = checkedKeys.filter((k) => k.startsWith(`${prefix}-level-`)).map((k) => k.replace(`${prefix}-level-`, ''));
    const fieldsList = checkedKeys.filter((k) => k.startsWith(`${prefix}-field-`)).map((k) => k.replace(`${prefix}-field-`, ''));
    if (arts.length || centuries.length || zones.length) {
      const summary = [arts.join('/'), centuries.length ? `${centuries.join('/')} siècle` : '', zones.length ? `en ${zones.join('/')}` : ''].filter(Boolean).join(', ');
      rows.fields.push({ prefix, name: info.name, summary, panel: info.panel });
    }
    if (levels.length || fieldsList.length) {
      const summary = [fieldsList.length ? fieldsList.join(', ') : '', levels.length ? `niveau ${levels.join('/')}` : ''].filter(Boolean).join(' — ');
      rows.rubriques.push({ prefix, name: info.name, summary, panel: info.panel });
    }
  });
  const renderList = (list) => list.length ? list.map((r) =>
    `<p class="hint" style="text-align:left;">Vous avez enregistré un choix différent pour <strong>${escapeHtml(r.name.toUpperCase())}</strong> : ${escapeHtml(r.summary)}
      <button type="button" class="secondary-button override-delete-btn" data-panel="${r.panel}" style="padding:2px 10px;margin-left:8px;">Supprimer</button></p>`
  ).join('') : '';
  $('pf-fields-overrides').innerHTML = renderList(rows.fields);
  $('pf-rubriques-overrides').innerHTML = renderList(rows.rubriques);
  document.querySelectorAll('.override-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.removeItem(`lastSelection_${btn.dataset.panel}`);
      renderExerciseOverrides();
      updateExerciseSummaries();
    });
  });
}
$('profile-resume-exercise-button')?.addEventListener('click', () => {
  if (!returnToExercisePanel) return;
  const panel = returnToExercisePanel;
  returnToExercisePanel = null;
  showPanel(panel);
  // Réapplique tout de suite les réglages qui peuvent avoir changé pendant qu'on était sur
  // « Mon compte » (voix déjà coupée par showPanel ; ici, la visibilité du chronomètre).
  const showTimer = getGlobalPrefs().showTimer;
  document.querySelectorAll('[id$="-timer"]').forEach((el) => { if (el.textContent.includes('⏱')) el.classList.toggle('hidden', !showTimer); });
});
$('pf-show-timer')?.addEventListener('change', () => setGlobalPref('showTimer', $('pf-show-timer').checked));
$('pf-enter-validate')?.addEventListener('change', () => setGlobalPref('enterValidate', $('pf-enter-validate').checked));
$('pf-show-explanations')?.addEventListener('change', () => setGlobalPref('showExplanations', $('pf-show-explanations').checked));
$('pf-audio')?.addEventListener('change', () => setGlobalPref('audioOn', $('pf-audio').checked));
$('pf-voice')?.addEventListener('change', () => setGlobalPref('voiceName', $('pf-voice').value));
$('pf-handedness')?.addEventListener('change', () => {
  const lefty = $('pf-handedness').value === 'left';
  localStorage.setItem('handedness', lefty ? 'lefty' : 'righty');
  applyHandedness(lefty);
});
$('pf-advance')?.addEventListener('change', () => {
  setGlobalPref('defaultAdvance', $('pf-advance').value);
  $('pf-delay-row').style.display = $('pf-advance').value === 'auto' ? 'flex' : 'none';
});
$('pf-delay')?.addEventListener('change', () => setGlobalPref('defaultDelay', Number($('pf-delay').value)));

// --- Choix de champ (art/siècle/zone) : si mémorisé, chaque bouton d'exercice démarre
// directement dessus, sans repasser par sa page de configuration. ---
$('pf-fields-apply')?.addEventListener('click', () => {
  const arts = [...document.querySelectorAll('.pf-field-art:checked')].map((el) => el.value);
  const centuries = [...document.querySelectorAll('.pf-field-century:checked')].map((el) => el.value);
  const zones = [...document.querySelectorAll('.pf-field-zone:checked')].map((el) => el.value);
  localStorage.setItem('globalFieldDefaults', JSON.stringify({ arts, centuries, zones, remember: true }));
  updateExerciseSummaries();
});
$('pf-fields-clear')?.addEventListener('click', () => {
  localStorage.removeItem('globalFieldDefaults');
  document.querySelectorAll('.pf-field-art, .pf-field-century, .pf-field-zone').forEach((el) => { el.checked = false; });
  updateExerciseSummaries();
});
// --- Choix de rubrique et de niveau : idem, sur ce qui est testé et le niveau. La mémorisation
// est désormais automatique dès qu'on clique « Appliquer » — plus besoin de case séparée. ---
$('pf-rubriques-apply')?.addEventListener('click', () => {
  const rubriques = [...document.querySelectorAll('.pf-rubrique-field:checked')].map((el) => el.value);
  const levels = [...document.querySelectorAll('.pf-rubrique-level:checked')].map((el) => el.value);
  let count = document.querySelector('input[name="pf-count"]:checked')?.value || '';
  if (count === 'custom') count = $('pf-count-custom').value?.trim() || '';
  localStorage.setItem('globalRubriqueDefaults', JSON.stringify({ rubriques, levels, count, remember: true }));
  updateExerciseSummaries();
});
$('pf-rubriques-clear')?.addEventListener('click', () => {
  localStorage.removeItem('globalRubriqueDefaults');
  document.querySelectorAll('.pf-rubrique-field, .pf-rubrique-level').forEach((el) => { el.checked = false; });
  updateExerciseSummaries();
});
$('account-scores-quiz-button')?.addEventListener('click', () => {
  accountScoreFilter = 'quiz';
  $('account-scores-quiz-button').classList.remove('inactive');
  $('account-scores-training-button').classList.add('inactive');
  loadAccountPage();
});
$('account-scores-training-button')?.addEventListener('click', () => {
  accountScoreFilter = 'entrainement';
  $('account-scores-training-button').classList.remove('inactive');
  $('account-scores-quiz-button').classList.add('inactive');
  loadAccountPage();
});
$('account-page-back-button')?.addEventListener('click', () => { returnToExercisePanel = null; showPanel('welcome'); });
$('account-resume-exercise-button')?.addEventListener('click', () => {
  if (returnToExercisePanel) showPanel(returnToExercisePanel);
});

const allFields = [
  { key: 'artist', label: 'Artiste', input: 'artist-input', checkbox: 'rubrique-artist' },
  { key: 'title', label: "Titre de l'œuvre", input: 'title-input', checkbox: 'rubrique-title' },
  { key: 'date', label: 'Date de création', input: 'date-input', checkbox: 'rubrique-date' },
  { key: 'location', label: 'Lieu de conservation', input: 'location-input', checkbox: 'rubrique-location' }
];
function activeFields() { return allFields.filter((field) => state.selectedFieldKeys.includes(field.key)); }

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceSupported = Boolean(SpeechRecognitionImpl);

// Micro simple et autonome pour un champ texte unique (Famille, Énigme) — même moteur que le
// micro du quiz, mais sans la logique de champ actif multiple : un bouton, un champ.
// Lit à voix haute l'objectif d'un exercice, affiché en texte sur sa page de configuration.
// ============================================================
// PARAMÈTRES GLOBAUX (voix, chronomètre, touche Entrée, mémorisation) — communs à tous les
// exercices d'entraînement, réglables depuis « Mon compte ».
// ============================================================
const DEFAULT_PREFS = { showTimer: true, enterValidate: true, rememberSelection: true, audioOn: true, voiceName: '', showExplanations: true, defaultAdvance: 'manual', defaultDelay: 5000 };
function getGlobalPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('globalExercisePrefs') || '{}') }; }
  catch (e) { return { ...DEFAULT_PREFS }; }
}
function setGlobalPref(key, value) {
  const prefs = getGlobalPrefs();
  prefs[key] = value;
  localStorage.setItem('globalExercisePrefs', JSON.stringify(prefs));
}
function getGlobalVoice() {
  if (!window.speechSynthesis) return null;
  const prefs = getGlobalPrefs();
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('fr'));
  return voices.find((v) => v.name === prefs.voiceName) || null;
}
function populateGlobalVoiceSelect() {
  const select = $('pref-voice');
  if (!select) return;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('fr'));
  const prefs = getGlobalPrefs();
  select.innerHTML = voices.length
    ? voices.map((v) => `<option value="${escapeHtml(v.name)}" ${v.name === prefs.voiceName ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')
    : '<option value="">Voix par défaut du système</option>';
}
speechSynthesis.onvoiceschanged = populateGlobalVoiceSelect;
$('settings-toggle')?.addEventListener('click', () => {
  $('settings-body')?.classList.toggle('hidden');
  populateGlobalVoiceSelect();
});

const EXERCISE_PLAY_PANELS = ['impregnation', 'intrus', 'reconstitution', 'vraifaux', 'famille', 'chrono', 'enigme', 'quiz'];
function currentActivePanelName() {
  return EXERCISE_PLAY_PANELS.find((name) => !$(`${name}-panel`)?.classList.contains('hidden'));
}
$('global-account-button')?.addEventListener('click', () => {
  // Sans compte, pas de mémorisation possible : on redirige vers la connexion plutôt que
  // d'ouvrir une page « Mon compte » dont les réglages ne pourraient de toute façon rien retenir.
  if (!currentUser) { showPanel('welcome'); $('account-login-button')?.scrollIntoView({ block: 'center' }); return; }
  // Si on est en plein exercice, on garde le fil pour pouvoir y revenir exactement là où on
  // était après avoir changé un réglage (la voix, par exemple) — sans relancer la question.
  const active = currentActivePanelName();
  if (active) returnToExercisePanel = active;
  showPanel('profile'); initProfilePage();
});


function speakObjective(elementId) {
  const el = $(`${elementId}-objective`);
  const showExplanations = getGlobalPrefs().showExplanations;
  // Le réglage global « Afficher les explications » masque le texte ET coupe la voix.
  el?.classList.toggle('hidden', !showExplanations);
  if (!showExplanations) return;
  // elementId est le préfixe (« imp », « vf »…) — la case « Ne plus entendre » est mémorisée sur
  // l'appareil, sur ce même préfixe, pour ne pas lasser à force de rejouer.
  const skipCheckbox = $(`${elementId}-opt-skip-objective`);
  if (skipCheckbox) {
    if (localStorage.getItem(`skipObjective_${elementId}`) === 'true') { skipCheckbox.checked = true; return; }
    skipCheckbox.addEventListener('change', () => {
      localStorage.setItem(`skipObjective_${elementId}`, skipCheckbox.checked ? 'true' : 'false');
    }, { once: true });
  }
  if (!window.speechSynthesis || !getGlobalPrefs().audioOn) return;
  if (!el) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(el.textContent);
  u.lang = 'fr-FR'; u.rate = 0.85;
  speechSynthesis.speak(u);
}

// Chronomètre partagé : affiche le temps écoulé en direct, renvoie la durée totale (en
// secondes) à l'arrêt, pour l'enregistrer avec le score.
// « Étendre à tous les exercices » : reporte le siècle/niveau choisis ici sur les 5 autres
// panneaux de configuration (mêmes cases à cocher, mêmes identifiants dans chaque exercice).
// « Mémoriser pour mes prochaines sessions » : propose une reprise en un clic au prochain
// passage par le menu des exercices d'entraînement (voir buildTrainingHubResume).
function handleExtendAndRemember(prefix, panelId) {
  // La mémorisation est un service lié au compte : sans connexion, on ignore ces cases (le choix
  // du jour s'applique quand même à la partie en cours, simplement rien n'est retenu ensuite).
  if (!currentUser) return;
  const extendAll = $(`${prefix}-extend-all`)?.checked;
  const remember = $(`${prefix}-remember-session`)?.checked;
  if (extendAll) {
    const arts = [...document.querySelectorAll(`#${panelId} [id^="${prefix}-art-"]:checked`)].map((el) => el.id.replace(`${prefix}-art-`, ''));
    const centuries = [...document.querySelectorAll(`#${panelId} [id^="${prefix}-century-"]:checked`)].map((el) => el.id.replace(`${prefix}-century-`, ''));
    const zones = [...document.querySelectorAll(`#${panelId} [id^="${prefix}-zone-"]:checked`)].map((el) => el.id.replace(`${prefix}-zone-`, ''));
    const levels = [...document.querySelectorAll(`#${panelId} [id^="${prefix}-level-"]:checked`)].map((el) => el.id.replace(`${prefix}-level-`, ''));
    localStorage.setItem('globalFieldDefaults', JSON.stringify({ arts, centuries, zones, remember: true }));
    localStorage.setItem('globalRubriqueDefaults', JSON.stringify({ rubriques: [], levels, remember: true }));
    const prefixes = ['imp', 'intrus', 'recon', 'vf', 'fam', 'enig'];
    prefixes.forEach((other) => {
      if (other === prefix) return;
      document.querySelectorAll(`[id^="${other}-art-"]`).forEach((el) => { if (arts.length) el.checked = arts.includes(el.id.replace(`${other}-art-`, '')); });
      document.querySelectorAll(`[id^="${other}-century-"]`).forEach((el) => { if (centuries.length) el.checked = centuries.includes(el.id.replace(`${other}-century-`, '')); });
      document.querySelectorAll(`[id^="${other}-zone-"]`).forEach((el) => { if (zones.length) el.checked = zones.includes(el.id.replace(`${other}-zone-`, '')); });
      document.querySelectorAll(`[id^="${other}-level-"]`).forEach((el) => { if (levels.length) el.checked = levels.includes(el.id.replace(`${other}-level-`, '')); });
    });
  }
  localStorage.setItem(`autoStart_${prefix}`, remember ? 'true' : 'false');
  updateExerciseSummaries();
}

function applyDefaultAdvance(checkboxId, delayId, delayRowId) {
  const p = getGlobalPrefs();
  const checkbox = $(checkboxId);
  if (!checkbox) return;
  checkbox.checked = p.defaultAdvance === 'auto';
  if ($(delayId)) $(delayId).value = String(p.defaultDelay);
  if ($(delayRowId)) $(delayRowId).style.display = checkbox.checked ? 'flex' : 'none';
}

function createTimer(labelElementId) {
  let startTime = null, interval = null;
  function tick() {
    const el = $(labelElementId);
    if (!el || !startTime) return;
    const s = Math.floor((Date.now() - startTime) / 1000);
    el.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  return {
    start() {
      startTime = Date.now();
      $(labelElementId)?.classList.toggle('hidden', !getGlobalPrefs().showTimer);
      if (interval) clearInterval(interval);
      interval = setInterval(tick, 1000);
      tick();
    },
    stop() { if (interval) clearInterval(interval); interval = null; return startTime ? Math.round((Date.now() - startTime) / 1000) : 0; },
  };
}
const quizTimer = createTimer('quiz-timer');

// Mémorise et restaure la dernière sélection de cases à cocher d'un jeu (art/siècle/niveau/zone…)
// sur l'appareil, pour éviter de tout recocher à chaque partie. On cible toutes les cases du
// panneau de configuration plutôt qu'une liste figée d'identifiants, plus robuste aux évolutions.
let suppressSaveLastSelection = false;
function saveLastSelection(panelId) {
  if (!getGlobalPrefs().rememberSelection) return;
  // Quand le démarrage automatique vient d'appliquer le choix général (Mon compte) à cet
  // exercice, on n'enregistre pas cet état comme s'il s'agissait d'un choix propre au jeu —
  // sinon ça écraserait silencieusement toute personnalisation faite via l'icône ✏️ à chaque
  // clic sur le bouton principal.
  if (suppressSaveLastSelection) { suppressSaveLastSelection = false; return; }
  const state = {};
  $(panelId)?.querySelectorAll('input[type="checkbox"]').forEach((el) => { state[el.id] = el.checked; });
  localStorage.setItem(`lastSelection_${panelId}`, JSON.stringify(state));
}
function restoreLastSelection(panelId) {
  if (!getGlobalPrefs().rememberSelection) return;
  let state;
  try { state = JSON.parse(localStorage.getItem(`lastSelection_${panelId}`) || '{}'); } catch (e) { return; }
  $(panelId)?.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    if (state[el.id] !== undefined && !el.id.includes('opt-') && !el.id.includes('skip-objective')) el.checked = state[el.id];
  });
}

function attachSimpleMic(button, input) {
  if (!voiceSupported || !button || !input) { button?.classList.add('hidden'); return; }
  button.classList.remove('hidden');
  let recognition = null, listening = false, manualStop = false;
  button.addEventListener('click', () => {
    if (listening) { manualStop = true; try { recognition.abort(); } catch (e) {} return; }
    manualStop = false;
    try { recognition = new SpeechRecognitionImpl(); } catch (e) { return; }
    // Même réglage que le micro du quiz : continu, avec redémarrage automatique si le
    // navigateur referme la session après un silence, pour une dictée plus fiable.
    recognition.lang = 'fr-FR'; recognition.continuous = true; recognition.interimResults = false; recognition.maxAlternatives = 1;
    button.classList.add('listening'); listening = true;
    const thisRecognition = recognition;
    recognition.addEventListener('result', (event) => {
      const last = event.results[event.results.length - 1];
      input.value = last[0].transcript.trim();
    });
    recognition.addEventListener('end', () => {
      if (manualStop || recognition !== thisRecognition) { button.classList.remove('listening'); listening = false; return; }
      try { thisRecognition.start(); } catch (e) { button.classList.remove('listening'); listening = false; recognition = null; }
    });
    recognition.addEventListener('error', (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return; // redémarrage géré par 'end'
      manualStop = true;
      button.classList.remove('listening'); listening = false; recognition = null;
    });
    try { recognition.start(); } catch (e) { button.classList.remove('listening'); listening = false; }
  });
}

if (voiceSupported) {
  $('mic-global').classList.remove('hidden');
  if (localStorage.getItem('micTooltipDismissed') !== 'true') $('mic-tooltip')?.classList.remove('hidden');
}
$('mic-tooltip-close')?.addEventListener('click', () => {
  if ($('mic-tooltip-dismiss')?.checked) localStorage.setItem('micTooltipDismissed', 'true');
  $('mic-tooltip')?.classList.add('hidden');
});
// Un seul bouton micro sert les 4 rubriques : il dicte dans le champ actuellement sélectionné
// (touché/cliqué), et suit automatiquement le focus si on passe à un autre champ pendant l'écoute.
// La dictée reste active en continu, d'une question à l'autre, tant qu'on ne tape rien manuellement.
let activeRecognition = null;
let micIsListening = false;
let manualStopRequested = false;
let focusedFieldKey = null;
function updateFieldHighlight() {
  document.querySelectorAll('.field-label-button').forEach((button) => {
    button.classList.toggle('field-target-active', button.dataset.field === focusedFieldKey);
  });
}
function setFocusedField(key, { focusInput = false, scroll = true } = {}) {
  focusedFieldKey = key;
  updateFieldHighlight();
  const field = allFields.find((f) => f.key === key);
  if (!field) return;
  if (focusInput) $(field.input).focus(); // ouvre le clavier sur mobile : uniquement pour une saisie volontaire
  if (scroll) $(field.input).scrollIntoView({ behavior: 'smooth', block: 'center' }); // la page suit le champ actif
}
function currentDictationTarget() {
  const key = (focusedFieldKey && state.selectedFieldKeys.includes(focusedFieldKey)) ? focusedFieldKey : activeFields()[0]?.key;
  return key ? allFields.find((field) => field.key === key) : null;
}
function resetMicButton() {
  const button = $('mic-global');
  if (!button) return;
  button.classList.remove('listening');
  button.textContent = '🎤';
  micIsListening = false;
}
function stopActiveDictation() {
  manualStopRequested = true;
  if (activeRecognition) { try { activeRecognition.abort(); } catch (error) { /* déjà arrêté */ } }
  resetMicButton();
  activeRecognition = null;
}
function startDictation() {
  if (micIsListening) { stopActiveDictation(); return; } // recliquer arrête la dictée
  stopActiveDictation();
  manualStopRequested = false;
  let recognition;
  try {
    recognition = new SpeechRecognitionImpl();
  } catch (error) {
    alert("La dictée vocale n'a pas pu démarrer sur ce navigateur.");
    return;
  }
  recognition.lang = 'fr-FR';
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  const button = $('mic-global');
  button.classList.add('listening'); button.textContent = '🎤'; micIsListening = true;
  activeRecognition = recognition;
  const forget = () => { resetMicButton(); if (activeRecognition === recognition) activeRecognition = null; };
  recognition.addEventListener('result', (event) => {
    // Pas de focus() ici : sur smartphone, focus() ouvre le clavier virtuel automatiquement.
    const target = currentDictationTarget();
    if (!target) return;
    const last = event.results[event.results.length - 1];
    $(target.input).value = last[0].transcript.trim();
    // Plus d'avancement automatique vers le champ suivant après la dictée (cf. plus bas) : on
    // reste sur le champ dicté, la personne clique elle-même sur la rubrique suivante.
  });
  recognition.addEventListener('end', () => {
    if (manualStopRequested || activeRecognition !== recognition) return;
    // Certains navigateurs referment la session après un silence ou au bout d'un moment :
    // on la relance automatiquement pour que la dictée reste active « sur plusieurs pages ».
    try { recognition.start(); } catch (error) { forget(); }
  });
  recognition.addEventListener('error', (event) => {
    if (event.error === 'aborted' || event.error === 'no-speech') return; // le redémarrage est géré par 'end'
    manualStopRequested = true;
    forget();
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      alert("Le micro n'est pas autorisé pour ce site. Vérifiez les permissions du navigateur.");
    } else {
      alert("La dictée vocale a rencontré un problème et s'est arrêtée. Réessayez.");
    }
  });
  try {
    recognition.start();
  } catch (error) {
    manualStopRequested = true;
    forget();
    alert("Impossible de démarrer le micro. Réessayez.");
  }
}
if (voiceSupported) {
  $('mic-global').addEventListener('click', startDictation);
  allFields.forEach(({ key, input }) => {
    $(input).addEventListener('focus', () => setFocusedField(key));
  });
}
// Ancien passage automatique au champ suivant retiré (cf. ci-dessous) : la personne clique
// elle-même sur la rubrique suivante avant de dicter ou taper, à son propre rythme.
allFields.forEach(({ key, input }) => {
  $(input).addEventListener('input', () => {
    if (micIsListening) stopActiveDictation(); // taper manuellement arrête la dictée continue
    // Plus d'avancement automatique vers le champ suivant : plusieurs testeurs trouvaient le
    // défilement de page involontaire pendant la dictée anxiogène. On clique désormais soi-même
    // sur la rubrique suivante avant de parler, à son propre rythme.
  });
});

function keyName(value) {
  return String(value || '').trim().toLocaleLowerCase('fr-FR').replace(/œ/g, 'oe').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function findColumn(row, names) {
  const keys = Object.keys(row);
  return keys.find((column) => names.includes(keyName(column)));
}
function normaliseRows(rows) {
  return rows.map((row, rowIndex) => {
    const imageKey = findColumn(row, ['image', 'url image', 'image url', 'lien image', 'visuel']);
    if (!imageKey) throw new Error("La colonne « image » est introuvable dans ce fichier.");

    // --- Identité de l'artiste : nouvelle structure (Prénom/Patronyme/Surnom) si présente,
    // sinon on retombe sur l'ancienne colonne unique « Artiste » pour rester compatible avec
    // d'anciens fichiers pas encore convertis.
    const prenomKey = findColumn(row, ['prenom']);
    const patronymeKey = findColumn(row, ['patronyme']);
    const surnomFrKey = findColumn(row, ['surnom francais', 'surnom']);
    const surnomOrigKey = findColumn(row, ["surnom langue d origine", 'surnom original', 'surnom origine']);
    const prenom = prenomKey ? String(row[prenomKey] || '').trim() : '';
    const patronyme = patronymeKey ? String(row[patronymeKey] || '').trim() : '';
    const surnomFr = surnomFrKey ? String(row[surnomFrKey] || '').trim() : '';
    const surnomOrig = surnomOrigKey ? String(row[surnomOrigKey] || '').trim() : '';
    let artist;
    if (prenomKey || patronymeKey || surnomFrKey) {
      artist = [prenom, patronyme].filter(Boolean).join(' ') || surnomFr;
    } else {
      const legacyArtistKey = findColumn(row, ['artiste', 'nom artiste', 'artist', 'auteur']);
      if (!legacyArtistKey) throw new Error("Ni « Prénom/Patronyme », ni « Artiste » n'ont été trouvés dans ce fichier.");
      artist = String(row[legacyArtistKey] || '').trim();
    }

    // --- Dates de naissance/mort : nouvelle structure à deux colonnes si présente, sinon ancienne
    // colonne combinée « dates artiste ». Règle : si l'une des deux dates manque, on n'affiche
    // rien plutôt qu'une date incomplète.
    const naissanceKey = findColumn(row, ['date de naissance', 'naissance']);
    const mortKey = findColumn(row, ['date de mort', 'mort', 'deces', 'décès']);
    let artistDates = '';
    if (naissanceKey || mortKey) {
      const naissance = naissanceKey ? String(row[naissanceKey] || '').trim() : '';
      const mort = mortKey ? String(row[mortKey] || '').trim() : '';
      if (naissance && mort) artistDates = `${naissance}-${mort}`;
    } else {
      const legacyDatesKey = findColumn(row, ['dates artiste', 'dates', 'naissance mort', 'nee morte', 'ne mort', 'annees artiste']);
      artistDates = legacyDatesKey ? String(row[legacyDatesKey] || '').trim() : '';
    }

    const dateKey = findColumn(row, ['date de creation', 'date creation', 'date', 'annee', 'année']);
    if (!dateKey) throw new Error("La colonne « date de création » est introuvable dans ce fichier.");

    // --- Lieu : nouvelle structure Ville/Lieu précis/Sous-lieu si présente, sinon ancienne
    // colonne unique « lieu de conservation ». Affichage : Sous-lieu, Lieu précis, Ville.
    const villeKey = findColumn(row, ['ville']);
    const lieuPrecisKey = findColumn(row, ['lieu precis']);
    const sousLieuKey = findColumn(row, ['sous lieu']);
    let location;
    if (villeKey || lieuPrecisKey) {
      const ville = villeKey ? String(row[villeKey] || '').trim() : '';
      const lieuPrecis = lieuPrecisKey ? String(row[lieuPrecisKey] || '').trim() : '';
      const sousLieu = sousLieuKey ? String(row[sousLieuKey] || '').trim() : '';
      location = [sousLieu, lieuPrecis, ville].filter(Boolean).join(', ');
    } else {
      const legacyLocationKey = findColumn(row, ['lieu de conservation', 'lieu', 'conservation', 'musee', 'musée', 'location']);
      if (!legacyLocationKey) throw new Error("Ni « Ville/Lieu précis », ni « Lieu de conservation » n'ont été trouvés dans ce fichier.");
      location = String(row[legacyLocationKey] || '').trim();
    }

    // --- Titre : nouvelle structure Titre (français) + Cycle + Titre (langue d'origine), sinon
    // ancienne colonne unique « titre de l'œuvre ». Les guillemets déjà présents dans le fichier
    // (convention d'affichage du tableau) sont retirés ici : l'appli les rajoute elle-même.
    const stripQuotes = (s) => String(s || '').trim().replace(/^["«]\s*/, '').replace(/\s*["»]$/, '');
    const titreFrKey = findColumn(row, ['titre francais']);
    const cycleKey = findColumn(row, ['cycle']);
    const titreOrigKey = findColumn(row, ["titre langue d origine", 'titre original', 'titre origine']);
    let title, cycle = '', titleOriginal = '';
    if (titreFrKey) {
      title = stripQuotes(row[titreFrKey]);
      cycle = cycleKey ? stripQuotes(row[cycleKey]) : '';
      titleOriginal = titreOrigKey ? stripQuotes(row[titreOrigKey]) : '';
    } else {
      const legacyTitleKey = findColumn(row, ["titre de l oeuvre", 'titre oeuvre', 'titre', 'title', 'œuvre', 'oeuvre']);
      if (!legacyTitleKey) throw new Error("Ni « Titre (français) », ni « Titre de l'œuvre » n'ont été trouvés dans ce fichier.");
      title = stripQuotes(row[legacyTitleKey]);
    }

    const materialsKey = findColumn(row, ['materiaux et technique', 'materiaux', 'technique', 'materials', 'materiau']);
    const materials = materialsKey ? String(row[materialsKey] || '').trim() : '';
    const natureKey = findColumn(row, ['nature de l objet', 'nature objet', 'nature']);
    const nature = natureKey ? String(row[natureKey] || '').trim() : '';
    // Phrase combinée pour le texte et la voix : « Monument funéraire en marbre » plutôt que
    // « sculpture » ou le matériau seul — se rabat sur ce qui est disponible si l'un manque.
    const materialsPhrase = nature && materials ? `${nature} en ${materials.charAt(0).toLowerCase()}${materials.slice(1)}` : (nature || materials);

    // --- Dimensions : nouvelle structure Hauteur/Longueur/Profondeur si présente, sinon ancienne
    // colonne unique « dimensions » (repliée dans hauteur/longueur via une expression régulière).
    const hauteurKey = findColumn(row, ['hauteur']);
    const longueurKey = findColumn(row, ['longueur']);
    const profondeurKey = findColumn(row, ['profondeur']);
    let hauteur = '', longueur = '', profondeur = '';
    if (hauteurKey || longueurKey || profondeurKey) {
      hauteur = hauteurKey ? String(row[hauteurKey] || '').trim() : '';
      longueur = longueurKey ? String(row[longueurKey] || '').trim() : '';
      profondeur = profondeurKey ? String(row[profondeurKey] || '').trim() : '';
    } else {
      const legacyDimensionsKey = findColumn(row, ['dimensions', 'taille', 'format', 'dimension']);
      const legacyDims = legacyDimensionsKey ? String(row[legacyDimensionsKey] || '').trim() : '';
      const match = legacyDims.match(/^(?:environ |c\.)?([\d.,]+)\s*(?:×|x|X)\s*([\d.,]+)\s*(cm|m)?/);
      if (match) {
        const approx = /environ|^c\./.test(legacyDims) ? 'c.' : '';
        const unit = match[3] || 'cm';
        hauteur = `${approx}${match[1]} ${unit}`;
        longueur = `${approx}${match[2]} ${unit}`;
      }
    }

    const nationalityKey = findColumn(row, ['nationalite', 'nationalite artiste', 'pays', 'nationality']);
    const nationality = nationalityKey ? String(row[nationalityKey] || '').trim() : '';
    const niveauKey = findColumn(row, ['niveau']);
    const niveau = niveauKey ? (parseInt(row[niveauKey], 10) || 1) : 1;

    return {
      image: String(row[imageKey] || '').trim(), artist, prenom, patronyme, surnomFr, surnomOrig,
      date: String(row[dateKey] || '').trim(), location, title, cycle, titleOriginal,
      artistDates, materials, nature, materialsPhrase, hauteur, longueur, profondeur, nationality, niveau,
      row: rowIndex + 2
    };
  }).filter((question) => question.image || question.artist || question.date || question.location || question.title);
}
// Colonne optionnelle (I) : nationalité de l'artiste -> petit drapeau affiché à côté des dates sur
// la fiche de correction. Volontairement large (variantes de genre, gentilés, anciens pays) : mieux
// vaut couvrir large qu'afficher un drapeau manquant pour une variante orthographique.
const NATIONALITY_FLAGS = {
  "francaise": "🇫🇷", "francais": "🇫🇷", "france": "🇫🇷",
  "italienne": "🇮🇹", "italien": "🇮🇹", "italie": "🇮🇹",
  "espagnole": "🇪🇸", "espagnol": "🇪🇸", "espagne": "🇪🇸",
  "catalane": "🇪🇸", "catalan": "🇪🇸",
  "flamande": "🇧🇪", "flamand": "🇧🇪", "belge": "🇧🇪", "belgique": "🇧🇪",
  "hollandaise": "🇳🇱", "hollandais": "🇳🇱", "neerlandaise": "🇳🇱", "neerlandais": "🇳🇱", "pays bas": "🇳🇱",
  "allemande": "🇩🇪", "allemand": "🇩🇪", "allemagne": "🇩🇪",
  "autrichienne": "🇦🇹", "autrichien": "🇦🇹", "autriche": "🇦🇹",
  "suisse": "🇨🇭",
  "anglaise": "🇬🇧", "anglais": "🇬🇧", "britannique": "🇬🇧", "angleterre": "🇬🇧", "ecossaise": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "ecossais": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "irlandaise": "🇮🇪", "irlandais": "🇮🇪",
  "russe": "🇷🇺", "russie": "🇷🇺",
  "americaine": "🇺🇸", "americain": "🇺🇸", "etats unis": "🇺🇸",
  "mexicaine": "🇲🇽", "mexicain": "🇲🇽", "mexique": "🇲🇽",
  "canadienne": "🇨🇦", "canadien": "🇨🇦",
  "chinoise": "🇨🇳", "chinois": "🇨🇳", "chine": "🇨🇳",
  "japonaise": "🇯🇵", "japonais": "🇯🇵", "japon": "🇯🇵",
  "coreenne": "🇰🇷", "coreen": "🇰🇷",
  "indienne": "🇮🇳", "indien": "🇮🇳",
  "persane": "🇮🇷", "persan": "🇮🇷", "iranienne": "🇮🇷", "iranien": "🇮🇷",
  "portugaise": "🇵🇹", "portugais": "🇵🇹", "portugal": "🇵🇹",
  "danoise": "🇩🇰", "danois": "🇩🇰", "danemark": "🇩🇰",
  "norvegienne": "🇳🇴", "norvegien": "🇳🇴", "norvege": "🇳🇴",
  "suedoise": "🇸🇪", "suedois": "🇸🇪", "suede": "🇸🇪",
  "finlandaise": "🇫🇮", "finlandais": "🇫🇮", "finlande": "🇫🇮",
  "polonaise": "🇵🇱", "polonais": "🇵🇱", "pologne": "🇵🇱",
  "tcheque": "🇨🇿", "boheme": "🇨🇿",
  "hongroise": "🇭🇺", "hongrois": "🇭🇺", "hongrie": "🇭🇺",
  "grecque": "🇬🇷", "grec": "🇬🇷", "grece": "🇬🇷", "byzantine": "🇬🇷", "byzantin": "🇬🇷",
  "croate": "🇭🇷", "croatie": "🇭🇷",
  "ukrainienne": "🇺🇦", "ukrainien": "🇺🇦",
  "bresilienne": "🇧🇷", "bresilien": "🇧🇷", "bresil": "🇧🇷",
  "argentine": "🇦🇷",
};
function nationalityFlag(rawValue) {
  const key = keyName(rawValue);
  if (!key) return '';
  for (const label of Object.keys(NATIONALITY_FLAGS)) {
    if (key.includes(label)) return NATIONALITY_FLAGS[label];
  }
  return '';
}
function answerFor(index) {
  if (!state.answers[index]) state.answers[index] = { artist: '', date: '', location: '', title: '', checked: false };
  return state.answers[index];
}
function saveInputs() {
  const answer = answerFor(state.index);
  activeFields().forEach(({ key, input }) => answer[key] = $(input).value);
}
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i += 1) {
    let currentRow = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      currentRow.push(Math.min(
        currentRow[j] + 1,        // insertion
        previousRow[j + 1] + 1,   // suppression
        previousRow[j] + cost     // substitution
      ));
    }
    previousRow = currentRow;
  }
  return previousRow[b.length];
}
function typoTolerance(length) {
  // Seuil volontairement strict sur les mots courts : beaucoup de noms de peintres à 5 lettres
  // ne diffèrent que d'une lettre (Monet / Manet, Degas / ..., etc.), donc une tolérance y créerait
  // de fausses bonnes réponses entre deux artistes réels et différents.
  if (length <= 5) return 0;
  if (length <= 8) return 1;
  if (length <= 12) return 2;
  return 3;
}
function isCloseEnough(a, b) {
  if (!a || !b) return false;
  return levenshteinDistance(a, b) <= typoTolerance(Math.max(a.length, b.length));
}
function yearsOf(text) {
  // Extrait les années à 4 chiffres présentes dans un texte (ex. "vers 1784", "1780-1789").
  const matches = String(text).match(/\b(1[0-9]{3}|20[0-9]{2})\b/g);
  return matches ? matches.map(Number) : [];
}
const DATE_TOLERANCE_YEARS = 5; // ex. bonne date 1857 : de 1852 à 1862 accepté
function withinDateTolerance(yearA, yearB) { return Math.abs(yearA - yearB) <= DATE_TOLERANCE_YEARS; }
function isMatch(actual, expected, fieldKey) {
  const answer = keyName(actual); const target = keyName(expected);
  if (!answer || !target) return false;
  if (answer === target) return true;
  // Dates : uniquement pour le champ « date de création ». Si on appliquait cette règle à tous
  // les champs, un titre contenant une année (« Le 3 mai 1810 », « ... en 1890 ») basculerait à
  // tort en comparaison d'année au lieu d'une comparaison de texte normale.
  if (fieldKey === 'date') {
    const targetYears = yearsOf(target);
    if (targetYears.length) {
      const answerYears = yearsOf(answer);
      if (!answerYears.length) return false;
      return targetYears.some((targetYear) => answerYears.some((answerYear) => withinDateTolerance(targetYear, answerYear)));
    }
  }
  // Accepte un élément significatif de la réponse attendue : « Monet » ou « Orsay ».
  if (answer.length >= 3 && (target.includes(answer) || answer.includes(target))) return true;
  // Artiste : le prénom n'est pas pris en compte du tout — seul le nom de famille (dernier mot)
  // compte, avec la même tolérance orthographique qu'ailleurs. « Dominique Ingres » ou
  // « Ingres » valident donc tous deux pour « Jean-Auguste-Dominique Ingres ».
  if (fieldKey === 'artist') {
    const targetLastWord = target.split(' ').filter(Boolean).pop();
    const answerLastWord = answer.split(' ').filter(Boolean).pop();
    if (targetLastWord && answerLastWord && targetLastWord.length >= 3 && isCloseEnough(answerLastWord, targetLastWord)) return true;
  }
  // Tolérance orthographique sur la réponse complète (accents, lettre en trop/en moins, inversion).
  if (isCloseEnough(answer, target)) return true;
  const targetWords = target.split(' ').filter(Boolean);
  const answerWords = answer.split(' ').filter(Boolean);
  // Réponse en un mot avec une faute (ex. « Monnet » pour « Claude Monet »).
  if (answerWords.length === 1 && targetWords.some((word) => word.length >= 4 && isCloseEnough(answer, word))) return true;
  // Réponse partielle en plusieurs mots avec une faute (ex. « Van Googh » pour « Vincent van Gogh »).
  // Limité à un seul mot manquant : une réponse à « Jean-Auguste-Dominique Ingres » ne doit pas
  // valider avec juste « Dominique Ingres », qui tronque le prénom composé sans le dire.
  if (answerWords.length > 1 && answerWords.length < targetWords.length && answerWords.length >= targetWords.length - 1) {
    for (let start = 0; start <= targetWords.length - answerWords.length; start += 1) {
      const windowText = targetWords.slice(start, start + answerWords.length).join(' ');
      if (isCloseEnough(answer, windowText)) return true;
    }
  }
  return false;
}
function acceptableValues(question, key) {
  // Pour l'artiste et le titre, plusieurs réponses sont valables : nom complet, surnom (français
  // ou langue d'origine), titre français ou langue d'origine. Les autres rubriques n'ont qu'une
  // seule valeur attendue.
  if (key === 'artist') {
    return [question.artist, question.surnomFr, question.surnomOrig].filter(Boolean);
  }
  if (key === 'title') {
    return [question.title, question.titleOriginal].filter(Boolean);
  }
  return [question[key]];
}
function isMatchAny(actual, question, fieldKey) {
  return acceptableValues(question, fieldKey).some((expected) => isMatch(actual, expected, fieldKey));
}
function correctCount(answer, question) { return activeFields().reduce((count, field) => count + Number(isMatchAny(answer[field.key], question, field.key)), 0); }
function isFullyCorrect(answer, question) { return answer?.checked && correctCount(answer, question) === activeFields().length; }
function totalCorrect() { return state.questions.reduce((total, question, index) => total + (state.answers[index]?.checked ? correctCount(state.answers[index], question) : 0), 0); }
function checkedQuestions() { return state.answers.filter((answer) => answer?.checked).length; }
function imageSource(reference) {
  if (/^(https?:|data:)/i.test(reference)) return reference;
  return state.imageFiles.get(reference) || state.imageFiles.get(reference.toLocaleLowerCase('fr-FR')) || reference;
}
function shuffleQuestions(questions) {
  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[i]];
  }
  return shuffled;
}

function selectedRubriquesLabel() {
  const labels = activeFields().map((field) => field.label);
  return labels.join(', ');
}
let currentPanelName = null, suppressHistoryPush = false;
function showPanel(name) {
  // Coupe systématiquement toute voix en cours ET tous les minuteurs différés de chaque
  // exercice dès qu'on change de page — sinon un rappel programmé (setTimeout) d'un exercice
  // quitté en cours de route peut se déclencher plus tard, en plein milieu d'un autre exercice
  // (voix qui parle d'une œuvre sans rapport avec ce qui est affiché).
  if (window.speechSynthesis) speechSynthesis.cancel();
  document.querySelectorAll('.chrono-drag-ghost').forEach((g) => g.remove());
  [impTimers, vfTimers, famTimers, reconTimers, intrusTimers, chronoTimers].forEach((arr) => { if (arr) arr.forEach(clearTimeout); });
  // Prend la main sur les flèches avant/arrière du navigateur : chaque changement de page ajoute
  // une entrée d'historique interne, pour que « précédent » ramène dans l'appli au lieu d'en
  // sortir directement. Écrit après le nettoyage ci-dessus mais avant tout le reste, pour rester
  // fiable même si un panneau finit par lever une erreur plus loin.
  if (name !== currentPanelName) {
    currentPanelName = name;
    if (!suppressHistoryPush) {
      try { history.pushState({ panel: name }, '', `#${name}`); } catch (e) { /* ignoré si l'historique est indisponible */ }
    }
  }
  impTimers = []; vfTimers = []; famTimers = []; reconTimers = []; intrusTimers = []; chronoTimers = [];

  // name: 'welcome' | 'training-hub' | 'impregnation-setup' | 'impregnation' | 'intrus-setup' |
  // 'intrus' | 'quiz-setup' | 'quiz' | 'results' | 'account' | 'other-works' — centralise
  // l'affichage des panneaux et de la barre latérale (titre + import), visible uniquement sur la
  // page d'accueil.
  $('welcome-panel').classList.toggle('hidden', name !== 'welcome');
  $('training-hub-panel')?.classList.toggle('hidden', name !== 'training-hub');
  $('impregnation-setup-panel')?.classList.toggle('hidden', name !== 'impregnation-setup');
  $('impregnation-panel')?.classList.toggle('hidden', name !== 'impregnation');
  $('intrus-setup-panel')?.classList.toggle('hidden', name !== 'intrus-setup');
  $('intrus-panel')?.classList.toggle('hidden', name !== 'intrus');
  $('reconstitution-setup-panel')?.classList.toggle('hidden', name !== 'reconstitution-setup');
  $('reconstitution-panel')?.classList.toggle('hidden', name !== 'reconstitution');
  $('vraifaux-setup-panel')?.classList.toggle('hidden', name !== 'vraifaux-setup');
  $('vraifaux-panel')?.classList.toggle('hidden', name !== 'vraifaux');
  $('famille-setup-panel')?.classList.toggle('hidden', name !== 'famille-setup');
  $('famille-panel')?.classList.toggle('hidden', name !== 'famille');
  $('enigme-setup-panel')?.classList.toggle('hidden', name !== 'enigme-setup');
  $('enigme-panel')?.classList.toggle('hidden', name !== 'enigme');
  $('chrono-setup-panel')?.classList.toggle('hidden', name !== 'chrono-setup');
  $('chrono-panel')?.classList.toggle('hidden', name !== 'chrono');
  $('quiz-setup-panel')?.classList.toggle('hidden', name !== 'quiz-setup');
  $('quiz-panel').classList.toggle('hidden', name !== 'quiz');
  $('results-panel').classList.toggle('hidden', name !== 'results');
  $('account-panel')?.classList.toggle('hidden', name !== 'account');
  $('profile-panel')?.classList.toggle('hidden', name !== 'profile');
  $('other-works-panel')?.classList.toggle('hidden', name !== 'other-works');
  $('sidebar')?.classList.toggle('hidden', name !== 'welcome');
  $('bg-mosaic')?.classList.toggle('hidden', name !== 'welcome');
}

function commonsFilePageUrl(imageUrl) {
  // Reconstruit l'adresse de la page Commons (avec les crédits complets) à partir de l'URL
  // d'image stockée dans le fichier Excel, qu'il s'agisse du fichier original ou d'une miniature
  // (.../thumb/x/xx/Nom_du_fichier.jpg/1280px-Nom_du_fichier.jpg).
  const match = imageUrl.match(/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+?)(?:\/\d+px-[^/]+)?(?:\?.*)?$/i);
  if (!match) return null;
  return `https://commons.wikimedia.org/wiki/File:${match[1]}`;
}
function displayArtworkImage(work, altText, showSourceLink = false) {
  const image = $('artwork-image'); const message = $('image-message'); const source = imageSource(work.image);
  image.dataset.originalSource = source; image.dataset.proxyTried = 'false'; image.src = source; image.alt = altText; message.classList.add('hidden');
  image.onerror = () => {
    if (image.dataset.proxyTried === 'false' && /^https?:/i.test(image.dataset.originalSource)) {
      image.dataset.proxyTried = 'true';
      image.src = `https://images.weserv.nl/?url=${encodeURIComponent(image.dataset.originalSource)}&w=1200`;
      return;
    }
    message.textContent = `L'image n'a pas pu être chargée. Vérifiez le nom de fichier ou l'URL dans la ligne ${work.row} du fichier.`;
    message.classList.remove('hidden');
  };
  const sourceLink = $('artwork-source-link');
  // Le lien vers la page Commons révèle le titre et l'auteur de l'œuvre : on ne l'affiche
  // qu'une fois la réponse validée (page de correction), jamais pendant la question elle-même.
  const commonsUrl = showSourceLink ? commonsFilePageUrl(source) : null;
  if (sourceLink) {
    if (commonsUrl) { sourceLink.href = commonsUrl; sourceLink.classList.remove('hidden'); }
    else sourceLink.classList.add('hidden');
  }
}
function renderQuestion() {
  document.body.classList.remove('has-other-works'); // repart d'un état propre à chaque question
  const question = state.questions[state.index]; const answer = answerFor(state.index);
  const modeLabel = state.mode === 'review' ? 'Révision des erreurs — ' : '';
  $('quiz-reference').textContent = `${state.quizConfig?.reference || ''} — ${modeLabel}Q. ${state.index + 1}/${state.questions.length}`;
  $('progress-bar').style.width = `${((state.index + 1) / state.questions.length) * 100}%`;
  const possible = checkedQuestions() * activeFields().length;
  $('score-summary').textContent = `${totalCorrect()} / ${possible} point${totalCorrect() > 1 ? 's' : ''}`;
  displayArtworkImage(question, `Œuvre ${state.index + 1}`, answer.checked);
  document.body.classList.toggle('four-fields', state.selectedFieldKeys.length >= 4);
  allFields.forEach(({ key, input }) => {
    const wrapper = $(input).closest('.field-row');
    const active = state.selectedFieldKeys.includes(key);
    wrapper.classList.toggle('hidden', !active);
    $(input).value = answer[key];
    $(input).disabled = answer.checked;
    $(input).required = active;
  });
  if (voiceSupported) $('mic-global').disabled = answer.checked;
  $('answer-form').classList.toggle('hidden', answer.checked);
  $('correction').classList.toggle('hidden', !answer.checked);
  document.body.classList.toggle('is-corrected', answer.checked);
  if (answer.checked) {
    renderCorrection(answer, question);
  } else {
    // On ramène la cible du micro sur la première rubrique disponible (évite que la dictée
    // continue vers la dernière ligne de la question précédente), mais SANS focus() réel :
    // sur mobile, focus() rouvrirait le clavier à chaque clic sur « Suivante ».
    const first = activeFields()[0];
    if (first) setFocusedField(first.key, { focusInput: false, scroll: false });
    // La nouvelle question repart du haut de la page (l'image d'abord), plutôt que de rester
    // défilée là où on s'était arrêté sur la question précédente.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('previous-button-overlay').disabled = state.index === 0;
  $('next-button-overlay').textContent = state.index === state.questions.length - 1 ? '🏁' : '→';
}
function formatArtistName(name) {
  // Convention des légendes muséales : prénom normal, nom de famille en MAJUSCULES
  // (ex. « Auguste RENOIR »). Heuristique : le dernier mot est considéré comme le nom de famille.
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return name;
  if (parts.length === 1) return parts[0].toLocaleUpperCase('fr-FR');
  const surname = parts.pop().toLocaleUpperCase('fr-FR');
  return [...parts, surname].join(' ');
}
function formatCorrectionValue(key, rawValue) {
  if (key === 'artist') return escapeHtml(formatArtistName(rawValue));
  if (key === 'title') return `<em>${escapeHtml(rawValue)}</em>`;
  return escapeHtml(rawValue);
}
function formatArtistDisplayName(work) {
  // Prénom NOM (nom de famille en majuscules) ; si un surnom (français) existe, on l'ajoute
  // en italique entre guillemets : « Prénom NOM, dit "Surnom" ». Pour les mononymes sans nom
  // civil connu (Donatello, Masaccio...), seul le surnom s'affiche, sans virgule ni "dit".
  const civilName = [work.prenom, work.patronyme].filter(Boolean).join(' ');
  const displayName = civilName ? formatArtistName(civilName) : '';
  if (displayName && work.surnomFr) {
    return `${escapeHtml(displayName)}, dit <em>"${escapeHtml(work.surnomFr)}"</em>`;
  }
  if (work.surnomFr) return `<em>"${escapeHtml(work.surnomFr)}"</em>`;
  return escapeHtml(displayName || work.artist || '');
}
function formatArtistWithDates(work) {
  // Dates de naissance/mort affichées en petit à côté du nom, sans rubrique associée (jamais quizzées).
  // Un petit drapeau (colonne I, optionnelle) s'affiche juste avant les dates si la nationalité est connue.
  const name = formatArtistDisplayName(work);
  const dates = String(work.artistDates || '').trim();
  const flag = nationalityFlag(work.nationality);
  if (!dates && !flag) return name;
  const flagPart = flag ? `${flag} ` : '';
  return dates ? `${name} <span class="artist-dates">(${flagPart}${escapeHtml(dates)})</span>` : `${name} <span class="artist-dates">${flagPart}</span>`;
}
function correctionInfoRow(label, value) {
  return `<div class="correction-item correction-extra">
    <span class="correction-label">${label}</span>
    <strong class="correction-value">${escapeHtml(value)}</strong>
  </div>`;
}
function formatTitleWithCycle(work) {
  // Titre entre guillemets et en italique ; si l'œuvre est extraite d'un cycle (ex. un
  // manuscrit ou une série de fresques), on ajoute « extrait du "Cycle" », lui aussi en italique.
  const titlePart = `<em>"${escapeHtml(work.title)}"</em>`;
  if (!work.cycle) return titlePart;
  return `${titlePart}, extrait du <em>"${escapeHtml(work.cycle)}"</em>`;
}
function formatDimensionsDisplay(work) {
  // Hauteur/Longueur/Profondeur viennent directement de colonnes séparées : chacune, quand elle
  // est renseignée, est précédée d'un petit "h"/"l"/"p" en grisé. Rien n'est affiché pour une
  // dimension non précisée plutôt que d'inventer une valeur.
  const parts = [];
  if (work.hauteur) parts.push(`<span class="dim-hl">h</span> ${escapeHtml(withCm(work.hauteur))}`);
  if (work.longueur) parts.push(`<span class="dim-hl">l</span> ${escapeHtml(withCm(work.longueur))}`);
  if (work.profondeur) parts.push(`<span class="dim-hl">p</span> ${escapeHtml(withCm(work.profondeur))}`);
  return parts.join(' × ');
}
// Ajoute « cm » si l'unité n'est pas déjà précisée dans la valeur du fichier (certaines lignes
// ont juste un nombre, d'autres ont déjà « cm » ou « m » écrit).
function withCm(value) {
  const v = String(value || '').trim();
  return /\b(cm|mm|m)\b/i.test(v) ? v : `${v} cm`;
}
// Version texte brut (sans balises) de formatDimensionsDisplay, pour les affichages qui écrivent
// via textContent plutôt qu'innerHTML (Imprégnation, à l'effet d'écriture progressive).
function formatDimensionsPlainText(work) {
  const parts = [];
  if (work.hauteur) parts.push(`h ${withCm(work.hauteur)}`);
  if (work.longueur) parts.push(`l ${withCm(work.longueur)}`);
  if (work.profondeur) parts.push(`p ${withCm(work.profondeur)}`);
  return parts.join(' × ');
}
// Phrase parlée des dimensions, ex. « de 300 centimètres de hauteur, 50 centimètres de largeur,
// et 30 centimètres de profondeur » — l'unité est répétée sur chaque dimension (plus naturel à
// l'oral qu'une seule mention en tête), et on dit « largeur » plutôt que « longueur ».
function spokenDimensionsPhrase(work) {
  const parts = [];
  if (work.hauteur) parts.push(`${withCm(work.hauteur).replace(/\bcm\b/i, 'centimètres')} de hauteur`);
  if (work.longueur) parts.push(`${withCm(work.longueur).replace(/\bcm\b/i, 'centimètres')} de largeur`);
  if (work.profondeur) parts.push(`${withCm(work.profondeur).replace(/\bcm\b/i, 'centimètres')} de profondeur`);
  if (!parts.length) return '';
  if (parts.length === 1) return `de ${parts[0]}`;
  return `de ${parts.slice(0, -1).join(', ')}, et ${parts[parts.length - 1]}`;
}
// Phrase de référence complète, dans l'ordre demandé : « Artiste, «Titre», Date. Nature en
// matériau de H cm de hauteur, L de longueur et P de profondeur. Lieu. » — chaque partie
// manquante est simplement omise plutôt que de laisser un blanc ou une ponctuation orpheline.
function spokenFullReference(work) {
  const dimsPhrase = spokenDimensionsPhrase(work);
  const matDims = [work.materialsPhrase || work.materials, dimsPhrase].filter(Boolean).join(' ');
  const parts = [
    `${work.artist}, « ${work.title} », ${work.date}.`,
    matDims ? `${matDims}.` : '',
    work.location ? `${work.location}.` : '',
  ].filter(Boolean);
  return parts.join(' ');
}
let correctionMainWork = null; // œuvre actuellement affichée en grand dans la correction (question testée, ou une « autre œuvre » cliquée)
function renderCorrectionDetails(testedQuestion, displayedWork, answer) {
  const isTestedWork = displayedWork === testedQuestion;
  displayArtworkImage(displayedWork, isTestedWork ? `Œuvre ${state.index + 1}` : `Autre œuvre du même peintre : ${displayedWork.title}`, true);
  $('correction-details').innerHTML = allFields.map(({ key, label }) => {
    let value;
    if (key === 'artist') value = formatArtistWithDates(displayedWork);
    else if (key === 'title') value = formatTitleWithCycle(displayedWork);
    else value = formatCorrectionValue(key, displayedWork[key]);
    // Une « autre œuvre » cliquée n'a pas été répondue par l'utilisateur : on l'affiche
    // uniquement à titre d'information, sans notation ✓/✕.
    const tested = isTestedWork && state.selectedFieldKeys.includes(key);
    let html;
    if (!tested) {
      html = `<div class="correction-item correction-extra">
        <span class="correction-label">${label}</span>
        <strong class="correction-value">${value}</strong>
      </div>`;
    } else {
      const correct = isMatchAny(answer[key], displayedWork, key);
      html = `<div class="correction-item">
        <span class="correction-label">${label}</span><span class="answer-result ${correct ? 'correct' : 'incorrect'}">${correct ? 'Exact' : 'À réviser'}</span>
        <strong class="correction-value">${value}</strong>
      </div>`;
    }
    // Matériaux/technique et dimensions : toujours purement informatifs, jamais quizzés, affichés
    // juste après la ligne « date de création ».
    if (key === 'date') {
      if (displayedWork.materials) html += correctionInfoRow('Matériaux et technique', displayedWork.materialsPhrase || displayedWork.materials);
      const dims = formatDimensionsDisplay(displayedWork);
      if (dims) {
        html += `<div class="correction-item correction-extra">
          <span class="correction-label">Dimensions</span>
          <strong class="correction-value">${dims}</strong>
        </div>`;
      }
    }
    return html;
  }).join('');
}
function renderCorrection(answer, question) {
  correctionMainWork = question;
  renderCorrectionDetails(question, question, answer);

  // Pour les quiz où un même peintre a plusieurs œuvres (ex. niveau 200 œuvres), on montre les
  // autres pour aider à les mémoriser ensemble. Recherche sur toute la base connue de l'artiste
  // (tous niveaux confondus, cf. state.allRowsForArtistLookup) — pas seulement le niveau choisi
  // pour ce quiz, pour ne rien manquer de ce que l'artiste a d'autre dans la base.
  const otherWorksSource = state.allRowsForArtistLookup || state.fullQuestions;
  const otherWorks = otherWorksSource
    .filter((otherQuestion) => otherQuestion !== question && keyName(otherQuestion.artist) === keyName(question.artist))
    .sort((a, b) => {
      // Tri par niveau croissant d'abord (les œuvres les plus célèbres de l'artiste en tête),
      // puis chronologique ascendant au sein d'un même niveau, à partir de la première année
      // détectable dans la date. Les dates sans année exploitable sont placées à la fin de leur
      // groupe de niveau.
      const levelA = a.niveau || 1; const levelB = b.niveau || 1;
      if (levelA !== levelB) return levelA - levelB;
      const yearA = yearsOf(a.date)[0]; const yearB = yearsOf(b.date)[0];
      if (yearA == null && yearB == null) return 0;
      if (yearA == null) return 1;
      if (yearB == null) return -1;
      return yearA - yearB;
    });
  const otherWorksBox = $('other-works');
  // Les autres œuvres ne s'affichent plus automatiquement en ligne : le bloc ne montre qu'un
  // bouton (« Voir les autres œuvres… »), et le détail (images plus grandes, triées et
  // regroupées par niveau) s'ouvre dans une page dédiée sur demande — cf. #other-works-panel.
  state.currentOtherWorks = otherWorks;
  if (!otherWorks.length) {
    otherWorksBox.classList.add('hidden');
    document.body.classList.remove('has-other-works');
    return;
  }
  otherWorksBox.classList.remove('hidden');
  document.body.classList.add('has-other-works');
}
function renderOtherWorksPanel() {
  const otherWorks = state.currentOtherWorks || [];
  const list = $('other-works-panel-list');
  list.classList.remove('count-1', 'count-2', 'count-3-4', 'count-5-8', 'count-9plus');
  if (otherWorks.length === 1) list.classList.add('count-1');
  else if (otherWorks.length === 2) list.classList.add('count-2');
  else if (otherWorks.length <= 4) list.classList.add('count-3-4');
  else if (otherWorks.length <= 8) list.classList.add('count-5-8');
  else list.classList.add('count-9plus');
  // Classées comme un catalogue : niveau 1 d'abord, puis 2, puis 3 (déjà l'ordre fourni par
  // renderCorrection), sans titre de section ni ligne de séparation — juste le niveau indiqué
  // sous chaque légende.
  list.innerHTML = otherWorks.map((otherQuestion, index) => {
    const source = imageSource(otherQuestion.image);
    const titleValue = formatCorrectionValue('title', otherQuestion.title);
    return `<button type="button" class="other-work-card-big" data-index="${index}">
      <img src="${escapeHtml(source)}" alt="" loading="lazy" data-original="${escapeHtml(source)}"
           onerror="if(!this.dataset.fallbackTried){this.dataset.fallbackTried='1';this.src='https://images.weserv.nl/?url='+encodeURIComponent(this.dataset.original)+'&w=300';}" />
      <span class="other-work-caption"><strong>${titleValue}</strong><br>${escapeHtml(otherQuestion.date)} — ${escapeHtml(otherQuestion.location)}</span>
    </button>`;
  }).join('');
  // Clic sur une vignette : ouvre l'image en grand dans la visionneuse, avec juste un bouton
  // de fermeture (les boutons du haut restent accessibles pour revenir en arrière).
  $('other-works-panel-list').querySelectorAll('.other-work-card-big').forEach((card) => {
    card.addEventListener('click', () => {
      const work = otherWorks[Number(card.dataset.index)];
      const titleValue = formatCorrectionValue('title', work.title);
      $('lightbox-image').src = imageSource(work.image);
      $('lightbox-caption').innerHTML = `<strong>${titleValue}</strong><br>${escapeHtml(work.date)} — ${escapeHtml(work.location)}`;
      $('image-lightbox').classList.remove('hidden');
    });
  });
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }

function showResults() {
  // La réponse a déjà été enregistrée par finalizeCurrentAnswer() juste avant l'appel à
  // showResults() (voir goToNextOrResults) : pas besoin, et surtout pas question, de relire
  // les champs ici, puisqu'ils ont été vidés entre-temps.
  showPanel('results');
  const correct = totalCorrect(); const possible = state.questions.length * activeFields().length; const percent = possible ? Math.round((correct / possible) * 100) : 0;
  $('final-score').textContent = `${correct} / ${possible} (${percent} %)`;
  $('final-message').textContent = percent === 100 ? 'Parfait ! Toutes les informations sont justes.' : percent >= 70 ? 'Très bon résultat. Revoyez les réponses restantes pour consolider vos repères.' : 'Continuez : la correction est disponible pour chaque œuvre.';

  const missedCount = state.questions.filter((question, index) => !isFullyCorrect(state.answers[index], question)).length;
  const reviewButton = $('review-errors-button');
  if (missedCount > 0) {
    reviewButton.classList.remove('hidden');
    reviewButton.textContent = `Revoir les ${missedCount} question${missedCount > 1 ? 's' : ''} ratée${missedCount > 1 ? 's' : ''}`;
  } else {
    reviewButton.classList.add('hidden');
  }
  $('restart-full-button').classList.toggle('hidden', state.mode !== 'review' || state.fullQuestions.length === state.questions.length);
  $('view-my-results-button')?.classList.toggle('hidden', !firebaseReady || !currentUser);
  $('download-my-report-button')?.classList.toggle('hidden', !firebaseReady || !currentUser);
  $('auto-save-status')?.classList.add('hidden');
  // Sauvegarde automatique du score, une seule fois par quiz terminé (pas à chaque re-rendu
  // de la page de résultats, par exemple après une révision des erreurs).
  // Seul un quiz complet (pas une reprise des questions ratées) compte comme un essai à
  // enregistrer dans l'historique — sinon les statistiques et l'évolution seraient faussées.
  if (firebaseReady && currentUser && state.mode === 'normal' && !state.currentScoreSaved) {
    state.currentScoreSaved = true;
    saveCurrentScore();
  }
}

function buildExportText() {
  const lines = [];
  const now = new Date();
  const dateLabel = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeLabel = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const correct = totalCorrect(); const possible = state.questions.length * activeFields().length; const percent = possible ? Math.round((correct / possible) * 100) : 0;
  lines.push("Quiz d'art — Résultats");
  lines.push(`${dateLabel} à ${timeLabel}`);
  if (state.mode === 'review') lines.push('Session de révision des erreurs');
  lines.push(`Rubriques testées : ${selectedRubriquesLabel()}`);
  lines.push(`Score final : ${correct} / ${possible} (${percent} %)`);
  lines.push('');
  lines.push('Détail par œuvre :');
  state.questions.forEach((question, index) => {
    const answer = state.answers[index];
    if (!answer?.checked) return;
    const score = correctCount(answer, question);
    lines.push('');
    lines.push(`${index + 1}. ${question.title || '(titre non renseigné)'} — ${question.artist || '(artiste non renseigné)'} [${score}/${activeFields().length}]`);
    activeFields().forEach(({ key, label }) => {
      const ok = isMatchAny(answer[key], question, key);
      lines.push(`   - ${label} : ${ok ? 'correct' : 'à revoir'} (réponse attendue : ${question[key]})`);
    });
  });
  return lines.join('\n');
}

$('excel-file')?.addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  const chosenKeys = allFields.filter((field) => $(field.checkbox).checked).map((field) => field.key);
  if (!chosenKeys.length) { alert('Sélectionnez au moins une rubrique à réviser (artiste, date, lieu ou titre).'); event.target.value = ''; return; }
  try {
    if (!window.XLSX) throw new Error('Le module de lecture Excel n’a pas été chargé. Vérifiez votre connexion Internet et rechargez la page.');
    const data = await file.arrayBuffer(); const book = XLSX.read(data, { type: 'array' }); const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
    const questions = normaliseRows(rows); if (!questions.length) throw new Error('Aucune question utilisable n’a été trouvée dans le premier onglet.');
    state.selectedFieldKeys = chosenKeys;
    state.mode = 'normal';
    state.fullQuestions = shuffleQuestions(questions);
    state.questions = state.fullQuestions;
    state.answers = []; state.index = 0;
    state.currentScoreSaved = false;
    state.quizConfig = { label: 'Import manuel', level: 'Autre', rubriques: chosenKeys.map((key) => allFields.find((f) => f.key === key)?.label || key), reference: `${questions.length} questions — import manuel` };
    const refEl = $('quiz-reference');
    if (refEl) refEl.textContent = state.quizConfig.reference;
    showPanel('quiz'); renderQuestion();
  } catch (error) { alert(`Import impossible : ${error.message}`); }
  event.target.value = '';
});

// --- Liste des artistes (fichier-maître consultable, indépendant du quiz en cours) ---
// Ce fichier est statique comme les autres : il ne se régénère pas tout seul quand un nouvel
// artiste est ajouté ailleurs. En revanche, ce bouton lit toujours SA version la plus récente
// publiée dans quizzes/ — pas besoin de retoucher ce code après une mise à jour du fichier.
let artistListLoaded = false;
let artistListRows = [];
let artistListSort = { col: 'Artiste', dir: 1 };
let artistListFilters = { nationalite: '', art: '', siecle: '' };
let artistListMode = 'full'; // 'full' = liste complète non filtrée, 'filtered' = avec les 3 menus
const ARTIST_LIST_COLS = [
  { key: 'Artiste', label: 'Artiste' },
  { key: 'Nationalité', label: 'Nationalité' },
  { key: 'Art(s)', label: 'Art(s)' },
  { key: 'Siècle(s)', label: 'Siècle(s)' },
];
function splitArtistName(full) {
  // Repère la coupure prénom / nom de famille : part de la fin, et tant que le mot est en
  // MAJUSCULES (ou une particule courante : van, von, de, della...) on l'inclut dans le "nom".
  // S'arrête au premier mot qui n'est ni l'un ni l'autre. Si rien ne colle dès le premier mot
  // (formats composés du type "GIAMBOLOGNA (Jean de Bologne)"), on renonce : pas de nom détecté.
  const tokens = full.split(' ');
  const connectors = ["van","von","de","della","di","du","le","la","dei","des","d'","af","del","da","les"];
  let splitIndex = tokens.length;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const bare = tokens[i].replace(/[()]/g, '');
    const isUpper = bare.length > 1 && bare === bare.toUpperCase() && bare !== bare.toLowerCase();
    const isConnector = connectors.includes(tokens[i].toLowerCase());
    if (isUpper || isConnector) { splitIndex = i; } else { break; }
  }
  return { prenom: tokens.slice(0, splitIndex).join(' '), nom: tokens.slice(splitIndex).join(' ') };
}
function formatArtistListName(full) {
  const { prenom, nom } = splitArtistName(full);
  // Cas où l'heuristique ne détecte rien (ex. "François Clouet", encore en casse normale dans le
  // fichier) : on met quand même le nom entier en gras, pour rester cohérent avec toutes les
  // autres lignes qui, elles, sont déjà en majuscules dans le fichier et ressortent en gras.
  if (!nom) return `<strong>${escapeHtml(full)}</strong>`;
  const prenomPart = prenom ? `${escapeHtml(prenom.toLowerCase())} ` : '';
  return `${prenomPart}<strong>${escapeHtml(nom)}</strong>`;
}
function filteredArtistListRows() {
  if (artistListMode === 'full') return artistListRows;
  const { nationalite, art, siecle } = artistListFilters;
  return artistListRows.filter((r) => {
    if (nationalite && r['Nationalité'] !== nationalite) return false;
    if (art && !String(r['Art(s)'] || '').includes(art)) return false;
    if (siecle && !String(r['Siècle(s)'] || '').includes(siecle)) return false;
    return true;
  });
}
function renderArtistListTable() {
  const container = $('artist-list-table');
  const { col, dir } = artistListSort;
  const sorted = filteredArtistListRows().sort((a, b) => dir * String(a[col] || '').localeCompare(String(b[col] || ''), 'fr'));
  const html = ['<table class="artist-table"><thead><tr>'];
  ARTIST_LIST_COLS.forEach((c) => {
    const arrow = col === c.key ? (dir === 1 ? ' ▲' : ' ▼') : '';
    html.push(`<th class="sortable-col" data-col="${c.key}">${c.label}${arrow}</th>`);
  });
  html.push('</tr></thead><tbody>');
  sorted.forEach((r) => {
    // Nom affiché tel qu'enregistré dans le fichier (prénom en casse normale, nom de famille en
    // majuscules) — pas de mise en majuscules forcée de l'ensemble.
    html.push(`<tr><td>${formatArtistListName(String(r['Artiste'] || ''))}</td><td>${escapeHtml(r['Nationalité'] || '')}</td><td>${escapeHtml(r['Art(s)'] || '')}</td><td>${escapeHtml(r['Siècle(s)'] || '')}</td></tr>`);
  });
  html.push('</tbody></table>');
  container.innerHTML = html.join('');
  container.querySelectorAll('.sortable-col').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.col;
      artistListSort = artistListSort.col === key ? { col: key, dir: -artistListSort.dir } : { col: key, dir: 1 };
      renderArtistListTable();
    });
  });
  const status = $('artist-list-status');
  const hasFilter = artistListMode === 'filtered' && (artistListFilters.nationalite || artistListFilters.art || artistListFilters.siecle);
  status.textContent = hasFilter
    ? `${sorted.length} artiste${sorted.length > 1 ? 's' : ''} correspondant au filtre (sur ${artistListRows.length} au total).`
    : `${artistListRows.length} artistes référencés dans les quiz. Cliquez sur un en-tête de colonne pour trier.`;
}
function setArtistListMode(mode) {
  artistListMode = mode;
  $('artist-list-mode-full')?.classList.toggle('active-mode', mode === 'full');
  $('artist-list-mode-filtered')?.classList.toggle('active-mode', mode === 'filtered');
  $('artist-list-filters')?.classList.toggle('hidden', mode !== 'filtered');
  renderArtistListTable();
}
$('artist-list-mode-full')?.addEventListener('click', () => setArtistListMode('full'));
$('artist-list-mode-filtered')?.addEventListener('click', () => setArtistListMode('filtered'));
function populateArtistListFilters() {
  const nationalites = [...new Set(artistListRows.map((r) => r['Nationalité']).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const arts = [...new Set(artistListRows.flatMap((r) => String(r['Art(s)'] || '').split(',').map((s) => s.trim()).filter(Boolean)))].sort();
  const siecles = [...new Set(artistListRows.flatMap((r) => String(r['Siècle(s)'] || '').split(',').map((s) => s.trim()).filter(Boolean)))].sort((a, b) => parseInt(a) - parseInt(b));
  const fill = (id, values, placeholder) => {
    const select = $(id);
    select.innerHTML = `<option value="">${placeholder}</option>` + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  };
  fill('filter-nationalite', nationalites, 'Toutes nationalités');
  fill('filter-art', arts, 'Tous arts');
  fill('filter-siecle', siecles, 'Tous siècles');
}
$('filter-nationalite')?.addEventListener('change', (e) => { artistListFilters.nationalite = e.target.value; renderArtistListTable(); });
$('filter-art')?.addEventListener('change', (e) => { artistListFilters.art = e.target.value; renderArtistListTable(); });
$('filter-siecle')?.addEventListener('change', (e) => { artistListFilters.siecle = e.target.value; renderArtistListTable(); });
$('menu-item-artistes')?.addEventListener('click', async () => {
  closeHamburgerMenu();
  openModal('modal-artist-list');
  if (artistListLoaded) return;
  const status = $('artist-list-status');
  try {
    if (!window.XLSX) throw new Error('Le module de lecture Excel n’a pas été chargé.');
    const response = await fetch('quizzes/artistes-nationalites-maitre.xlsx');
    if (!response.ok) throw new Error('fichier introuvable');
    const buffer = await response.arrayBuffer();
    const book = XLSX.read(buffer, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
    if (!rows.length) throw new Error('liste vide');
    artistListRows = rows;
    populateArtistListFilters();
    setArtistListMode('full');
    artistListLoaded = true;
  } catch (error) {
    status.textContent = "La liste des artistes n'est pas disponible pour le moment.";
  }
});

// --- Menu hamburger (☰), en haut à gauche, présent sur toutes les pages ---
function closeHamburgerMenu() { $('hamburger-menu')?.classList.add('hidden'); }
$('hamburger-button')?.addEventListener('click', (event) => {
  event.stopPropagation();
  $('hamburger-menu')?.classList.toggle('hidden');
});
document.addEventListener('click', (event) => {
  const wrap = document.querySelector('.hamburger-wrap');
  if (wrap && !wrap.contains(event.target)) closeHamburgerMenu();
});
$('menu-item-fonctionnement')?.addEventListener('click', () => { closeHamburgerMenu(); openModal('modal-fonctionnement'); });
$('menu-item-contact')?.addEventListener('click', () => { closeHamburgerMenu(); openModal('modal-contact'); });
$('open-mentions-legales')?.addEventListener('click', () => openModal('modal-mentions-legales'));
$('global-home-button')?.addEventListener('click', () => showPanel('welcome'));
$('quiz-setup-back-button')?.addEventListener('click', () => showPanel('welcome'));

// ============================================================
// MODULE RECONSTITUTION — un détail très resserré (< 10 % de la surface) sert d'indice ; 3
// références (artiste + titre) sont proposées. Même mécanique de correction que Intrus (référence
// choisie conservée avec son verdict), puis l'image entière est révélée avec la référence complète.
// ============================================================
function showReconConfig() {
  showPanel('reconstitution-setup'); populateReconVoices(); speakObjective('recon'); restoreLastSelection('reconstitution-setup-panel'); applyDefaultAdvance('recon-opt-autoadvance', 'recon-opt-delay', 'recon-delay-row');
}
$('open-reconstitution-setup')?.addEventListener('click', () => {
  if (hasPerExerciseFieldOverride('reconstitution-setup-panel') || hasPerExerciseRubriqueOverride('reconstitution-setup-panel')) {
    restoreLastSelection('reconstitution-setup-panel');
  } else {
    applyGlobalFieldDefaultsTo('recon');
  }
  suppressSaveLastSelection = true;
  applyDefaultAdvance('recon-opt-autoadvance', 'recon-opt-delay', 'recon-delay-row');
  $('recon-start-button')?.click();
});
$('reconstitution-setup-back-button')?.addEventListener('click', () => showPanel('training-hub'));
$('recon-exit-link')?.addEventListener('click', () => { speechSynthesis.cancel(); showPanel('reconstitution-setup'); });
$('recon-scores-link')?.addEventListener('click', () => { speechSynthesis.cancel(); returnToExercisePanel = 'reconstitution'; showPanel('account'); loadAccountPage(); });
$('recon-setup-scores-link')?.addEventListener('click', () => { returnToExercisePanel = null; showPanel('account'); loadAccountPage(); });

// ============================================================
// MODULE VRAI/FAUX — la référence affichée est soit entièrement exacte, soit comporte 1 ou 2
// éléments faux (jamais les dimensions, qui ne sont pas montrées ici). Le joueur juge Vrai/Faux ;
// en cas d'erreur, la ou les lignes fautives apparaissent en rouge, corrigées en vert en dessous.
// ============================================================
function showVfConfig() {
  showPanel('vraifaux-setup'); populateVfVoices(); speakObjective('vf'); restoreLastSelection('vraifaux-setup-panel');
}
$('open-vraifaux-setup')?.addEventListener('click', () => {
  if (hasPerExerciseFieldOverride('vraifaux-setup-panel') || hasPerExerciseRubriqueOverride('vraifaux-setup-panel')) {
    restoreLastSelection('vraifaux-setup-panel');
  } else {
    applyGlobalFieldDefaultsTo('vf');
  }
  suppressSaveLastSelection = true;
  $('vf-start-button')?.click();
});
$('vraifaux-setup-back-button')?.addEventListener('click', () => showPanel('training-hub'));
$('vf-exit-link')?.addEventListener('click', () => { vfTimers.forEach(clearTimeout); speechSynthesis.cancel(); showPanel('vraifaux-setup'); });
$('vf-scores-link')?.addEventListener('click', () => { speechSynthesis.cancel(); returnToExercisePanel = 'vraifaux'; showPanel('account'); loadAccountPage(); });

// ============================================================
// MODULE FAMILLE — 8 images, 4 sont du même artiste. Le joueur les repère et nomme l'artiste
// (1re validation), puis doit retrouver le titre de chacune des 4 œuvres (2e validation).
// Tout-ou-rien : 1 point seulement si artiste + les 4 titres sont exacts.
// ============================================================
function showFamConfig() {
  showPanel('famille-setup'); populateFamVoices(); speakObjective('fam'); restoreLastSelection('famille-setup-panel');
}
$('open-famille-setup')?.addEventListener('click', () => {
  if (hasPerExerciseFieldOverride('famille-setup-panel') || hasPerExerciseRubriqueOverride('famille-setup-panel')) {
    restoreLastSelection('famille-setup-panel');
  } else {
    applyGlobalFieldDefaultsTo('fam');
  }
  suppressSaveLastSelection = true;
  $('fam-start-button')?.click();
});
$('famille-setup-back-button')?.addEventListener('click', () => showPanel('training-hub'));
$('fam-exit-link')?.addEventListener('click', () => { famTimers.forEach(clearTimeout); speechSynthesis.cancel(); showPanel('famille-setup'); });
$('fam-scores-link')?.addEventListener('click', () => { speechSynthesis.cancel(); returnToExercisePanel = 'famille'; showPanel('account'); loadAccountPage(); });
$('fam-setup-scores-link')?.addEventListener('click', () => { returnToExercisePanel = null; showPanel('account'); loadAccountPage(); });

// ============================================================
// MODULE CHRONOLOGIE — 4 œuvres, à remettre dans l'ordre chronologique en cliquant dans l'ordre
// (la première cliquée = la plus ancienne). Correction façon Famille : fiches de référence
// complètes affichées dans le bon ordre. Score tout-ou-rien (0 ou 1).
// ============================================================
const CHRONO_ACCORDIONS = ['chrono-toggle-art:chrono-body-art', 'chrono-toggle-century:chrono-body-century', 'chrono-toggle-level:chrono-body-level', 'chrono-toggle-count:chrono-body-count'];
CHRONO_ACCORDIONS.forEach((pair) => {
  const [toggleId, bodyId] = pair.split(':');
  $(toggleId)?.addEventListener('click', () => { $(bodyId)?.classList.toggle('hidden'); });
});
function chronoSelectedArts() { return ['peinture', 'sculpture'].filter((a) => $(`chrono-art-${a}`)?.checked); }
function chronoSelectedCenturies() { return ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].filter((c) => $(`chrono-century-${c}`)?.checked); }
function chronoSelectedZones() { return ['france', 'europe', 'amerique', 'asie'].filter((z) => $(`chrono-zone-${z}`)?.checked); }
function chronoSelectedLevels() { return ['1', '2', '3'].filter((l) => $(`chrono-level-${l}`)?.checked); }
function showChronoConfig() {
  showPanel('chrono-setup'); speakObjective('chrono'); restoreLastSelection('chrono-setup-panel');
}
$('open-chrono-setup')?.addEventListener('click', () => {
  if (hasPerExerciseFieldOverride('chrono-setup-panel') || hasPerExerciseRubriqueOverride('chrono-setup-panel')) {
    restoreLastSelection('chrono-setup-panel');
  } else {
    applyGlobalFieldDefaultsTo('chrono');
  }
  suppressSaveLastSelection = true;
  $('chrono-start-button')?.click();
});
$('chrono-setup-back-button')?.addEventListener('click', () => showPanel('training-hub'));
$('chrono-exit-link')?.addEventListener('click', () => { chronoTimers.forEach(clearTimeout); speechSynthesis.cancel(); showPanel('chrono-setup'); });
$('chrono-hub-link')?.addEventListener('click', () => { speechSynthesis.cancel(); showPanel('training-hub'); updateExerciseSummaries(); });
$('chrono-scores-link')?.addEventListener('click', () => { speechSynthesis.cancel(); returnToExercisePanel = 'chrono'; showPanel('account'); loadAccountPage(); });
$('chrono-setup-scores-link')?.addEventListener('click', () => { returnToExercisePanel = null; showPanel('account'); loadAccountPage(); });

let CHRONO_SESSION = [], chronoIndex = 0, chronoScore = 0, chronoAnswered = false, chronoSelectedOrder = [], chronoTimers = [];
const chronoTimer = createTimer('chrono-timer');

$('chrono-start-button')?.addEventListener('click', async () => {
  handleExtendAndRemember('chrono', 'chrono-setup-panel');
  saveLastSelection('chrono-setup-panel');
  let arts = chronoSelectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = chronoSelectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  let levels = chronoSelectedLevels(); if (!levels.length) levels = ['1','2','3'];
  const feedback = $('chrono-setup-feedback');
  feedback.classList.remove('hidden');
  feedback.textContent = 'Chargement des œuvres…';
  try {
    const zones = chronoSelectedZones();
    let allRows = [];
    for (const art of arts) {
      for (const century of centuries) {
        try {
          const rows = await fetchQuizRows(art, century);
          rows.forEach((r) => { r.century = century; });
          allRows.push(...rows);
        } catch (e) { /* fichier absent, ignoré */ }
      }
    }
    if (allRows.length < 4) { feedback.textContent = "Pas assez d'œuvres disponibles pour ce choix (4 minimum)."; return; }
    let pool = allRows.filter((r) => levels.includes(String(r.niveau || 1)));
    if (pool.length < 4) pool = allRows;
    if (zones.length) {
      const zoned = pool.filter((r) => { const z = zoneOfNationality(r.nationality); return !z || zones.includes(z); });
      if (zoned.length >= 4) pool = zoned;
    }
    // Ne garde que les œuvres dont on peut extraire une année exploitable — indispensable pour
    // établir un ordre chronologique sans ambiguïté.
    const dated = pool.filter((r) => chronoYearOf(r) !== null);
    if (dated.length < 4) { feedback.textContent = "Pas assez d'œuvres avec une date exploitable pour ce choix — essayez d'élargir la sélection."; return; }

    const countChoice = Number(document.querySelector('input[name="chrono-count"]:checked').value);
    const questions = [];
    const usedKeys = new Set();
    // Répartit les œuvres du siècle choisi en 4 tranches d'environ 25 ans (début, ~30 ans,
    // ~60 ans, fin) et tire une œuvre dans chaque tranche : un vrai écart chronologique entre
    // elles, plus facile à ordonner qu'un tirage totalement aléatoire.
    const centuriesPresent = [...new Set(dated.map((w) => Math.floor(chronoYearOf(w) / 100)))];
    let attempts = 0;
    while (questions.length < countChoice && attempts < countChoice * 30) {
      attempts++;
      const centuryBase = centuriesPresent[Math.floor(Math.random() * centuriesPresent.length)] * 100;
      const inCentury = dated.filter((w) => { const y = chronoYearOf(w); return y >= centuryBase && y < centuryBase + 100; });
      let picked = [];
      if (inCentury.length >= 4) {
        const buckets = [[], [], [], []];
        inCentury.forEach((w) => { const slot = Math.min(3, Math.floor((chronoYearOf(w) - centuryBase) / 25)); buckets[slot].push(w); });
        if (buckets.every((b) => b.length)) {
          picked = buckets.map((b) => b[Math.floor(Math.random() * b.length)]);
        }
      }
      if (picked.length !== 4) {
        // Repli si une tranche est vide pour ce siècle : tirage large mais toujours daté.
        picked = dated.slice().sort(() => Math.random() - 0.5).slice(0, 4);
      }
      const years = picked.map(chronoYearOf);
      // Rejette un tirage où deux œuvres auraient la même année (ordre ambigu) ou un tirage déjà
      // utilisé dans cette session.
      if (new Set(years).size < 4) continue;
      const key = picked.map((w) => w.image).sort().join('|');
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      const chronological = picked.slice().sort((a, b) => chronoYearOf(a) - chronoYearOf(b));
      questions.push({ works: picked, chronological });
    }
    if (!questions.length) { feedback.textContent = "Impossible de constituer un exercice avec ces critères — essayez d'élargir le choix."; return; }
    CHRONO_SESSION = questions;
    chronoIndex = 0; chronoScore = 0;
    showPanel('chrono');
    chronoTimer.start();
    chronoShowQuestion();
  } catch (error) {
    feedback.textContent = `Erreur : ${error.message}`;
  }
});

function chronoYearOf(w) {
  const m = String(w.date || '').match(/\b(1[3-9]|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

function chronoShowQuestion() {
  speechSynthesis.cancel();
  chronoTimers.forEach(clearTimeout); chronoTimers = [];
  chronoAnswered = false;
  const q = CHRONO_SESSION[chronoIndex];
  $('chrono-progress-label').textContent = `Question ${chronoIndex + 1} / ${CHRONO_SESSION.length}`;
  $('chrono-progress-bar').style.width = `${(chronoIndex / CHRONO_SESSION.length) * 100}%`;
  $('chrono-score-label').textContent = `${chronoScore} point${chronoScore > 1 ? 's' : ''}`;
  $('chrono-correction').classList.add('hidden');
  $('chrono-correct-table').classList.add('hidden');
  $('chrono-validate-button').classList.remove('hidden');
  $('chrono-validate-button').disabled = true;
  $('chrono-source-row').classList.remove('hidden');
  $('chrono-target-row').classList.remove('hidden');

  // Ligne du haut : les 4 œuvres dans le désordre. Ligne du bas : 4 emplacements vides, numérotés
  // du plus ancien (1) au plus récent (4), où le joueur les dépose.
  const shuffledDisplay = q.works.slice().sort(() => Math.random() - 0.5);
  q.displayOrder = shuffledDisplay;
  $('chrono-source-row').innerHTML = shuffledDisplay.map((work, i) =>
    `<button type="button" class="fam-image-cell chrono-source-item" data-index="${i}"><img src="${escapeHtml(imageSource(work.image))}" alt="" /></button>`
  ).join('');
  $('chrono-target-row').innerHTML = [0, 1, 2, 3].map((i) =>
    `<button type="button" class="chrono-target-slot" data-slot="${i}"><span class="chrono-slot-num">${i + 1}</span></button>`
  ).join('');

  attachChronoDragAndDrop();
  famSpeak2('Remets ces quatre œuvres dans l\u2019ordre chronologique.');
}

// Sélection par clic (toucher l'œuvre puis l'emplacement) : plus sobre qu'un vrai glisser, mais
// bien plus fiable d'un navigateur à l'autre — le glisser au pointeur posait trop de problèmes
// selon les appareils, on l'a donc retiré au profit de ce mécanisme simple et robuste.
let chronoPicked = null;
function attachChronoDragAndDrop() {
  chronoPicked = null;

  function placeInSlot(slot, sourceBtn) {
    const idx = Number(sourceBtn.dataset.index);
    if (slot.classList.contains('filled')) {
      const oldIdx = Number(slot.dataset.sourceIndex);
      const oldSource = document.querySelector(`.chrono-source-item[data-index="${oldIdx}"]`);
      if (oldSource) oldSource.classList.remove('used');
    }
    slot.innerHTML = `<span class="chrono-slot-num">${Number(slot.dataset.slot) + 1}</span><img src="${sourceBtn.querySelector('img').src}" alt="" />`;
    slot.dataset.sourceIndex = idx;
    slot.classList.add('filled');
    sourceBtn.classList.add('used');
    updateChronoValidateState();
  }

  document.querySelectorAll('.chrono-source-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (item.classList.contains('used')) return;
      document.querySelectorAll('.chrono-source-item').forEach((c) => c.classList.remove('picked'));
      chronoPicked = chronoPicked === item ? null : item;
      if (chronoPicked) item.classList.add('picked');
    });
  });

  document.querySelectorAll('.chrono-target-slot').forEach((slot) => {
    slot.addEventListener('click', () => {
      if (slot.classList.contains('filled')) {
        const oldIdx = Number(slot.dataset.sourceIndex);
        const oldSource = document.querySelector(`.chrono-source-item[data-index="${oldIdx}"]`);
        if (oldSource) oldSource.classList.remove('used');
        slot.innerHTML = `<span class="chrono-slot-num">${Number(slot.dataset.slot) + 1}</span>`;
        slot.classList.remove('filled');
        delete slot.dataset.sourceIndex;
        updateChronoValidateState();
        return;
      }
      if (!chronoPicked) return;
      placeInSlot(slot, chronoPicked);
      chronoPicked.classList.remove('picked');
      chronoPicked = null;
    });
  });
}
function updateChronoValidateState() {
  const filled = document.querySelectorAll('.chrono-target-slot.filled').length === 4;
  $('chrono-validate-button').disabled = !filled;
}

// Petit relais vocal indépendant du module Famille (mêmes réglages que les autres exercices).
let chronoAudioOn = true, chronoSelectedVoiceRef = null;
function famSpeak2(text, onEnd) {
  chronoAudioOn = getGlobalPrefs().audioOn;
  chronoSelectedVoiceRef = getGlobalVoice();
  if (!chronoAudioOn || !window.speechSynthesis) { if (onEnd) onEnd(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR'; u.rate = 0.85;
  if (chronoSelectedVoiceRef) u.voice = chronoSelectedVoiceRef;
  if (onEnd) {
    let done = false;
    const finish = () => { if (!done) { done = true; onEnd(); } };
    u.onend = finish; u.onerror = finish;
    chronoTimers.push(setTimeout(finish, Math.max(1200, (text.length / 13) * 1000) + 400));
  }
  speechSynthesis.speak(u);
}

$('chrono-validate-button')?.addEventListener('click', () => {
  if (chronoAnswered) return;
  const slots = [...document.querySelectorAll('.chrono-target-slot')];
  if (slots.some((s) => !s.classList.contains('filled'))) return;
  chronoAnswered = true;
  const q = CHRONO_SESSION[chronoIndex];
  $('chrono-validate-button').classList.add('hidden');

  const playerOrder = slots.map((s) => q.displayOrder[Number(s.dataset.sourceIndex)]);
  const correctOrder = q.chronological;
  const rightFlags = playerOrder.map((w, i) => w === correctOrder[i]);
  const isCorrect = rightFlags.every(Boolean);
  const pointEarned = isCorrect ? 1 : 0;
  chronoScore = Math.round((chronoScore + pointEarned) * 10) / 10;
  $('chrono-score-label').textContent = `${chronoScore} point${chronoScore > 1 ? 's' : ''}`;

  $('chrono-verdict').textContent = isCorrect ? 'Exact' : 'À réviser';
  $('chrono-verdict').style.color = isCorrect ? 'var(--ok)' : 'var(--wrong)';

  // La ligne du haut disparaît ; la ligne du bas prend sa place avec les références, encadrée en
  // rouge sur toute case où l'ordre était faux.
  $('chrono-source-row').classList.add('hidden');
  slots.forEach((slot, i) => {
    const work = playerOrder[i];
    const meta = [work.date, work.location].filter(Boolean).join(' — ');
    slot.classList.remove('filled');
    slot.classList.add(rightFlags[i] ? 'right' : 'wrong');
    slot.innerHTML = `<span class="chrono-slot-num">${i + 1}</span><img src="${escapeHtml(imageSource(work.image))}" alt="" />
      <span class="fam-result-caption" style="position:absolute;bottom:-58px;left:0;right:0;">
        <strong>${escapeHtml(work.artist)}</strong><em>« ${escapeHtml(work.title)} »</em><br>${escapeHtml(meta)}
      </span>`;
    slot.style.position = 'relative';
    slot.style.marginBottom = '58px';
  });

  // S'il y a eu une erreur, un second tableau montre le bon ordre (images + références).
  if (!isCorrect) {
    $('chrono-correct-table').classList.remove('hidden');
    $('chrono-correct-table').innerHTML = `<p class="modal-subheading" style="margin:70px 0 8px;">Le bon ordre était :</p>
      <div class="fam-result-grid">${correctOrder.map((work) => {
        const meta = [work.date, work.location].filter(Boolean).join(' — ');
        return `<div class="fam-result-item">
          <img src="${escapeHtml(imageSource(work.image))}" alt="" />
          <span class="fam-result-caption"><strong>${escapeHtml(work.artist)}</strong><em>« ${escapeHtml(work.title)} »</em><br>${escapeHtml(meta)}</span>
        </div>`;
      }).join('')}</div>`;
  }

  const ordinals = ['La première', 'La deuxième', 'La troisième', 'La quatrième'];
  const list = correctOrder.map((w, i) => `${ordinals[i]}, ${w.title}, en ${chronoYearOf(w)}`).join('. ');
  famSpeak2(`${isCorrect ? 'Exact.' : 'À réviser.'} Voici l'ordre chronologique. ${list}.`);

  $('chrono-correction').classList.remove('hidden');
  $('chrono-next-button').textContent = chronoIndex === CHRONO_SESSION.length - 1 ? 'Terminer' : 'Suivant →';
});

$('chrono-next-button')?.addEventListener('click', async () => {
  if (chronoIndex < CHRONO_SESSION.length - 1) {
    chronoIndex++;
    chronoShowQuestion();
  } else {
    if (firebaseReady && currentUser) {
      try {
        await db.collection('users').doc(currentUser.uid).collection('scores').add({
          type: 'entrainement',
          exerciseName: 'Chronologie',
          correct: chronoScore, possible: CHRONO_SESSION.length,
          percent: Math.round((chronoScore / CHRONO_SESSION.length) * 100),
          questionCount: CHRONO_SESSION.length,
          quizLabel: 'Chronologie',
          quizLevel: chronoSelectedLevels().map((lvl) => `Niveau ${lvl}`).join(' + '),
          quizArts: chronoSelectedArts(), quizCenturies: chronoSelectedCenturies(),
          timeSpent: chronoTimer.stop(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { /* enregistrement du score best-effort */ }
    } else {
      chronoTimer.stop();
    }
    showPanel('chrono-setup');
  }
});

// ============================================================
// MODULE ÉNIGME — artiste/date/lieu donnés d'emblée (titre caché) ; deux éléments à retrouver
// par œuvre parmi : personnages (cercles lettrés), événement (QCM), interprétation (QCM).
// Données de démonstration en dur ci-dessous, en attendant un fichier « -enigme.xlsx » réel
// (même principe de lecture que les autres modules à brancher plus tard, clé = lien d'image).
// ============================================================
const ENIGME_DEMO_DATA = [
  {
    century: '19e', artist: 'Théodore Géricault', date: '1818-1819', location: 'Musée du Louvre, Paris',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/JEAN%20LOUIS%20THEODORE%20GERICAULT%20-%20La%20Balsa%20de%20la%20Medusa%20(Museo%20del%20Louvre,%201818-19).jpg?width=700',
    items: [
      { type: 'personnages', people: [
        { letter: 'A', x: 20, y: 78, name: 'Un survivant épuisé' },
        { letter: 'B', x: 78, y: 22, name: 'Le marin agitant un linge' },
      ] },
      { type: 'evenement', question: "Quel événement réel a inspiré cette scène ?", options: ["Le naufrage de la frégate La Méduse (1816)", "La bataille de Trafalgar", "Le naufrage du Titanic"], correctIndex: 0 },
    ],
  },
  {
    century: '19e', artist: 'Eugène Delacroix', date: '1830', location: 'Musée du Louvre, Paris',
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Eug%C3%A8ne%20Delacroix%20-%20La%20libert%C3%A9%20guidant%20le%20peuple.jpg?width=700',
    items: [
      { type: 'personnages', people: [
        { letter: 'A', x: 45, y: 30, name: 'La Liberté (figure allégorique)' },
        { letter: 'B', x: 60, y: 55, name: 'Un gamin de Paris (le futur Gavroche)' },
      ] },
      { type: 'interpretation', question: "Que symbolise la figure féminine au centre du tableau ?", options: ["La République et la Liberté", "La Vierge Marie", "La Victoire militaire"], correctIndex: 0 },
    ],
  },
];

// Position approximative (en % de l'image) pour chacune des 6 zones fixes utilisées dans le
// fichier -enigme.xlsx (colonnes « Personnage A Haut/gauche » etc.).
const ENIG_POSITIONS = {
  A: { x: 25, y: 25 }, B: { x: 25, y: 75 }, C: { x: 50, y: 25 },
  D: { x: 50, y: 75 }, E: { x: 75, y: 25 }, F: { x: 75, y: 75 },
};
function enigImageKey(url) {
  // Clé de correspondance entre le fichier principal et le fichier -enigme : le nom de fichier
  // Wikimedia, indépendamment du domaine ou des paramètres d'URL (utm_source, width, etc.).
  const m = String(url || '').match(/[^/]+\.(jpg|jpeg|png|gif|tif|tiff)/i);
  return m ? decodeURIComponent(m[0]).toLowerCase() : '';
}
async function fetchEnigmeRows(art, century) {
  const [mainRows, enigResponse] = await Promise.all([
    fetchQuizRows(art, century).catch(() => []),
    fetch(`quizzes/${art}-${century}-enigme.xlsx`),
  ]);
  if (!enigResponse.ok) throw new Error('fichier énigme introuvable');
  const buffer = await enigResponse.arrayBuffer();
  const book = XLSX.read(buffer, { type: 'array' });
  const raw = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: '' });

  const mainByKey = new Map();
  mainRows.forEach((r) => { const k = enigImageKey(r.image); if (k) mainByKey.set(k, r); });

  const results = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || !r[0]) continue;
    const key = enigImageKey(r[0]);
    const mainRow = mainByKey.get(key);
    // Sans correspondance dans le fichier principal, on ne connaît ni date ni lieu : on ignore
    // cette ligne plutôt que d'afficher une référence incomplète.
    if (!mainRow) continue;

    const people = [];
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach((letter, idx) => {
      const name = String(r[3 + idx] || '').trim();
      if (name) people.push({ letter, name, ...ENIG_POSITIONS[letter] });
    });
    const evenement = String(r[9] || '').trim();
    const evFaux1 = String(r[10] || '').trim(), evFaux2 = String(r[11] || '').trim();
    const interpretation = String(r[12] || '').trim();
    const intFaux1 = String(r[13] || '').trim(), intFaux2 = String(r[14] || '').trim();

    const availableTypes = [];
    if (people.length) availableTypes.push({ type: 'personnages', people });
    if (evenement && evFaux1 && evFaux2) availableTypes.push({ type: 'evenement', question: 'Quel événement représente cette œuvre ?', options: [evenement, evFaux1, evFaux2], correctIndex: 0 });
    if (interpretation && intFaux1 && intFaux2) availableTypes.push({ type: 'interpretation', question: "Quelle est l'interprétation de cette œuvre ?", options: [interpretation, intFaux1, intFaux2], correctIndex: 0 });

    // Une seule question par œuvre désormais : au moins 1 type disponible suffit.
    if (availableTypes.length < 1) continue;
    const shuffledTypes = availableTypes.slice().sort(() => Math.random() - 0.5);
    const chosenItems = shuffledTypes.slice(0, 1).map((it) => {
      if (it.type !== 'evenement' && it.type !== 'interpretation') return it;
      // Mélange l'ordre des 3 options QCM tout en gardant trace du bon index.
      const opts = it.options.map((opt, idx) => ({ opt, idx })).sort(() => Math.random() - 0.5);
      return { ...it, options: opts.map((o) => o.opt), correctIndex: opts.findIndex((o) => o.idx === 0) };
    });

    results.push({
      century, artist: mainRow.artist, date: mainRow.date, location: mainRow.location,
      image: mainRow.image, items: chosenItems,
    });
  }
  return results;
}

$('open-enigme-setup')?.addEventListener('click', () => { showPanel('enigme-setup'); populateEnigVoices(); speakObjective('enig'); restoreLastSelection('enigme-setup-panel'); });
$('enigme-setup-back-button')?.addEventListener('click', () => showPanel('training-hub'));
$('enig-exit-link')?.addEventListener('click', () => { speechSynthesis.cancel(); showPanel('enigme-setup'); });
$('enig-scores-link')?.addEventListener('click', () => { speechSynthesis.cancel(); returnToExercisePanel = 'enigme'; showPanel('account'); loadAccountPage(); });
$('enig-setup-scores-link')?.addEventListener('click', () => { returnToExercisePanel = null; showPanel('account'); loadAccountPage(); });

function populateEnigVoices() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('fr'));
  const select = $('enig-opt-voice');
  if (!select) return;
  select.innerHTML = voices.length
    ? voices.map((v, i) => `<option value="${i}">${v.name}</option>`).join('')
    : '<option value="">Voix par défaut du système</option>';
}

const ENIG_ACCORDIONS = ['enig-toggle-art:enig-body-art', 'enig-toggle-century:enig-body-century', 'enig-toggle-count:enig-body-count'];
ENIG_ACCORDIONS.forEach((pair) => {
  const [toggleId, bodyId] = pair.split(':');
  $(toggleId)?.addEventListener('click', () => {
    const opening = $(bodyId).classList.contains('hidden');
    ENIG_ACCORDIONS.forEach((p) => $(p.split(':')[1])?.classList.add('hidden'));
    if (opening) $(bodyId).classList.remove('hidden');
  });
});

function enigSelectedCenturies() { return ['15e', '16e', '17e', '18e', '19e'].filter((c) => $(`enig-century-${c}`)?.checked); }
function enigSelectedArts() { return ['peinture', 'sculpture'].filter((a) => $(`enig-art-${a}`)?.checked); }

let ENIG_SESSION = [], enigIndex = 0, enigScore = 0, enigAnswered = false, enigAudioOn = true, enigSelectedVoiceRef = null;
const enigTimer = createTimer('enig-timer');
function enigSpeak(text) {
  if (!enigAudioOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR'; u.rate = 0.85;
  if (enigSelectedVoiceRef) u.voice = enigSelectedVoiceRef;
  speechSynthesis.speak(u);
}

$('enig-start-button')?.addEventListener('click', async () => {
  handleExtendAndRemember('enig', 'enigme-setup-panel');
  saveLastSelection('enigme-setup-panel');
  const arts = enigSelectedArts();
  const centuries = enigSelectedCenturies();
  const feedback = $('enig-setup-feedback');
  feedback.classList.remove('hidden');
  feedback.textContent = 'Chargement des énigmes…';
  enigAudioOn = getGlobalPrefs().audioOn;
  enigSelectedVoiceRef = getGlobalVoice();
  const countChoice = Number(document.querySelector('input[name="enig-count"]:checked').value);

  // Essaie d'abord les vrais fichiers -enigme.xlsx (un par art/siècle) ; si aucun n'est encore
  // en ligne, se rabat sur les énigmes de démonstration pour ne pas bloquer le test de l'appli.
  let available = [];
  for (const art of arts) {
    for (const century of centuries) {
      try { available.push(...(await fetchEnigmeRows(art, century))); } catch (e) { /* fichier pas encore en ligne, ignoré */ }
    }
  }
  let usingDemo = false;
  if (!available.length) {
    available = ENIGME_DEMO_DATA.filter((e) => centuries.includes(e.century))
      .map((e) => ({ ...e, items: [e.items[Math.floor(Math.random() * e.items.length)]] }));
    usingDemo = true;
  }
  if (!available.length) { feedback.textContent = "Aucune énigme disponible pour ce choix — essayez 19e siècle (démonstration) ou vérifiez que le fichier -enigme.xlsx est bien en ligne."; return; }

  for (let i = available.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [available[i], available[j]] = [available[j], available[i]]; }
  ENIG_SESSION = [];
  for (let i = 0; i < countChoice; i++) ENIG_SESSION.push(available[i % available.length]);
  feedback.classList.add('hidden');
  if (usingDemo) { feedback.classList.remove('hidden'); feedback.textContent = 'Mode démonstration (fichier -enigme.xlsx non trouvé en ligne).'; }
  enigIndex = 0; enigScore = 0;
  showPanel('enigme');
  enigTimer.start();
  enigShowQuestion();
});

function enigShowQuestion() {
  speechSynthesis.cancel();
  enigAnswered = false;
  const q = ENIG_SESSION[enigIndex];
  $('enig-progress-label').textContent = `Question ${enigIndex + 1} / ${ENIG_SESSION.length}`;
  $('enig-progress-bar').style.width = `${(enigIndex / ENIG_SESSION.length) * 100}%`;
  $('enig-score-label').textContent = `${enigScore} point${enigScore > 1 ? 's' : ''}`;
  $('enig-correction').classList.add('hidden');
  $('enig-validate-button').classList.remove('hidden');
  $('enig-validate-button').disabled = false;

  $('enig-stage-img').src = imageSource(q.image);
  const personnagesItem = q.items.find((it) => it.type === 'personnages');
  $('enig-image-wrap').querySelectorAll('.enig-circle').forEach((c) => c.remove());
  if (personnagesItem) {
    // Les cercles sont positionnés une fois l'image chargée, pour connaître ses dimensions réelles.
    const img = $('enig-stage-img');
    const placeCircles = () => {
      $('enig-image-wrap').querySelectorAll('.enig-circle').forEach((c) => c.remove());
      personnagesItem.people.forEach((p) => {
        const circle = document.createElement('div');
        circle.className = 'enig-circle';
        circle.style.left = `${p.x}%`;
        circle.style.top = `${p.y}%`;
        circle.style.width = '52px';
        circle.style.height = '52px';
        circle.innerHTML = `<span>${p.letter}</span>`;
        $('enig-image-wrap').appendChild(circle);
      });
    };
    if (img.complete) placeCircles(); else img.onload = placeCircles;
  }

  $('enig-header-details').innerHTML = [
    ['Artiste', q.artist], ['Date', q.date], ['Lieu', q.location],
  ].map(([label, val]) => `<span class="correction-label">${label}</span><span class="correction-value">${escapeHtml(val)}</span>`).join('');
  enigSpeak(`Ce tableau est de ${q.artist}. Il date de ${q.date} et est conservé à ${q.location}. Trouvez les éléments suivants.`);

  $('enig-items').innerHTML = q.items.map((item, itemIdx) => {
    if (item.type === 'personnages') {
      return `<div class="enig-item" data-item="${itemIdx}">
        <div class="enig-item-title">Personnages</div>
        ${item.people.map((p) => `<div class="enig-person-row" data-letter="${p.letter}">
          <span class="enig-letter">${p.letter}</span>
          <input type="text" class="enig-person-input" data-letter="${p.letter}" placeholder="Qui est-ce ?" />
          <button type="button" class="mic-icon-button enig-person-mic" data-letter="${p.letter}" aria-label="Dicter la réponse">🎤</button>
        </div>`).join('')}
      </div>`;
    }
    // QCM (événement ou interprétation) : la voix ne lira que la question, pas les options.
    const label = item.type === 'evenement' ? 'Événement' : 'Interprétation';
    const shuffledOptions = item.options.map((opt, i) => ({ opt, i })).sort(() => Math.random() - 0.5);
    return `<div class="enig-item" data-item="${itemIdx}">
      <div class="enig-item-title">${label}</div>
      <p class="enig-qcm-question">${escapeHtml(item.question)}</p>
      ${shuffledOptions.map(({ opt, i }) => `<button type="button" class="enig-qcm-option" data-item="${itemIdx}" data-option="${i}">${escapeHtml(opt)}</button>`).join('')}
    </div>`;
  }).join('');

  document.querySelectorAll('.enig-person-mic').forEach((btn) => {
    const input = document.querySelector(`.enig-person-input[data-letter="${btn.dataset.letter}"]`);
    attachSimpleMic(btn, input);
  });

  document.querySelectorAll('.enig-qcm-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const itemIdx = btn.dataset.item;
      document.querySelectorAll(`.enig-qcm-option[data-item="${itemIdx}"]`).forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // La voix lit chaque question de QCM (sans les propositions), après le message d'ouverture.
  q.items.forEach((item, i) => {
    if (item.type !== 'personnages') {
      setTimeout(() => enigSpeak(item.question), 4500 + i * 3500);
    }
  });
}

$('enig-validate-button')?.addEventListener('click', () => {
  if (enigAnswered) return;
  enigAnswered = true;
  const q = ENIG_SESSION[enigIndex];
  $('enig-validate-button').disabled = true;
  document.querySelectorAll('.enig-person-input').forEach((inp) => { inp.disabled = true; });
  document.querySelectorAll('.enig-qcm-option').forEach((btn) => { btn.disabled = true; });

  // Tout ou rien sur les deux éléments de la question, comme les autres exercices.
  let allCorrect = true;
  const spokenParts = [];

  q.items.forEach((item, itemIdx) => {
    if (item.type === 'personnages') {
      let itemOk = true;
      item.people.forEach((p) => {
        const input = document.querySelector(`.enig-person-input[data-letter="${p.letter}"]`);
        const given = famNormalize(input ? input.value : '');
        const correct = famNormalize(p.name);
        const ok = given && (correct.includes(given) || given.includes(correct));
        if (!ok) itemOk = false;
        const row = input.closest('.enig-person-row');
        const verdict = document.createElement('span');
        verdict.className = 'enig-person-verdict';
        verdict.style.color = ok ? 'var(--ok)' : 'var(--wrong)';
        verdict.textContent = ok ? 'Exact' : 'À réviser';
        row.appendChild(verdict);
        if (!ok) {
          const note = document.createElement('span');
          note.className = 'enig-correct-note';
          note.textContent = `Bonne réponse : ${p.name}`;
          row.appendChild(note);
        }
        spokenParts.push(`Dans le cercle ${p.letter}, on voyait ${p.name}.`);
      });
      if (!itemOk) allCorrect = false;
    } else {
      const selected = document.querySelector(`.enig-qcm-option[data-item="${itemIdx}"].selected`);
      const selectedIndex = selected ? Number(selected.dataset.option) : -1;
      const ok = selectedIndex === item.correctIndex;
      if (!ok) allCorrect = false;
      document.querySelectorAll(`.enig-qcm-option[data-item="${itemIdx}"]`).forEach((btn) => {
        const optIndex = Number(btn.dataset.option);
        if (optIndex === item.correctIndex) btn.classList.add('correct');
        else if (btn === selected) btn.classList.add('wrong');
      });
      spokenParts.push(`La bonne réponse était : ${item.options[item.correctIndex]}.`);
    }
  });

  const pointEarned = allCorrect ? 1 : 0;
  enigScore = Math.round((enigScore + pointEarned) * 10) / 10;
  $('enig-score-label').textContent = `${enigScore} point${enigScore > 1 ? 's' : ''}`;
  enigSpeak(spokenParts.join(' '));

  $('enig-correction').classList.remove('hidden');
  $('enig-next-button').textContent = enigIndex === ENIG_SESSION.length - 1 ? 'Terminer' : 'Suivant →';
});

$('enig-next-button')?.addEventListener('click', async () => {
  if (enigIndex < ENIG_SESSION.length - 1) {
    enigIndex++;
    enigShowQuestion();
  } else {
    if (firebaseReady && currentUser) {
      try {
        await db.collection('users').doc(currentUser.uid).collection('scores').add({
          type: 'entrainement',
          exerciseName: 'Énigme',
          timeSpent: enigTimer.stop(),
          correct: enigScore, possible: ENIG_SESSION.length,
          percent: Math.round((enigScore / ENIG_SESSION.length) * 100),
          questionCount: ENIG_SESSION.length,
          quizLabel: 'Énigme',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { /* enregistrement best-effort */ }
    }
    showPanel('enigme-setup');
    const feedback = $('enig-setup-feedback');
    feedback.classList.remove('hidden');
    feedback.textContent = `Terminé : ${enigScore} points sur ${ENIG_SESSION.length} questions.`;
  }
});

function populateFamVoices() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('fr'));
  const select = $('fam-opt-voice');
  if (!select) return;
  select.innerHTML = voices.length
    ? voices.map((v, i) => `<option value="${i}">${v.name}</option>`).join('')
    : '<option value="">Voix par défaut du système</option>';
}

const FAM_ACCORDIONS = ['fam-toggle-art:fam-body-art', 'fam-toggle-century:fam-body-century', 'fam-toggle-level:fam-body-level', 'fam-toggle-types:fam-body-types', 'fam-toggle-count:fam-body-count'];
FAM_ACCORDIONS.forEach((pair) => {
  const [toggleId, bodyId] = pair.split(':');
  $(toggleId)?.addEventListener('click', () => {
    const opening = $(bodyId).classList.contains('hidden');
    FAM_ACCORDIONS.forEach((p) => $(p.split(':')[1])?.classList.add('hidden'));
    if (opening) $(bodyId).classList.remove('hidden');
  });
});

function famSelectedArts() { return ['peinture', 'sculpture'].filter((a) => $(`fam-art-${a}`)?.checked); }
function famSelectedCenturies() { return ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].filter((c) => $(`fam-century-${c}`)?.checked); }
function famSelectedZones() { return ['france', 'europe', 'amerique', 'asie'].filter((z) => $(`fam-zone-${z}`)?.checked); }
function famSelectedLevels() { return ['1', '2', '3'].filter((lvl) => $(`fam-level-${lvl}`)?.checked); }
function famSelectedTypes() {
  const map = { artist: 'fam-type-artist', word: 'fam-type-word', century: 'fam-type-century', museum: 'fam-type-museum' };
  return Object.keys(map).filter((t) => $(map[t])?.checked);
}
const FAM_TYPE_LABELS = { artist: 'Artiste', word: 'Mot commun dans les titres', century: 'Siècle', museum: 'Musée / lieu' };

function famNormalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[«»"',.]/g, '').trim();
}
function famAnswerMatches(input, correct, type) {
  const a = famNormalize(input);
  // Pour l'artiste, seul le nom de famille compte (le prénom est ignoré, comme dans le quiz).
  const correctForCompare = type === 'artist' ? String(correct || '').trim().split(/\s+/).pop() : correct;
  const b = famNormalize(correctForCompare);
  if (!a) return false;
  if (a === b || b.includes(a) || a.includes(b)) return true;
  // Tolérance spécifique aux siècles : « 18 », « 18e », « 18eme », avec ou sans « siecle »,
  // doivent tous valider pour « 18e siecle ».
  const stripCentury = (s2) => s2.replace(/\bsiecles?\b/g, '').replace(/eme\b|e\b/g, '').replace(/\s+/g, '').trim();
  const na = stripCentury(a), nb = stripCentury(b);
  return na && na === nb;
}

// Cherche, pour un type donné, un groupe de 4 œuvres partageant un trait commun, avec assez
// d'œuvres différentes en dehors du groupe pour servir d'intrus.
function famFindGroup(type, pool, distractorCount, familySize) {
  familySize = familySize || 4;
  if (type === 'artist') {
    const byArtist = new Map();
    pool.forEach((r) => { if (!byArtist.has(r.artist)) byArtist.set(r.artist, []); byArtist.get(r.artist).push(r); });
    const candidates = [...byArtist.entries()].filter(([, works]) => works.length >= familySize && pool.length - works.length >= distractorCount);
    if (!candidates.length) return null;
    const [artist, works] = candidates[Math.floor(Math.random() * candidates.length)];
    const shuffled = works.slice().sort(() => Math.random() - 0.5);
    const family = shuffled.slice(0, familySize);
    // Les intrus ne doivent pas partager le même siècle que la famille : sinon « tel siècle »
    // serait aussi une réponse juste, mais refusée puisqu'on cherche l'artiste.
    const familyCenturies = new Set(family.map((r) => r.century || detectCenturyFromDate(r.date)));
    const otherCentury = pool.filter((r) => r.artist !== artist && !familyCenturies.has(r.century || detectCenturyFromDate(r.date)));
    const outsiders = otherCentury.length >= distractorCount ? otherCentury : pool.filter((r) => r.artist !== artist);
    return { family, answer: artist, outsiders };
  }
  if (type === 'century') {
    const byCentury = new Map();
    pool.forEach((r) => { const c = r.century || detectCenturyFromDate(r.date); if (c) { if (!byCentury.has(c)) byCentury.set(c, []); byCentury.get(c).push(r); } });
    const candidates = [...byCentury.entries()].filter(([, works]) => works.length >= 4 && pool.length - works.length >= distractorCount);
    if (!candidates.length) return null;
    const [century, works] = candidates[Math.floor(Math.random() * candidates.length)];
    const shuffled = works.slice().sort(() => Math.random() - 0.5);
    return { family: shuffled.slice(0, 4), answer: `${century} siècle`, outsiders: pool.filter((r) => (r.century || detectCenturyFromDate(r.date)) !== century) };
  }
  if (type === 'museum') {
    const byPlace = new Map();
    pool.forEach((r) => { if (r.location) { if (!byPlace.has(r.location)) byPlace.set(r.location, []); byPlace.get(r.location).push(r); } });
    const candidates = [...byPlace.entries()].filter(([, works]) => works.length >= 4 && pool.length - works.length >= distractorCount);
    if (!candidates.length) return null;
    const [place, works] = candidates[Math.floor(Math.random() * candidates.length)];
    const shuffled = works.slice().sort(() => Math.random() - 0.5);
    return { family: shuffled.slice(0, 4), answer: place, outsiders: pool.filter((r) => r.location !== place) };
  }
  if (type === 'word') {
    const byWord = new Map();
    pool.forEach((r) => {
      intrusTitleWords(r.title).forEach((w) => { if (!byWord.has(w)) byWord.set(w, []); byWord.get(w).push(r); });
    });
    const candidates = [...byWord.entries()].filter(([, works]) => works.length >= 4 && pool.length - works.length >= distractorCount);
    if (!candidates.length) return null;
    const [word, works] = candidates[Math.floor(Math.random() * candidates.length)];
    const shuffled = works.slice().sort(() => Math.random() - 0.5);
    return { family: shuffled.slice(0, 4), answer: word, outsiders: pool.filter((r) => !works.includes(r)) };
  }
  return null;
}
function detectCenturyFromDate(dateStr) {
  const m = String(dateStr || '').match(/\b(1[3-9]|20)\d{2}\b/);
  if (!m) return null;
  const year = Number(m[0]);
  return `${Math.floor((year - 1) / 100) + 1}e`;
}

let FAM_SESSION = [], famIndex = 0, famScore = 0, famAnswered = false, famAudioOn = true, famSelectedVoiceRef = null, famSelectedImages = [], famStep = 1, famTimers = [], famPickedLabel = null;
const famTimer = createTimer('fam-timer');
function famSpeak(text, onEnd) {
  if (!famAudioOn || !window.speechSynthesis) { if (onEnd) onEnd(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR'; u.rate = 0.85;
  if (famSelectedVoiceRef) u.voice = famSelectedVoiceRef;
  if (onEnd) {
    let done = false;
    const finish = () => { if (!done) { done = true; onEnd(); } };
    u.onend = finish; u.onerror = finish;
    const estimatedMs = Math.max(1200, (text.length / 13) * 1000) + 400;
    famTimers.push(setTimeout(finish, estimatedMs));
  }
  speechSynthesis.speak(u);
}

$('fam-start-button')?.addEventListener('click', async () => {
  handleExtendAndRemember('fam', 'famille-setup-panel');
  saveLastSelection('famille-setup-panel');
  let arts = famSelectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = famSelectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  let levels = famSelectedLevels(); if (!levels.length) levels = ['1','2','3'];
  const feedback = $('fam-setup-feedback');
  feedback.classList.remove('hidden');
  feedback.textContent = 'Chargement des œuvres…';
  try {
    const zones = famSelectedZones();
    let allRows = [];
    for (const art of arts) {
      for (const century of centuries) {
        try {
          const rows = await fetchQuizRows(art, century);
          rows.forEach((r) => { r.century = century; });
          allRows.push(...rows);
        } catch (e) { /* fichier absent, ignoré */ }
      }
    }
    if (allRows.length < 8) { feedback.textContent = "Pas assez d'œuvres disponibles pour ce choix (8 minimum)."; return; }
    let pool = allRows.filter((r) => levels.includes(String(r.niveau || 1)));
    if (pool.length < 8) pool = allRows;
    if (zones.length) {
      const zoned = pool.filter((r) => { const z = zoneOfNationality(r.nationality); return !z || zones.includes(z); });
      if (zoned.length >= 8) pool = zoned;
    }
    famAudioOn = getGlobalPrefs().audioOn;
    famSelectedVoiceRef = getGlobalVoice();
    const countChoice = document.querySelector('input[name="fam-count"]:checked').value;
    const count = Number(countChoice);
    const imgCountChoice = Number(document.querySelector('input[name="fam-images"]:checked').value);
    // La moitié des images ont le point commun (règle simple, quel que soit le nombre choisi).
    const familySize = imgCountChoice / 2;
    const distractorCount = imgCountChoice - familySize;

    const questions = [];
    let attempts = 0;
    while (questions.length < count && attempts < count * 15) {
      attempts++;
      const group = famFindGroup('artist', pool, distractorCount, familySize);
      if (!group) continue;
      const distractors = group.outsiders.slice().sort(() => Math.random() - 0.5).slice(0, distractorCount);
      if (distractors.length < distractorCount) continue;
      const images = group.family.concat(distractors).sort(() => Math.random() - 0.5);
      questions.push({ family: group.family, artist: group.answer, images, imgCount: imgCountChoice });
    }
    if (!questions.length) { feedback.textContent = "Impossible de constituer un exercice avec ces critères — essayez d'élargir le choix (plus de siècles, plus de niveaux)."; return; }
    FAM_SESSION = questions;
    famIndex = 0; famScore = 0;
    showPanel('famille');
    famTimer.start();
    famShowQuestion();
  } catch (error) {
    feedback.textContent = `Erreur : ${error.message}`;
  }
});

function famNumberWord(n) {
  const words = { 2: 'deux', 3: 'trois', 4: 'quatre', 5: 'cinq', 6: 'six' };
  return words[n] || String(n);
}
function famShowQuestion() {
  speechSynthesis.cancel();
  famTimers.forEach(clearTimeout); famTimers = [];
  famAnswered = false;
  famSelectedImages = [];
  famStep = 0;
  famPickedLabel = null;
  const q = FAM_SESSION[famIndex];
  $('fam-progress-label').textContent = `Question ${famIndex + 1} / ${FAM_SESSION.length}`;
  $('fam-score-label').textContent = `${famScore} point${famScore > 1 ? 's' : ''}`;
  $('fam-progress-bar').style.width = `${(famIndex / FAM_SESSION.length) * 100}%`;
  $('fam-correction').classList.add('hidden');
  $('fam-step0').classList.remove('hidden');
  $('fam-validate-selection-button').disabled = false;

  $('fam-image-grid').className = `fam-image-grid${q.imgCount === 6 ? ' fam-count-6' : ''}`;
  $('fam-image-grid').innerHTML = q.images.map((work, i) =>
    `<button type="button" class="fam-image-cell" data-index="${i}"><img src="${escapeHtml(imageSource(work.image))}" alt="" /></button>`
  ).join('');
  $('fam-image-grid').querySelectorAll('.fam-image-cell').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (famStep !== 0) return;
      const idx = Number(btn.dataset.index);
      const pos = famSelectedImages.indexOf(idx);
      if (pos >= 0) {
        famSelectedImages.splice(pos, 1);
        btn.classList.remove('selected');
        btn.removeAttribute('data-num');
        famSelectedImages.forEach((si, n) => { $('fam-image-grid').querySelector(`.fam-image-cell[data-index="${si}"]`).dataset.num = n + 1; });
      } else if (famSelectedImages.length < q.family.length) {
        famSelectedImages.push(idx);
        btn.classList.add('selected');
        btn.dataset.num = famSelectedImages.length;
      }
    });
  });

  famSpeak(`Trouve ${famNumberWord(q.family.length)} œuvres du même artiste.`);
}

$('fam-validate-selection-button')?.addEventListener('click', () => {
  const q = FAM_SESSION[famIndex];
  if (famSelectedImages.length !== q.family.length) { famStepFeedback('fam-step0', `Sélectionnez exactement ${q.family.length} œuvres avant de valider.`); return; }
  document.querySelectorAll('.fam-image-cell').forEach((btn) => { btn.disabled = true; });
  $('fam-validate-selection-button').disabled = true;

  const familyIndexes = q.images.map((w, i) => q.family.includes(w) ? i : -1).filter((i) => i >= 0);
  const selectedSet = new Set(famSelectedImages);
  const familySet = new Set(familyIndexes);
  const imagesCorrect = selectedSet.size === familySet.size && [...selectedSet].every((i) => familySet.has(i));

  const pointEarned = imagesCorrect ? 1 : 0;
  famScore = Math.round((famScore + pointEarned) * 10) / 10;
  $('fam-score-label').textContent = `${famScore} point${famScore > 1 ? 's' : ''}`;

  $('fam-verdict').textContent = imagesCorrect ? 'Exact' : 'À réviser';
  $('fam-verdict').style.color = imagesCorrect ? 'var(--ok)' : 'var(--wrong)';

  const yearOf = (w) => { const m = String(w.date || '').match(/\b(1[3-9]|20)\d{2}\b/); return m ? Number(m[0]) : 9999; };
  const chronological = q.family.slice().sort((a, b) => yearOf(a) - yearOf(b));
  const wrongSelected = famSelectedImages.map((i) => q.images[i]).filter((w) => !q.family.includes(w));
  const foundFamily = chronological.filter((w) => q.family.indexOf(w) >= 0 && famSelectedImages.includes(q.images.indexOf(w)));
  const missedFamily = chronological.filter((w) => !foundFamily.includes(w));

  const captionOf = (work) => {
    const meta = [work.date, work.location].filter(Boolean).join(' — ');
    return `<strong>${escapeHtml(work.artist)}</strong><em>« ${escapeHtml(work.title)} »</em><br>${escapeHtml(meta)}`;
  };
  const cellHtml = (work, revealed) => `<div class="fam-result-item${revealed ? '' : ' fam-result-pending'}">
      ${revealed ? `<img src="${escapeHtml(imageSource(work.image))}" alt="" /><span class="fam-result-caption">${captionOf(work)}</span>` : ''}
    </div>`;

  if (!wrongSelected.length && !missedFamily.length) {
    $('fam-image-grid').className = 'fam-result-grid';
    $('fam-image-grid').innerHTML = chronological.map((w) => cellHtml(w, true)).join('');
    const ordinals = ['La première', 'La deuxième', 'La troisième', 'La quatrième'];
    const titleList = chronological.map((w, i) => `${ordinals[i]}, ${w.title}`).join('. ');
    famSpeak(`Ces ${famNumberWord(chronological.length)} œuvres sont bien de ${q.artist}. ${titleList}.`);
  } else {
    $('fam-image-grid').className = 'fam-result-rows';
    $('fam-image-grid').innerHTML = `
      <div class="fam-result-grid" id="fam-result-top">${chronological.map(() => cellHtml(null, false)).join('')}</div>
      ${wrongSelected.length ? `<div class="fam-result-grid fam-result-row-wrong" id="fam-result-bottom"></div>` : ''}`;
    const topCells = [...document.querySelectorAll('#fam-result-top .fam-result-item')];

    function revealTop(work) {
      const idx = chronological.indexOf(work);
      topCells[idx].outerHTML = cellHtml(work, true);
    }
    function announceWrong(next) {
      if (!wrongSelected.length) { next(); return; }
      $('fam-result-bottom').innerHTML = wrongSelected.map((w) => cellHtml(w, true)).join('');
      const titles = wrongSelected.map((w) => w.title).join(', ');
      famSpeak(`Tu as fait ${famNumberWord(wrongSelected.length)} erreur${wrongSelected.length > 1 ? 's' : ''} : ${titles}.`, next);
    }
    function announceFound(next) {
      if (!foundFamily.length) { next(); return; }
      foundFamily.forEach(revealTop);
      famSpeak(`Tu avais bien repéré ${famNumberWord(foundFamily.length)} œuvre${foundFamily.length > 1 ? 's' : ''} de ${q.artist}.`, next);
    }
    function announceMissed() {
      if (!missedFamily.length) return;
      missedFamily.forEach(revealTop);
      const titles = missedFamily.map((w) => w.title).join(', ');
      famSpeak(`${missedFamily.length > 1 ? 'Les autres étaient' : "L'autre était"} : ${titles}.`);
    }
    announceWrong(() => announceFound(announceMissed));
  }

  $('fam-step0').classList.add('hidden');
  $('fam-correction').classList.remove('hidden');
  $('fam-next-button').textContent = famIndex === FAM_SESSION.length - 1 ? 'Terminer' : 'Suivant →';
});

$('fam-next-button')?.addEventListener('click', async () => {
  if (famIndex < FAM_SESSION.length - 1) {
    famIndex++;
    famShowQuestion();
  } else {
    if (firebaseReady && currentUser) {
      try {
        await db.collection('users').doc(currentUser.uid).collection('scores').add({
          type: 'entrainement',
          exerciseName: 'Famille',
          timeSpent: famTimer.stop(),
          correct: famScore, possible: FAM_SESSION.length,
          percent: Math.round((famScore / FAM_SESSION.length) * 100),
          questionCount: FAM_SESSION.length,
          quizLabel: 'Famille',
          quizLevel: famSelectedLevels().map((lvl) => `Niveau ${lvl}`).join(' + '),
          quizArts: famSelectedArts(), quizCenturies: famSelectedCenturies(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { /* enregistrement best-effort */ }
    }
    showPanel('famille-setup');
    const feedback = $('fam-setup-feedback');
    feedback.classList.remove('hidden');
    feedback.textContent = `Terminé : ${famScore} points sur ${FAM_SESSION.length} questions.`;
  }
});

function populateVfVoices() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('fr'));
  const select = $('vf-opt-voice');
  if (!select) return;
  select.innerHTML = voices.length
    ? voices.map((v, i) => `<option value="${i}">${v.name}</option>`).join('')
    : '<option value="">Voix par défaut du système</option>';
}

function vfSelectedArts() { return ['peinture', 'sculpture'].filter((a) => $(`vf-art-${a}`)?.checked); }
function vfSelectedCenturies() { return ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].filter((c) => $(`vf-century-${c}`)?.checked); }
function vfSelectedZones() { return ['france', 'europe', 'amerique', 'asie'].filter((z) => $(`vf-zone-${z}`)?.checked); }
function vfSelectedLevels() { return ['1', '2', '3'].filter((lvl) => $(`vf-level-${lvl}`)?.checked); }

function vfActiveFields() {
  const all = [
    { key: 'artist', label: 'Auteur' },
    { key: 'title', label: 'Titre de l\u2019œuvre' },
    { key: 'date', label: 'Date' },
    { key: 'materials', label: 'Matériau' },
    { key: 'dimensions', label: 'Dimensions' },
    { key: 'location', label: 'Lieu' },
  ];
  const checkboxMap = { artist: 'vf-field-artist', title: 'vf-field-title', date: 'vf-field-date', materials: 'vf-field-materiaux', dimensions: 'vf-field-dimensions', location: 'vf-field-location' };
  const filtered = all.filter((f) => $(checkboxMap[f.key])?.checked);
  return filtered.length ? filtered : all;
}
function vfFieldValue(row, key) {
  if (key === 'dimensions') return formatDimensionsPlainText(row) || [row.hauteur, row.longueur].filter(Boolean).join(' × ');
  if (key === 'materials') return row.materialsPhrase || row.materials || '';
  return row[key] || '';
}

let VF_SESSION = [], vfIndex = 0, vfScore = 0, vfAnswered = false, vfAudioOn = true, vfSelectedVoiceRef = null, vfTimers = [];
const vfTimer = createTimer('vf-timer');
function vfSpeak(text, onEnd) {
  if (!vfAudioOn || !window.speechSynthesis) { if (onEnd) onEnd(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR'; u.rate = 0.85;
  if (vfSelectedVoiceRef) u.voice = vfSelectedVoiceRef;
  if (onEnd) {
    // Filet de sécurité : certains navigateurs ne déclenchent pas toujours onend de façon
    // fiable. On estime la durée de lecture (≈ 13 caractères/seconde à ce débit) et on force
    // la suite si l'événement tarde trop, plutôt que de rester bloqué ou de chevaucher.
    let done = false;
    const finish = () => { if (!done) { done = true; onEnd(); } };
    u.onend = finish; u.onerror = finish;
    const estimatedMs = Math.max(1200, (text.length / 13) * 1000) + 400;
    vfTimers.push(setTimeout(finish, estimatedMs));
  }
  speechSynthesis.speak(u);
}

$('vf-start-button')?.addEventListener('click', async () => {
  handleExtendAndRemember('vf', 'vraifaux-setup-panel');
  saveLastSelection('vraifaux-setup-panel');
  let arts = vfSelectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = vfSelectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  let levels = vfSelectedLevels(); if (!levels.length) levels = ['1','2','3'];
  const feedback = $('vf-setup-feedback');
  feedback.classList.remove('hidden');
  feedback.textContent = 'Chargement des œuvres…';
  try {
    const zones = vfSelectedZones();
    let allRows = [];
    for (const art of arts) {
      for (const century of centuries) {
        try {
          const rows = await fetchQuizRows(art, century);
          rows.forEach((r) => { r.artType = art; });
          allRows.push(...rows);
        } catch (e) { /* fichier absent, ignoré */ }
      }
    }
    if (allRows.length < 2) { feedback.textContent = "Pas assez d'œuvres disponibles pour ce choix (2 minimum)."; return; }
    let pool = allRows.filter((r) => levels.includes(String(r.niveau || 1)));
    if (pool.length < 2) pool = allRows;
    if (zones.length) {
      const zoned = pool.filter((r) => { const z = zoneOfNationality(r.nationality); return !z || zones.includes(z); });
      if (zoned.length >= 2) pool = zoned;
    }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const countChoice = document.querySelector('input[name="vf-count"]:checked').value;
    const count = countChoice === 'max' ? pool.length : Math.min(Number(countChoice), pool.length);
    vfAudioOn = getGlobalPrefs().audioOn;
    vfSelectedVoiceRef = getGlobalVoice();
    const activeFields = vfActiveFields();
    if (!activeFields.length) { feedback.textContent = 'Choisissez au moins une rubrique.'; return; }
    VF_SESSION = pool.slice(0, count).map((correct) => {
      const hasError = Math.random() < 0.5;
      let errorFields = [];
      const displayed = {};
      activeFields.forEach((f) => { displayed[f.key] = vfFieldValue(correct, f.key) || '—'; });
      if (hasError) {
        const nbErrors = activeFields.length > 1 && Math.random() < 0.5 ? 2 : 1; // jamais plus de deux erreurs
        const shuffledFields = activeFields.slice().sort(() => Math.random() - 0.5);
        errorFields = shuffledFields.slice(0, nbErrors).map((f) => f.key);
        // La correction doit toujours descendre dans l'ordre des rubriques (Auteur d'abord s'il
        // est concerné, puis Titre, Date, etc.) : on retrie après le tirage au sort aléatoire.
        errorFields.sort((a, b) => activeFields.findIndex((f) => f.key === a) - activeFields.findIndex((f) => f.key === b));
        errorFields.forEach((key) => {
          const others = pool.filter((r) => r !== correct && vfFieldValue(r, key));
          if (others.length) displayed[key] = vfFieldValue(others[Math.floor(Math.random() * others.length)], key);
        });
      }
      return { correct, hasError, errorFields, displayed, activeFields };
    });
    vfIndex = 0; vfScore = 0;
    showPanel('vraifaux');
    vfTimer.start();
    vfShowQuestion();
  } catch (error) {
    feedback.textContent = `Erreur : ${error.message}`;
  }
});

function vfShowQuestion() {
  speechSynthesis.cancel();
  vfTimers.forEach(clearTimeout); vfTimers = [];
  vfAnswered = false;
  const q = VF_SESSION[vfIndex];
  $('vf-progress-label').textContent = `Question ${vfIndex + 1} / ${VF_SESSION.length}`;
  $('vf-progress-bar').style.width = `${(vfIndex / VF_SESSION.length) * 100}%`;
  $('vf-score-label').textContent = `${vfScore} point${Math.abs(vfScore) >= 2 ? 's' : ''}`;
  $('vf-correction').classList.add('hidden');
  $('vf-validate-button').classList.remove('hidden');
  $('vf-validate-button').disabled = false;
  $('vf-stage-img').src = imageSource(q.correct.image);

  // Chaque rubrique a son propre bouton Vrai/Faux, réglé sur Vrai par défaut.
  $('vf-field-rows').innerHTML = q.activeFields.map((f) => {
    const isTitle = f.key === 'title';
    const shown = isTitle ? `« ${q.displayed[f.key]} »` : q.displayed[f.key];
    const shownHtml = isTitle ? `<em>${escapeHtml(shown)}</em>` : escapeHtml(shown);
    return `<div class="vf-field-row" data-key="${f.key}">
      <span class="vf-field-label">${f.label}</span>
      <span class="vf-field-value" id="vf-value-${f.key}">${shownHtml}</span>
      <div class="vf-toggle" data-key="${f.key}">
        <button type="button" class="active" data-val="true">Vrai</button>
        <button type="button" data-val="false">Faux</button>
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll('.vf-toggle').forEach((toggle) => {
    toggle.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggle.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  });

  const spokenText = q.activeFields.map((f) => f.key === 'title' ? `« ${q.displayed[f.key]} »` : q.displayed[f.key]).join(' — ');
  vfSpeak(spokenText);
}

$('vf-validate-button')?.addEventListener('click', () => {
  if (vfAnswered) return;
  vfAnswered = true;
  const q = VF_SESSION[vfIndex];
  const artWord = q.correct.artType === 'sculpture' ? 'cette sculpture' : 'ce tableau';
  $('vf-validate-button').disabled = true;
  document.querySelectorAll('.vf-toggle button').forEach((b) => { b.disabled = true; });

  // Barème : 1 point si toutes les erreurs réelles sont repérées (ou, s'il n'y en a pas, si rien
  // n'est signalé à tort) ; 0,5 point si une seule sur deux est repérée ; -0,5 par fausse alerte
  // (rubrique juste signalée comme fausse), plafonné à -1 au total.
  const totalErrors = q.errorFields.length;
  let correctFinds = 0, falseAlarms = 0;
  q.activeFields.forEach((f) => {
    const playerSaysFalse = document.querySelector(`.vf-toggle[data-key="${f.key}"] button.active`).dataset.val === 'false';
    const actuallyWrong = q.errorFields.includes(f.key);
    if (playerSaysFalse && actuallyWrong) correctFinds++;
    else if (playerSaysFalse && !actuallyWrong) falseAlarms++;
  });
  // Barème simplifié, tout ou rien : 1 point seulement si toutes les erreurs réelles sont
  // repérées et qu'aucune fausse alerte n'a été déclenchée ; sinon 0, même pour un repérage
  // partiel (une erreur trouvée sur deux ne rapporte rien).
  const questionScore = (correctFinds === totalErrors && falseAlarms === 0) ? 1 : 0;
  vfScore = Math.round((vfScore + questionScore) * 10) / 10;
  $('vf-score-label').textContent = `${vfScore} point${Math.abs(vfScore) >= 2 ? 's' : ''}`;

  const naturalPhrase = (key, value) => {
    const phrases = {
      artist: `L'auteur exact de ${artWord} est : ${value}`,
      title: `Le titre exact de ${artWord} est : « ${value} »`,
      date: `La date exacte de ${artWord} est : ${value}`,
      materials: `Le matériau exact de ${artWord} est : ${value}`,
      dimensions: `Les dimensions exactes de ${artWord} sont ${spokenDimensionsPhrase(q.correct)}`,
      location: `Le lieu exact de ${artWord} est : ${value}`,
    };
    return phrases[key] || `${value}`;
  };

  // Correction directement dans les rubriques initiales : chaque champ faux se réécrit en vert
  // au fur et à mesure, en attendant la fin réelle de chaque phrase (pas de minuteur à durée
  // fixe) pour ne jamais couper la voix au milieu d'une explication.
  function speakNextCorrection(i) {
    if (i >= q.errorFields.length) return;
    const key = q.errorFields[i];
    const correctVal = vfFieldValue(q.correct, key) || '—';
    const shownCorrect = key === 'title' ? `<em>« ${escapeHtml(correctVal)} »</em>` : escapeHtml(correctVal);
    const el = $(`vf-value-${key}`);
    if (el) el.classList.add('vf-was-wrong');
    vfTimers.push(setTimeout(() => {
      if (el) {
        el.innerHTML = shownCorrect;
        el.classList.remove('vf-was-wrong');
        el.classList.add('vf-updated');
      }
      vfSpeak(naturalPhrase(key, correctVal), () => speakNextCorrection(i + 1));
    }, 700));
  }
  if (q.errorFields.length) {
    vfSpeak(q.errorFields.length > 1 ? 'Deux références étaient fausses.' : 'Une référence était fausse.', () => speakNextCorrection(0));
  } else {
    vfSpeak(q.activeFields.length > 1 ? 'Exact. Bonnes références.' : 'Exact. Bonne référence.');
  }

  // Fausses alertes : rubrique marquée Faux par le joueur alors qu'elle est exacte. Le bouton
  // reste sur Faux sans jamais se corriger, ce qui est ambigu — on le fait donc revenir sur Vrai
  // (avec la même temporisation que les vraies erreurs) et on l'explique.
  q.activeFields.forEach((f) => {
    const btn = document.querySelector(`.vf-toggle[data-key="${f.key}"] button[data-val="false"].active`);
    if (btn && !q.errorFields.includes(f.key)) {
      const trueBtn = document.querySelector(`.vf-toggle[data-key="${f.key}"] button[data-val="true"]`);
      const row = btn.closest('.vf-field-row');
      if (row && !row.querySelector('.vf-false-alarm-note')) {
        const note = document.createElement('span');
        note.className = 'vf-false-alarm-note';
        note.textContent = 'Cette rubrique était en fait exacte.';
        row.appendChild(note);
      }
      vfTimers.push(setTimeout(() => {
        btn.classList.remove('active');
        trueBtn?.classList.add('active');
      }, 700));
    }
  });

  $('vf-correction').classList.remove('hidden');
  $('vf-next-button').textContent = vfIndex === VF_SESSION.length - 1 ? 'Terminer' : 'Suivant →';
});

$('vf-next-button')?.addEventListener('click', async () => {
  if (vfIndex < VF_SESSION.length - 1) {
    vfIndex++;
    vfShowQuestion();
  } else {
    if (firebaseReady && currentUser) {
      try {
        await db.collection('users').doc(currentUser.uid).collection('scores').add({
          type: 'entrainement',
          exerciseName: 'Vrai/Faux',
          timeSpent: vfTimer.stop(),
          correct: vfScore, possible: VF_SESSION.length,
          percent: Math.round((vfScore / VF_SESSION.length) * 100),
          questionCount: VF_SESSION.length,
          quizLabel: 'Vrai/Faux',
          quizLevel: vfSelectedLevels().map((lvl) => `Niveau ${lvl}`).join(' + '),
          quizArts: vfSelectedArts(), quizCenturies: vfSelectedCenturies(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { /* enregistrement best-effort */ }
    }
    showPanel('vraifaux-setup');
    const feedback = $('vf-setup-feedback');
    feedback.classList.remove('hidden');
    feedback.textContent = `Terminé : ${vfScore} points sur ${VF_SESSION.length} questions.`;
  }
});

function populateReconVoices() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('fr'));
  const select = $('recon-opt-voice');
  if (!select) return;
  select.innerHTML = voices.length
    ? voices.map((v, i) => `<option value="${i}">${v.name}</option>`).join('')
    : '<option value="">Voix par défaut du système</option>';
}

const RECON_ACCORDIONS = ['recon-toggle-art:recon-body-art', 'recon-toggle-century:recon-body-century', 'recon-toggle-level:recon-body-level', 'recon-toggle-count:recon-body-count', 'recon-toggle-rubriques:recon-body-rubriques'];
RECON_ACCORDIONS.forEach((pair) => {
  const [toggleId, bodyId] = pair.split(':');
  $(toggleId)?.addEventListener('click', () => {
    const opening = $(bodyId).classList.contains('hidden');
    RECON_ACCORDIONS.forEach((p) => $(p.split(':')[1])?.classList.add('hidden'));
    if (opening) $(bodyId).classList.remove('hidden');
  });
});

function reconSelectedArts() { return ['peinture', 'sculpture'].filter((a) => $(`recon-art-${a}`)?.checked); }
function reconSelectedCenturies() { return ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].filter((c) => $(`recon-century-${c}`)?.checked); }
function reconSelectedZones() { return ['france', 'europe', 'amerique', 'asie'].filter((z) => $(`recon-zone-${z}`)?.checked); }
function reconSelectedLevels() { return ['1', '2', '3'].filter((lvl) => $(`recon-level-${lvl}`)?.checked); }

let RECON_SESSION = [], reconIndex = 0, reconCorrectCount = 0, reconAnswered = false, reconAudioOn = true, reconSelectedVoice = null, reconAutoAdvance = false, reconAutoAdvanceDelay = 5000, reconExtraFields = [], reconTimers = [];
const reconTimer = createTimer('recon-timer');
$('recon-opt-autoadvance')?.addEventListener('change', () => { $('recon-delay-row').style.display = $('recon-opt-autoadvance').checked ? 'flex' : 'none'; });
function reconSpeak(text) {
  if (!reconAudioOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR'; u.rate = 0.85;
  if (reconSelectedVoice) u.voice = reconSelectedVoice;
  speechSynthesis.speak(u);
}

$('recon-start-button')?.addEventListener('click', async () => {
  handleExtendAndRemember('recon', 'reconstitution-setup-panel');
  saveLastSelection('reconstitution-setup-panel');
  let arts = reconSelectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = reconSelectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  let levels = reconSelectedLevels(); if (!levels.length) levels = ['1','2','3'];
  const feedback = $('recon-setup-feedback');
  feedback.classList.remove('hidden');
  feedback.textContent = 'Chargement des œuvres…';
  try {
    const zones = reconSelectedZones();
    let allRows = [];
    for (const art of arts) {
      for (const century of centuries) {
        try {
          const rows = await fetchQuizRows(art, century);
          rows.forEach((r) => { r.artType = art; });
          allRows.push(...rows);
        } catch (e) { /* fichier absent, ignoré */ }
      }
    }
    if (allRows.length < 3) { feedback.textContent = "Pas assez d'œuvres disponibles pour ce choix (3 minimum)."; return; }
    let pool = allRows.filter((r) => levels.includes(String(r.niveau || 1)));
    if (pool.length < 3) pool = allRows;
    if (zones.length) {
      const zoned = pool.filter((r) => { const z = zoneOfNationality(r.nationality); return !z || zones.includes(z); });
      if (zoned.length >= 3) pool = zoned;
    }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const countChoice = document.querySelector('input[name="recon-count"]:checked').value;
    const count = countChoice === 'max' ? pool.length : Math.min(Number(countChoice), pool.length);
    reconAudioOn = getGlobalPrefs().audioOn;
    reconSelectedVoice = getGlobalVoice();
    reconAutoAdvance = $('recon-opt-autoadvance').checked;
    reconAutoAdvanceDelay = Number($('recon-opt-delay').value);
    reconExtraFields = ['date', 'materiaux', 'dimensions', 'location'].filter((k) => $(`recon-field-${k}`)?.checked);
    if (!reconExtraFields.length) reconExtraFields = ['date', 'materiaux', 'dimensions', 'location'];
    RECON_SESSION = pool.slice(0, count).map((correct) => {
      const distractors = pickIntrusDistractors(correct, pool);
      const choices = [correct, ...distractors];
      for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
      // Position du détail rogné biaisée vers le centre de l'image, où l'œuvre est visible —
      // plus resserré encore pour les sculptures, souvent entourées d'un socle ou d'un fond vide.
      const isSculpture = correct.artType === 'sculpture';
      const [minPos, maxPos] = isSculpture ? [30, 70] : [20, 80];
      const cropX = minPos + Math.floor(Math.random() * (maxPos - minPos + 1));
      const cropY = minPos + Math.floor(Math.random() * (maxPos - minPos + 1));
      return { correct, choices, cropX, cropY };
    });
    reconIndex = 0; reconCorrectCount = 0;
    showPanel('reconstitution');
    reconTimer.start();
    reconShowQuestion();
  } catch (error) {
    feedback.textContent = `Erreur : ${error.message}`;
  }
});

function reconShowQuestion() {
  speechSynthesis.cancel();
  reconTimers.forEach(clearTimeout); reconTimers = [];
  reconAnswered = false;
  const q = RECON_SESSION[reconIndex];
  $('recon-progress-label').textContent = `Question ${reconIndex + 1} / ${RECON_SESSION.length}`;
  $('recon-score-label').textContent = `${reconCorrectCount} / ${reconIndex} réponse${reconCorrectCount > 1 ? 's' : ''} correcte${reconCorrectCount > 1 ? 's' : ''}`;
  $('recon-progress-bar').style.width = `${(reconIndex / RECON_SESSION.length) * 100}%`;
  $('recon-correction').classList.add('hidden');
  $('recon-choices').classList.remove('hidden');

  const src = escapeHtml(imageSource(q.correct.image));
  $('recon-prompt-card').innerHTML = `<div class="recon-detail-crop" style="background-image:url('${src}');background-position:${q.cropX}% ${q.cropY}%;"></div>`;
  $('recon-choices').innerHTML = `<div class="intrus-choice-list">${q.choices.map((c, i) =>
    `<button type="button" class="intrus-choice-btn" data-index="${i}"><strong>${escapeHtml(c.artist)}</strong><br><em>« ${escapeHtml(c.title || c.date || 'œuvre non titrée')} »</em></button>`
  ).join('')}</div>`;
  $('recon-choices').querySelectorAll('.intrus-choice-btn').forEach((btn) => {
    btn.addEventListener('click', () => reconAnswer(Number(btn.dataset.index)));
  });
}

function reconAnswer(chosenIndex) {
  if (reconAnswered) return;
  reconAnswered = true;
  const q = RECON_SESSION[reconIndex];
  const chosen = q.choices[chosenIndex];
  const isCorrect = chosen === q.correct;
  if (isCorrect) reconCorrectCount++;

  const verdictHtml = ` <span class="intrus-verdict" style="color:${isCorrect ? 'var(--ok)' : 'var(--wrong)'}">${isCorrect ? '— Exact' : '— À réviser'}</span>`;
  $('recon-choices').querySelectorAll('.intrus-choice-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === chosenIndex) btn.insertAdjacentHTML('beforeend', verdictHtml);
    else btn.remove();
  });

  // L'image entière est révélée, avec la référence complète.
  $('recon-prompt-card').innerHTML = `<img class="recon-full-image" src="${escapeHtml(imageSource(q.correct.image))}" alt="" />`;

  const dims = formatDimensionsDisplay(q.correct);
  reconSpeak(spokenFullReference(q.correct));
  const detailsParts = [];
  detailsParts.push(`<span class="correction-label">Auteur</span><span class="correction-value">${escapeHtml(q.correct.artist)}</span>`);
  detailsParts.push(`<span class="correction-label">Titre de l'œuvre</span><span class="correction-value"><em>« ${escapeHtml(q.correct.title)} »</em></span>`);
  if (reconExtraFields.includes('date')) detailsParts.push(`<span class="correction-label">Date</span><span class="correction-value">${escapeHtml(q.correct.date || '—')}</span>`);
  if (reconExtraFields.includes('materiaux') && q.correct.materials) detailsParts.push(`<span class="correction-label">Matériau</span><span class="correction-value">${escapeHtml(q.correct.materialsPhrase || q.correct.materials)}</span>`);
  if (reconExtraFields.includes('dimensions') && dims) detailsParts.push(`<span class="correction-label">Dimensions</span><span class="correction-value">${dims}</span>`);
  if (reconExtraFields.includes('location')) detailsParts.push(`<span class="correction-label">Lieu</span><span class="correction-value">${escapeHtml(q.correct.location || '—')}</span>`);
  $('recon-correction-details').innerHTML = detailsParts.join('');
  $('recon-correction').classList.remove('hidden');
  $('recon-score-label').textContent = `${reconCorrectCount} / ${reconIndex + 1} réponse${reconCorrectCount > 1 ? 's' : ''} correcte${reconCorrectCount > 1 ? 's' : ''}`;
  $('recon-next-button').textContent = reconIndex === RECON_SESSION.length - 1 ? 'Terminer' : 'Suivant →';
  if (reconAutoAdvance) reconTimers.push(setTimeout(() => $('recon-next-button')?.click(), reconAutoAdvanceDelay));
}

$('recon-next-button')?.addEventListener('click', async () => {
  if (reconIndex < RECON_SESSION.length - 1) {
    reconIndex++;
    reconShowQuestion();
  } else {
    if (firebaseReady && currentUser) {
      try {
        await db.collection('users').doc(currentUser.uid).collection('scores').add({
          type: 'entrainement',
          exerciseName: 'Reconstitution',
          timeSpent: reconTimer.stop(),
          correct: reconCorrectCount, possible: RECON_SESSION.length,
          percent: Math.round((reconCorrectCount / RECON_SESSION.length) * 100),
          questionCount: RECON_SESSION.length,
          quizLabel: 'Reconstitution',
          quizLevel: reconSelectedLevels().map((lvl) => `Niveau ${lvl}`).join(' + '),
          quizArts: reconSelectedArts(), quizCenturies: reconSelectedCenturies(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { /* enregistrement best-effort */ }
    }
    showPanel('reconstitution-setup');
    const feedback = $('recon-setup-feedback');
    feedback.classList.remove('hidden');
    feedback.textContent = `Terminé : ${reconCorrectCount} / ${RECON_SESSION.length} bonnes réponses.`;
  }
});
// Boutons « Artiste / Titre / Date / Lieu » à côté de chaque champ : sélectionnent le champ comme
// cible de dictée sans lui donner le focus réel, pour éviter l'ouverture systématique du clavier
// virtuel sur mobile.
document.querySelectorAll('.field-label-button').forEach((button) => {
  button.addEventListener('click', () => setFocusedField(button.dataset.field, { focusInput: false, scroll: false }));
});
// Vrai plein écran navigateur (masque la barre d'adresse sur mobile quand le navigateur le
// permet) plutôt qu'un simple masquage CSS — qui pouvait bloquer l'accès aux boutons si activé.
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}
$('global-fullscreen-button')?.addEventListener('click', toggleFullscreen);
// Position des boutons Artiste/Titre/Date/Lieu (droite par défaut pour droitiers, gauche pour
// gauchers) : préférence locale mémorisée sur l'appareil. Pourra migrer vers le compte personnel.
function applyHandedness(lefty) {
  document.body.classList.toggle('lefty', lefty);
}
applyHandedness(localStorage.getItem('handedness') === 'lefty');

// Bandeau du haut déplaçable : glisser la poignée ⠿, position mémorisée sur l'appareil.
(function initDraggableTopbar() {
  const wrap = $('global-topbar');
  const handle = $('global-topbar-handle');
  if (!wrap || !handle) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('topbarPosition') || 'null'); } catch (e) {}
  if (saved && typeof saved.top === 'number' && typeof saved.left === 'number') {
    wrap.style.top = `${saved.top}px`;
    wrap.style.left = `${saved.left}px`;
    wrap.style.right = 'auto';
  }
  let dragging = false, startX = 0, startY = 0, startTop = 0, startLeft = 0;
  handle.addEventListener('pointerdown', (event) => {
    dragging = true;
    // Pendant le glissement, on neutralise les tuiles de fond : sans ça, le curseur qui les
    // traverse déclenche leur effet de zoom au survol tuile après tuile, donnant l'impression
    // que le fond « suit » le geste.
    document.body.classList.add('dragging-topbar');
    const rect = wrap.getBoundingClientRect();
    startX = event.clientX; startY = event.clientY;
    startTop = rect.top; startLeft = rect.left;
    try { handle.setPointerCapture(event.pointerId); } catch (e) { /* ignoré volontairement */ }
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const newTop = Math.max(0, Math.min(window.innerHeight - 40, startTop + (event.clientY - startY)));
    const newLeft = Math.max(0, Math.min(window.innerWidth - 40, startLeft + (event.clientX - startX)));
    wrap.style.top = `${newTop}px`;
    wrap.style.left = `${newLeft}px`;
    wrap.style.right = 'auto';
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging-topbar');
    const rect = wrap.getBoundingClientRect();
    localStorage.setItem('topbarPosition', JSON.stringify({ top: rect.top, left: rect.left }));
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
})();

$('show-other-works-button')?.addEventListener('click', () => { renderOtherWorksPanel(); showPanel('other-works'); });
$('other-works-back-button')?.addEventListener('click', () => showPanel('quiz'));
$('other-works-next-button')?.addEventListener('click', () => { showPanel('quiz'); goToNextOrResults(); });

// --- Sélecteur de quiz par art / siècle / rubriques / niveau ---
const ART_LABELS = { peinture: 'Peinture', sculpture: 'Sculpture' };
const ART_ABBR = { peinture: 'Peint.', sculpture: 'Sculpt.' };
const CENTURY_LABELS = { '14e': '14e siècle', '15e': '15e siècle', '16e': '16e siècle', '17e': '17e siècle', '18e': '18e siècle', '19e': '19e siècle', '20e': '20e siècle' };
const ZONE_ABBR = { france: 'Fr.', europe: 'Europe', amerique: 'Amér.', asie: 'Asie' };
const LEVEL_LABELS = { '1': 'Niveau 1', '2': 'Niveau 2', '3': 'Niveau 3' };
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
// Fond décoratif de la page d'accueil : 15 œuvres célèbres, floutées et assourdies par défaut,
// nettes et agrandies au survol. Purement décoratif (aria-hidden), tolère les échecs de chargement.
const BG_MOSAIC_FILES = [
  'Great Wave off Kanagawa2.jpg',
  'The Fighting Temeraire, JMW Turner, National Gallery.jpg',
  'Aivazovsky, Ivan - The Ninth Wave.jpg',
  'Winslow Homer - The Gulf Stream.jpg',
  'Ferdinand Hodler - Die Nacht (1889-90).jpg',
  'Albert Bierstadt - The Rocky Mountains, Lander\'s Peak.jpg',
  'Alma-Tadema - The Roses of Heliogabalus.jpg',
  'Alfons Mucha - 1894 - Gismonda.jpg',
  'Le Ballon Valloton Orsay.jpg',
  'Jean-Baptiste Greuze - A Girl with a Dead Canary - Google Art Project.jpg',
  'Jean-Honoré Fragonard - Denis Diderot (Fanciful Figure) - WGA8064.jpg',
  'William Hogarth - The Shrimp Girl - WGA11467.jpg',
  'Aubrey Beardsley - The Climax.jpg',
  'Michelangelos David.jpg',
  'Venus de Milo Louvre.jpg',
];
function initBackgroundMosaic() {
  const container = $('bg-mosaic');
  if (!container) return;
  container.innerHTML = BG_MOSAIC_FILES.map((filename) => {
    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=400`;
    return `<div class="bg-tile"><img src="${url}" alt="" loading="lazy" /></div>`;
  }).join('');
  // Sur smartphone il n'y a pas de vrai survol à la souris : « :hover » seul ne suffit pas.
  // On bascule une classe au toucher/clic pour obtenir le même effet net + agrandi, et on la
  // retire des autres vignettes pour n'en montrer qu'une nette à la fois.
  container.querySelectorAll('.bg-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const wasActive = tile.classList.contains('touched');
      container.querySelectorAll('.bg-tile.touched').forEach((t) => t.classList.remove('touched'));
      if (!wasActive) tile.classList.add('touched');
    });
    // Doublon JS du survol CSS (:hover) : garantit l'effet même si le survol CSS est
    // empêché quelque part dans la chaîne d'empilement (pointer-events, z-index…).
    tile.addEventListener('mouseenter', () => tile.classList.add('touched'));
    tile.addEventListener('mouseleave', () => tile.classList.remove('touched'));
  });
}
initBackgroundMosaic();
// Quatre accordéons indépendants (art / siècle+zone / rubriques / niveau+nombre) : chacun a son
// propre bouton, qui affiche « Choisissez… » tant que rien n'est coché, puis « Modifiez : … » une
// fois une sélection faite. Cliquer sur le bouton ouvre/ferme sa propre section ; les autres ne
// sont pas affectées. Plus de repli automatique ni de récapitulatif séparé.
const ACCORDIONS = [
  { toggle: 'toggle-art', body: 'body-art', icon: '🎨', label: 'Choisissez votre art', summaryFn: () => state.selectorSummaries?.artText },
  { toggle: 'toggle-century', body: 'body-century', icon: '🏛️', label: 'Choisissez votre siècle et votre zone géographique', summaryFn: () => state.selectorSummaries?.centuryText },
  { toggle: 'toggle-rubriques', body: 'body-rubriques', icon: '📝', label: 'Choisissez vos rubriques', summaryFn: () => state.selectorSummaries?.rubriquesText },
  { toggle: 'toggle-level', body: 'body-level', icon: '⭐', label: 'Choisissez votre niveau et votre nombre de questions', summaryFn: () => state.selectorSummaries?.levelText },
];
function refreshAccordionLabels() {
  ACCORDIONS.forEach(({ toggle, icon, label, summaryFn }) => {
    const btn = $(toggle);
    if (!btn) return;
    const summary = summaryFn();
    const isEmpty = !summary || /^(Aucun|Aucune)/.test(summary);
    btn.textContent = isEmpty ? `${icon} ${label}` : `${icon} Modifiez : ${summary}`;
    btn.classList.toggle('accordion-toggle-done', !isEmpty);
  });
}
ACCORDIONS.forEach(({ toggle, body }) => {
  $(toggle)?.addEventListener('click', () => {
    const el = $(body);
    if (!el) return;
    const opening = el.classList.contains('hidden');
    // Un seul accordéon ouvert à la fois, pour rester lisible.
    ACCORDIONS.forEach(({ body: otherBody }) => { if (otherBody !== body) $(otherBody)?.classList.add('hidden'); });
    el.classList.toggle('hidden', !opening);
  });
});
document.querySelectorAll('.accordion-body input[type="checkbox"], .accordion-body input[type="radio"]').forEach((input) => {
  input.addEventListener('change', () => { updateSelectorSummaries(); refreshAccordionLabels(); });
});
function refreshSavedChoiceButton() {
  $('load-saved-choice-button')?.toggleAttribute('hidden', !localStorage.getItem('savedQuizConfig'));
}
refreshSavedChoiceButton();
$('open-quiz-setup')?.addEventListener('click', () => { showPanel('quiz-setup'); refreshSavedChoiceButton(); });
$('load-saved-choice-button')?.addEventListener('click', () => {
  const raw = localStorage.getItem('savedQuizConfig');
  if (!raw) return;
  const cfg = JSON.parse(raw);
  ['art-peinture', 'art-sculpture', 'century-14e', 'century-15e', 'century-16e', 'century-17e', 'century-18e', 'century-19e', 'century-20e',
   'zone-france', 'zone-europe', 'zone-amerique', 'zone-asie', 'level-1', 'level-2', 'level-3'].forEach((id) => { const el = $(id); if (el) el.checked = false; });
  allFields.forEach((field) => { $(field.checkbox).checked = false; });
  (cfg.arts || []).forEach((a) => { const el = $(`art-${a}`); if (el) el.checked = true; });
  (cfg.centuries || []).forEach((c) => { const el = $(`century-${c}`); if (el) el.checked = true; });
  (cfg.zones || []).forEach((z) => { const el = $(`zone-${z}`); if (el) el.checked = true; });
  (cfg.levels || []).forEach((lvl) => { const el = $(`level-${lvl}`); if (el) el.checked = true; });
  (cfg.chosenKeys || []).forEach((key) => { const field = allFields.find((f) => f.key === key); if (field) $(field.checkbox).checked = true; });
  if (cfg.count) { const el = $(`count-${cfg.count}`); if (el) el.checked = true; }
  updateSelectorSummaries();
  refreshAccordionLabels();
  const fb = $('launch-feedback');
  if (fb) { fb.classList.remove('hidden'); fb.textContent = 'Choix mémorisé rechargé.'; }
});
// Info-bulle CSS (survol/focus) plutôt qu'une alerte bloquante ; sur mobile (pas de survol), un
// tap bascule son affichage.
const EXERCISE_INFO = {
  imp: { name: 'Imprégnation', open: 'open-impregnation-setup', start: 'imp-start-button', panel: 'impregnation-setup-panel' },
  intrus: { name: 'Intrus', open: 'open-intrus-setup', start: 'intrus-start-button', panel: 'intrus-setup-panel' },
  recon: { name: 'Reconstitution', open: 'open-reconstitution-setup', start: 'recon-start-button', panel: 'reconstitution-setup-panel' },
  vf: { name: 'Vrai/Faux', open: 'open-vraifaux-setup', start: 'vf-start-button', panel: 'vraifaux-setup-panel' },
  fam: { name: 'Famille', open: 'open-famille-setup', start: 'fam-start-button', panel: 'famille-setup-panel' },
  chrono: { name: 'Chronologie', open: 'open-chrono-setup', start: 'chrono-start-button', panel: 'chrono-setup-panel' },
};
// Résumé abrégé (ex. « Peinture17 ») de la sélection mémorisée d'un exercice, affiché
// directement sur son bouton dans le menu — évite d'avoir à rouvrir la configuration pour
// se rappeler ce qui était choisi la dernière fois. Le choix général (depuis « Mon compte »)
// est prioritaire sur un choix propre à l'exercice, et affiché différemment (icône 🌐).
function readGlobalFieldDefaults() {
  try { return JSON.parse(localStorage.getItem('globalFieldDefaults') || '{}'); } catch (e) { return {}; }
}
function readGlobalRubriqueDefaults() {
  try { return JSON.parse(localStorage.getItem('globalRubriqueDefaults') || '{}'); } catch (e) { return {}; }
}
function buildExerciseSummary(prefix) {
  // Même priorité qu'au démarrage : un choix propre à cet exercice l'emporte sur le choix
  // général — sinon le badge du bouton ne refléterait jamais ce qui va réellement se lancer.
  let state;
  try { state = JSON.parse(localStorage.getItem(`lastSelection_${EXERCISE_INFO[prefix].panel}`) || '{}'); } catch (e) { state = {}; }
  const ownArts = Object.keys(state).filter((k) => k.startsWith(`${prefix}-art-`) && state[k]).map((k) => k.replace(`${prefix}-art-`, ''));
  const ownCenturies = Object.keys(state).filter((k) => k.startsWith(`${prefix}-century-`) && state[k]).map((k) => k.replace(`${prefix}-century-`, '').replace('e', ''));
  if (ownArts.length || ownCenturies.length) {
    const artLabel = ownArts.map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join('+');
    return `▶ ${artLabel}${ownCenturies.join('+')}`;
  }
  const gf = readGlobalFieldDefaults();
  const gr = readGlobalRubriqueDefaults();
  const hasGlobalField = gf.remember && (gf.arts?.length || gf.centuries?.length || gf.zones?.length);
  const hasGlobalRubrique = gr.remember && (gr.rubriques?.length || gr.levels?.length);
  if (hasGlobalField || hasGlobalRubrique) {
    const artLabel = (gf.arts || []).map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join('+');
    return `🌐 ${artLabel}${(gf.centuries || []).join('+')}${gr.levels?.length ? ' N' + gr.levels.join('+') : ''}`;
  }
  return '';
}
function updateExerciseSummaries() {
  Object.keys(EXERCISE_INFO).forEach((prefix) => {
    const el = $(`${prefix}-hub-summary`);
    if (el) el.textContent = buildExerciseSummary(prefix);
  });
}
// Filet de sécurité : si le démarrage automatique est activé mais que la sélection réellement
// appliquée est vide (réglage ancien ou incomplet resté en mémoire), on n'insiste pas — on
// affiche normalement la configuration plutôt que de rester silencieusement bloqué.
function hasValidSelection(prefix) {
  const hasArt = document.querySelectorAll(`[id^="${prefix}-art-"]:checked`).length > 0;
  const hasCentury = document.querySelectorAll(`[id^="${prefix}-century-"]:checked`).length > 0;
  const hasLevel = document.querySelectorAll(`[id^="${prefix}-level-"]:checked`).length > 0;
  return hasArt && hasCentury && hasLevel;
}
// Le bouton d'un exercice démarre directement (sans repasser par sa configuration) si un choix
// général (champ ET/OU rubrique-niveau) mémorisé existe, OU si ce choix a été mémorisé
// spécifiquement pour cet exercice.
function shouldAutoStart(prefix) {
  const gf = readGlobalFieldDefaults();
  const gr = readGlobalRubriqueDefaults();
  if (gf.remember && (gf.arts?.length || gf.centuries?.length || gf.zones?.length)) return true;
  if (gr.remember && (gr.rubriques?.length || gr.levels?.length)) return true;
  return localStorage.getItem(`autoStart_${prefix}`) === 'true';
}
// Un choix propre à un exercice (fait via son icône ✏️) doit primer sur le choix général : sinon
// personnaliser un jeu en particulier ne servirait à rien dès qu'un choix général existe.
function hasPerExerciseFieldOverride(panelId) {
  let state;
  try { state = JSON.parse(localStorage.getItem(`lastSelection_${panelId}`) || '{}'); } catch (e) { return false; }
  return Object.keys(state).some((k) => state[k] && /-(art|century|zone)-/.test(k));
}
function hasPerExerciseRubriqueOverride(panelId) {
  let state;
  try { state = JSON.parse(localStorage.getItem(`lastSelection_${panelId}`) || '{}'); } catch (e) { return false; }
  return Object.keys(state).some((k) => state[k] && /-(field|level)-/.test(k));
}
function applyGlobalFieldDefaultsTo(prefix) {
  const gf = readGlobalFieldDefaults();
  const gr = readGlobalRubriqueDefaults();
  if (gf.remember) {
    ['peinture', 'sculpture'].forEach((a) => { const el = $(`${prefix}-art-${a}`); if (el) el.checked = (gf.arts || []).includes(a); });
    ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].forEach((c) => { const el = $(`${prefix}-century-${c}`); if (el) el.checked = (gf.centuries || []).includes(c); });
    ['france', 'europe', 'amerique', 'asie'].forEach((z) => { const el = $(`${prefix}-zone-${z}`); if (el) el.checked = (gf.zones || []).includes(z); });
  }
  if (gr.remember) {
    ['1', '2', '3'].forEach((lvl) => { const el = $(`${prefix}-level-${lvl}`); if (el) el.checked = (gr.levels || []).includes(lvl); });
    if (gr.count) {
      const radios = [...document.querySelectorAll(`input[name="${prefix}-count"]`)];
      const exact = radios.find((r) => r.value === gr.count);
      if (exact) exact.checked = true;
      else if (radios.length) {
        const numeric = radios.filter((r) => !isNaN(Number(r.value)));
        if (numeric.length) {
          if (gr.count === 'max') {
            // Pas d'option « maximum » sur cet exercice : on prend la plus grande valeur proposée.
            numeric.sort((a, b) => Number(b.value) - Number(a.value));
          } else {
            // Se rabat sur la valeur numérique la plus proche disponible pour cet exercice (ex.
            // des paliers différents comme 5/10 au lieu de 10/20).
            const target = Number(gr.count);
            numeric.sort((a, b) => Math.abs(Number(a.value) - target) - Math.abs(Number(b.value) - target));
          }
          numeric[0].checked = true;
        }
      }
    }
  }
}
const EXERCISE_SHOW_CONFIG = { imp: showImpConfig, intrus: showIntrusConfig, recon: showReconConfig, vf: showVfConfig, fam: showFamConfig, chrono: showChronoConfig };
document.querySelectorAll('.exercise-summary-edit').forEach((icon) => {
  icon.addEventListener('click', (event) => {
    event.stopPropagation();
    const prefix = icon.id.replace('-hub-edit', '');
    EXERCISE_SHOW_CONFIG[prefix]?.();
  });
});
$('open-training')?.addEventListener('click', () => { showPanel('training-hub'); updateExerciseSummaries(); });
document.querySelectorAll('.training-soon').forEach((btn) => {
  btn.addEventListener('click', (event) => event.currentTarget.classList.toggle('show-tooltip'));
});

// ============================================================
// MODULE IMPRÉGNATION — réutilise fetchQuizRows/ART_LABELS/CENTURY_LABELS/zoneOfNationality déjà
// définis pour le quiz ; sélection propre (préfixe imp-), mécanique d'écriture progressive
// synchronisée à la voix de synthèse, sans notation.
// ============================================================
function showImpConfig() {
  showPanel('impregnation-setup'); populateImpVoices(); speakObjective('imp'); restoreLastSelection('impregnation-setup-panel'); const p = getGlobalPrefs(); if ($('imp-opt-advance')) { $('imp-opt-advance').value = p.defaultAdvance; $('imp-opt-delay').value = String(p.defaultDelay); $('imp-opt-advance').dispatchEvent(new Event('change')); }
}
$('open-impregnation-setup')?.addEventListener('click', () => {
  if (hasPerExerciseFieldOverride('impregnation-setup-panel') || hasPerExerciseRubriqueOverride('impregnation-setup-panel')) {
    restoreLastSelection('impregnation-setup-panel');
  } else {
    applyGlobalFieldDefaultsTo('imp');
  }
  suppressSaveLastSelection = true;
  // Synchronise l'avancement (auto/manuel) et son délai depuis les préférences générales, comme
  // le faisait la page de configuration qu'on ne montre plus — sinon la valeur par défaut du
  // formulaire (auto) est utilisée à chaque fois, quel que soit le choix du joueur.
  const p = getGlobalPrefs();
  if ($('imp-opt-advance')) { $('imp-opt-advance').value = p.defaultAdvance; $('imp-opt-delay').value = String(p.defaultDelay); }
  $('imp-start-button')?.click();
});
$('impregnation-setup-back-button')?.addEventListener('click', () => showPanel('training-hub'));
$('imp-exit-link')?.addEventListener('click', () => { impClearTimers(); speechSynthesis.cancel(); showPanel('impregnation-setup'); });
['imp', 'intrus', 'recon', 'vf', 'fam', 'enig'].forEach((p) => {
  $(`${p}-hub-link`)?.addEventListener('click', () => { speechSynthesis.cancel(); showPanel('training-hub'); updateExerciseSummaries(); });
});

const IMP_ACCORDIONS = ['imp-toggle-art:imp-body-art', 'imp-toggle-century:imp-body-century', 'imp-toggle-level:imp-body-level', 'imp-toggle-rubriques:imp-body-rubriques'];
IMP_ACCORDIONS.forEach((pair) => {
  const [toggleId, bodyId] = pair.split(':');
  $(toggleId)?.addEventListener('click', () => {
    const opening = $(bodyId).classList.contains('hidden');
    IMP_ACCORDIONS.forEach((p) => $(p.split(':')[1])?.classList.add('hidden'));
    if (opening) $(bodyId).classList.remove('hidden');
  });
});

$('imp-opt-advance')?.addEventListener('change', () => {
  $('imp-delay-row').style.display = $('imp-opt-advance').value === 'manual' ? 'none' : 'flex';
});

function populateImpVoices() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('fr'));
  const select = $('imp-opt-voice');
  if (!select) return;
  select.innerHTML = voices.length
    ? voices.map((v, i) => `<option value="${i}">${v.name}</option>`).join('')
    : '<option value="">Voix par défaut du système</option>';
}

function impSelectedArts() { return ['peinture', 'sculpture'].filter((a) => $(`imp-art-${a}`)?.checked); }
function impSelectedCenturies() { return ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].filter((c) => $(`imp-century-${c}`)?.checked); }
function impSelectedZones() { return ['france', 'europe', 'amerique', 'asie'].filter((z) => $(`imp-zone-${z}`)?.checked); }
function impSelectedLevels() { return ['1', '2', '3'].filter((lvl) => $(`imp-level-${lvl}`)?.checked); }

let IMP_SESSION = [], impIndex = 0, impPaused = false, impTimers = [], impAudioOn = true, impDelayMs = 3000, impAdvanceMode = 'auto', impSelectedVoice = null;
const impTimer = createTimer('imp-timer');

function impClearTimers() { impTimers.forEach(clearTimeout); impTimers = []; }
function impSpeak(text) {
  if (!impAudioOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR'; u.rate = 0.72;
  if (impSelectedVoice) u.voice = impSelectedVoice;
  speechSynthesis.speak(u);
}

$('imp-start-button')?.addEventListener('click', async () => {
  handleExtendAndRemember('imp', 'impregnation-setup-panel');
  saveLastSelection('impregnation-setup-panel');
  let arts = impSelectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = impSelectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  let levels = impSelectedLevels(); if (!levels.length) levels = ['1','2','3'];
  const feedback = $('imp-setup-feedback');
  feedback.classList.remove('hidden');
  feedback.textContent = 'Chargement des œuvres…';
  try {
    const zones = impSelectedZones();
    let allRows = [];
    for (const art of arts) {
      for (const century of centuries) {
        try { allRows.push(...(await fetchQuizRows(art, century))); } catch (e) { /* fichier absent, ignoré */ }
      }
    }
    if (!allRows.length) { feedback.textContent = "Aucune œuvre disponible pour ce choix."; return; }
    let pool = allRows.filter((r) => levels.includes(String(r.niveau || 1)));
    if (!pool.length) pool = allRows;
    if (zones.length) {
      const zoned = pool.filter((r) => { const z = zoneOfNationality(r.nationality); return !z || zones.includes(z); });
      if (zoned.length) pool = zoned;
    }
    // Mélange, sans limitation de nombre : tout l'échantillon correspondant au choix.
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    IMP_SESSION = pool;
    impAdvanceMode = $('imp-opt-advance').value;
    impAudioOn = getGlobalPrefs().audioOn;
    impDelayMs = Number($('imp-opt-delay').value);
    impSelectedVoice = getGlobalVoice();
    impIndex = 0;
    showPanel('impregnation');
    impTimer.start();
    impShowCurrent();
  } catch (error) {
    feedback.textContent = `Erreur : ${error.message}`;
  }
});

function impScheduleAdvance(ms) {
  if (impAdvanceMode !== 'auto') return;
  impTimers.push(setTimeout(() => { if (!impPaused && impIndex < IMP_SESSION.length - 1) { impIndex++; impShowCurrent(); } }, ms));
}

function impShowCurrent() {
  impClearTimers();
  speechSynthesis.cancel();
  impPaused = false;
  $('imp-pause-button').textContent = '⏸';
  const work = IMP_SESSION[impIndex];
  $('imp-progress-label').textContent = `Œuvre ${impIndex + 1} / ${IMP_SESSION.length}`;
  $('imp-progress-bar').style.width = `${(impIndex / Math.max(IMP_SESSION.length - 1, 1)) * 100}%`;
  $('imp-stage-img').src = imageSource(work.image);

  const dims = formatDimensionsPlainText(work);
  const anyFieldChecked = ['artist', 'title', 'date', 'materiaux', 'dimensions', 'location'].some((k) => $(`imp-field-${k}`)?.checked);
  const fields = [
    { key: 'artist', label: 'Auteur', value: work.artist, on: anyFieldChecked ? $('imp-field-artist').checked : true },
    { key: 'title', label: 'Titre de l\u2019œuvre', value: `« ${work.title} »`, on: anyFieldChecked ? $('imp-field-title').checked : true },
    { key: 'date', label: 'Date', value: work.date, on: anyFieldChecked ? $('imp-field-date').checked : true },
    { key: 'materiaux', label: 'Matériau', value: work.materialsPhrase || work.materials, on: (anyFieldChecked ? $('imp-field-materiaux').checked : true) && work.materials },
    { key: 'dimensions', label: 'Dimensions', value: dims, spoken: spokenDimensionsPhrase(work), on: (anyFieldChecked ? $('imp-field-dimensions').checked : true) && dims },
    { key: 'location', label: 'Lieu', value: work.location, on: anyFieldChecked ? $('imp-field-location').checked : true },
  ].filter((f) => f.on);

  $('imp-correction-details').innerHTML = fields.map((f) =>
    `<span class="correction-label">${f.label}</span><span class="correction-value" id="imp-val-${f.key}"></span>`
  ).join('');

  const refText = fields.map((f) => f.spoken || f.value).join(' — ') || work.artist;
  impSpeak(refText);

  const STAGGER = impDelayMs * 0.5;
  fields.forEach((f, i) => {
    impTimers.push(setTimeout(() => {
      const el = $(`imp-val-${f.key}`);
      if (el) { el.textContent = f.value; el.classList.add('written'); }
    }, 400 + i * STAGGER));
  });

  const totalWriteTime = 400 + fields.length * STAGGER;
  impScheduleAdvance(totalWriteTime + 4000);
}

$('imp-pause-button')?.addEventListener('click', () => {
  impPaused = !impPaused;
  $('imp-pause-button').textContent = impPaused ? '▶' : '⏸';
  if (impPaused) { impClearTimers(); speechSynthesis.cancel(); } else impShowCurrent();
});
$('imp-prev-button')?.addEventListener('click', () => { if (impIndex > 0) { impIndex--; impShowCurrent(); } });
$('imp-next-button')?.addEventListener('click', () => { if (impIndex < IMP_SESSION.length - 1) { impIndex++; impShowCurrent(); } });

// ============================================================
// MODULE INTRUS — retrouver la bonne image parmi 3 (mode « image »), ou la bonne référence
// parmi 3 (mode « reference »). Noté, comptabilisé à part dans les scores (type: 'entrainement').
// ============================================================
function showIntrusConfig() {
  showPanel('intrus-setup'); populateIntrusVoices(); speakObjective('intrus'); restoreLastSelection('intrus-setup-panel'); applyDefaultAdvance('intrus-opt-autoadvance', 'intrus-opt-delay', 'intrus-delay-row');
}
$('open-intrus-setup')?.addEventListener('click', () => {
  if (hasPerExerciseFieldOverride('intrus-setup-panel') || hasPerExerciseRubriqueOverride('intrus-setup-panel')) {
    restoreLastSelection('intrus-setup-panel');
  } else {
    applyGlobalFieldDefaultsTo('intrus');
  }
  suppressSaveLastSelection = true;
  applyDefaultAdvance('intrus-opt-autoadvance', 'intrus-opt-delay', 'intrus-delay-row');
  $('intrus-start-button')?.click();
});
let returnToExercisePanel = null; // mémorise l'exercice en cours quand on consulte les scores depuis là
$('intrus-scores-link')?.addEventListener('click', () => {
  speechSynthesis.cancel();
  returnToExercisePanel = 'intrus';
  showPanel('account');
  loadAccountPage();
});
$('intrus-setup-scores-link')?.addEventListener('click', () => { returnToExercisePanel = null; showPanel('account'); loadAccountPage(); });
function populateIntrusVoices() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('fr'));
  const select = $('intrus-opt-voice');
  if (!select) return;
  select.innerHTML = voices.length
    ? voices.map((v, i) => `<option value="${i}">${v.name}</option>`).join('')
    : '<option value="">Voix par défaut du système</option>';
}
speechSynthesis.onvoiceschanged = () => { populateImpVoices(); populateIntrusVoices(); };
$('intrus-setup-back-button')?.addEventListener('click', () => showPanel('training-hub'));
$('intrus-exit-link')?.addEventListener('click', () => showPanel('intrus-setup'));

let intrusMode = 'image';
document.querySelectorAll('.intrus-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    intrusMode = btn.dataset.mode;
    document.querySelectorAll('.intrus-mode-btn').forEach((b) => b.classList.toggle('inactive', b !== btn));
  });
});

const INTRUS_ACCORDIONS = ['intrus-toggle-art:intrus-body-art', 'intrus-toggle-century:intrus-body-century', 'intrus-toggle-level:intrus-body-level', 'intrus-toggle-count:intrus-body-count', 'intrus-toggle-rubriques:intrus-body-rubriques'];
INTRUS_ACCORDIONS.forEach((pair) => {
  const [toggleId, bodyId] = pair.split(':');
  $(toggleId)?.addEventListener('click', () => {
    const opening = $(bodyId).classList.contains('hidden');
    INTRUS_ACCORDIONS.forEach((p) => $(p.split(':')[1])?.classList.add('hidden'));
    if (opening) $(bodyId).classList.remove('hidden');
  });
});

function intrusSelectedArts() { return ['peinture', 'sculpture'].filter((a) => $(`intrus-art-${a}`)?.checked); }
function intrusSelectedCenturies() { return ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].filter((c) => $(`intrus-century-${c}`)?.checked); }
function intrusSelectedZones() { return ['france', 'europe', 'amerique', 'asie'].filter((z) => $(`intrus-zone-${z}`)?.checked); }
function intrusSelectedLevels() { return ['1', '2', '3'].filter((lvl) => $(`intrus-level-${lvl}`)?.checked); }

let INTRUS_SESSION = [], intrusIndex = 0, intrusCorrectCount = 0, intrusAnswered = false, intrusAudioOn = true, intrusSelectedVoice = null, intrusAutoAdvance = false, intrusAutoAdvanceDelay = 5000, intrusExtraFields = [], intrusTimers = [];
const intrusTimer = createTimer('intrus-timer');
$('intrus-opt-autoadvance')?.addEventListener('change', () => { $('intrus-delay-row').style.display = $('intrus-opt-autoadvance').checked ? 'flex' : 'none'; });
function intrusSpeak(text) {
  if (!intrusAudioOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR'; u.rate = 0.85;
  if (intrusSelectedVoice) u.voice = intrusSelectedVoice;
  speechSynthesis.speak(u);
}
const INTRUS_STOPWORDS = new Set(['le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'à', 'au', 'aux', 'en', 'dans', 'sur', 'avec', 'sans', 'pour', 'par', 'ou', 'se', 'son', 'sa', 'ses', 'l']);
function intrusTitleWords(title) {
  return String(title || '').toLowerCase().replace(/[«»"',.]/g, '').split(/\s+/).filter((w) => w.length > 3 && !INTRUS_STOPWORDS.has(w));
}
function pickIntrusDistractors(correct, pool, requireDistinctArtist) {
  // Rendre le choix plus exigeant : on préfère des intrus qui partagent un mot significatif du
  // titre (ex. « paysage »), sinon des œuvres d'un AUTRE artiste (pour ne pas trivialiser un
  // choix limité au nom du peintre), sinon n'importe quoi d'autre du réservoir.
  const contentKey = (r) => `${famNormalize(r.artist)}|${famNormalize(r.title)}`;
  const correctKey = contentKey(correct);
  const usedKeys = new Set([correctKey]);
  const usedArtists = new Set([famNormalize(correct.artist)]);
  const correctWords = new Set(intrusTitleWords(correct.title));
  // On exclut d'emblée les œuvres sans titre exploitable (choix ambigu, illisible dans la liste)
  // et tout doublon de contenu (même couple auteur+titre, même si ce sont deux lignes distinctes).
  let others = pool.filter((r) => r !== correct && r.title && r.title.trim() && contentKey(r) !== correctKey);
  // Quand seul le nom de l'artiste sera affiché (pas de titre pour distinguer), il FAUT trois
  // artistes différents, sinon deux « Monet » pourraient se retrouver face à face.
  if (requireDistinctArtist) others = others.filter((r) => !usedArtists.has(famNormalize(r.artist)));
  let candidates = correctWords.size ? others.filter((r) => intrusTitleWords(r.title).some((w) => correctWords.has(w))) : [];
  const picked = [];
  const drawFrom = (list) => {
    const copy = list.filter((r) => !picked.includes(r) && !usedKeys.has(contentKey(r)) && (!requireDistinctArtist || !usedArtists.has(famNormalize(r.artist))));
    while (picked.length < 2 && copy.length) {
      const idx = Math.floor(Math.random() * copy.length);
      const chosen = copy.splice(idx, 1)[0];
      picked.push(chosen);
      usedKeys.add(contentKey(chosen));
      usedArtists.add(famNormalize(chosen.artist));
    }
  };
  drawFrom(candidates);
  if (picked.length < 2) drawFrom(others.filter((r) => r.artist !== correct.artist));
  if (picked.length < 2) drawFrom(others);
  return picked;
}

$('intrus-start-button')?.addEventListener('click', async () => {
  handleExtendAndRemember('intrus', 'intrus-setup-panel');
  saveLastSelection('intrus-setup-panel');
  let arts = intrusSelectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = intrusSelectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  let levels = intrusSelectedLevels(); if (!levels.length) levels = ['1','2','3'];
  const feedback = $('intrus-setup-feedback');
  feedback.classList.remove('hidden');
  feedback.textContent = 'Chargement des œuvres…';
  try {
    const zones = intrusSelectedZones();
    let allRows = [];
    for (const art of arts) {
      for (const century of centuries) {
        try { allRows.push(...(await fetchQuizRows(art, century))); } catch (e) { /* fichier absent, ignoré */ }
      }
    }
    if (allRows.length < 3) { feedback.textContent = "Pas assez d'œuvres disponibles pour ce choix (3 minimum)."; return; }
    let pool = allRows.filter((r) => levels.includes(String(r.niveau || 1)));
    if (pool.length < 3) pool = allRows;
    if (zones.length) {
      const zoned = pool.filter((r) => { const z = zoneOfNationality(r.nationality); return !z || zones.includes(z); });
      if (zoned.length >= 3) pool = zoned;
    }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const countChoice = document.querySelector('input[name="intrus-count"]:checked').value;
    const count = countChoice === 'max' ? pool.length : Math.min(Number(countChoice), pool.length);
    intrusAudioOn = getGlobalPrefs().audioOn;
    intrusSelectedVoice = getGlobalVoice();
    intrusAutoAdvance = $('intrus-opt-autoadvance').checked;
    intrusAutoAdvanceDelay = Number($('intrus-opt-delay').value);
    intrusExtraFields = ['date', 'materiaux', 'dimensions', 'location'].filter((k) => $(`intrus-field-${k}`)?.checked);
    if (!intrusExtraFields.length) intrusExtraFields = ['date', 'materiaux', 'dimensions', 'location'];
    INTRUS_SESSION = pool.slice(0, count).map((correct) => {
      // En mode « Références intruses », on ne montre le plus souvent que le nom de l'artiste (le
      // cas le plus fréquent et le plus exigeant), et parfois artiste + titre pour varier. Sans
      // titre affiché, il faut impérativement 3 artistes différents pour éviter deux choix
      // identiques (ex. deux « Monet »).
      const titleMode = intrusMode === 'reference' ? Math.random() < 0.3 : true;
      const distractors = pickIntrusDistractors(correct, pool, intrusMode === 'reference' && !titleMode);
      const choices = [correct, ...distractors];
      for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
      return { correct, choices, titleMode };
    });
    intrusIndex = 0; intrusCorrectCount = 0;
    $('intrus-title-label').textContent = `Intrus — ${intrusMode === 'image' ? 'images intruses' : 'références intruses'}`;
    showPanel('intrus');
    intrusTimer.start();
    intrusShowQuestion();
  } catch (error) {
    feedback.textContent = `Erreur : ${error.message}`;
  }
});

function intrusShowQuestion() {
  speechSynthesis.cancel();
  intrusTimers.forEach(clearTimeout); intrusTimers = [];
  intrusAnswered = false;
  const q = INTRUS_SESSION[intrusIndex];
  $('intrus-progress-label').textContent = `Question ${intrusIndex + 1} / ${INTRUS_SESSION.length}`;
  $('intrus-score-label').textContent = `${intrusCorrectCount} / ${intrusIndex} réponse${intrusCorrectCount > 1 ? 's' : ''} correcte${intrusCorrectCount > 1 ? 's' : ''}`;
  $('intrus-progress-bar').style.width = `${(intrusIndex / INTRUS_SESSION.length) * 100}%`;
  $('intrus-correction').classList.add('hidden');
  $('intrus-choices').classList.remove('hidden');

  const promptCard = $('intrus-prompt-card');
  if (intrusMode === 'image') {
    // Les 3 images (choix) occupent la grande zone de gauche, en plus grand ; la référence à
    // retrouver s'affiche à droite, avec le même espacement de rubrique que la correction.
    promptCard.innerHTML = `<div class="intrus-image-choices">${q.choices.map((c, i) =>
      `<button type="button" class="intrus-image-choice" data-index="${i}"><img src="${escapeHtml(imageSource(c.image))}" alt="" /></button>`
    ).join('')}</div>`;
    promptCard.querySelectorAll('.intrus-image-choice').forEach((btn) => {
      btn.addEventListener('click', () => intrusAnswer(Number(btn.dataset.index)));
    });
    $('intrus-choices').innerHTML = `<div class="correction-details">
      <span class="correction-label">Auteur</span><span class="correction-value">${escapeHtml(q.correct.artist)}</span>
      <span class="correction-label">Titre de l'œuvre</span><span class="correction-value"><em>« ${escapeHtml(q.correct.title)} »</em></span>
    </div>`;
    intrusSpeak(`${q.correct.artist} — « ${q.correct.title} »`);
  } else {
    // Image en haut à gauche. Choix à droite : le plus souvent le nom du peintre seul (le cas
    // le plus exigeant), parfois artiste + titre pour varier (q.titleMode).
    promptCard.innerHTML = `<img src="${escapeHtml(imageSource(q.correct.image))}" alt="" style="max-width:100%;max-height:min(820px,74vh);display:block;" />`;
    $('intrus-choices').innerHTML = `<div class="intrus-choice-list">${q.choices.map((c, i) =>
      q.titleMode
        ? `<button type="button" class="intrus-choice-btn" data-index="${i}"><strong>${escapeHtml(c.artist)}</strong><br><em>« ${escapeHtml(c.title || c.date || 'œuvre non titrée')} »</em></button>`
        : `<button type="button" class="intrus-choice-btn" data-index="${i}"><strong>${escapeHtml(c.artist)}</strong></button>`
    ).join('')}</div>`;
    $('intrus-choices').querySelectorAll('.intrus-choice-btn').forEach((btn) => {
      btn.addEventListener('click', () => intrusAnswer(Number(btn.dataset.index)));
    });
  }
}

function intrusAnswer(chosenIndex) {
  if (intrusAnswered) return;
  intrusAnswered = true;
  const q = INTRUS_SESSION[intrusIndex];
  const chosen = q.choices[chosenIndex];
  const isCorrect = chosen === q.correct;
  if (isCorrect) intrusCorrectCount++;

  const choiceSelector = intrusMode === 'image' ? '.intrus-image-choice' : '.intrus-choice-btn';
  const verdictHtml = ` <span class="intrus-verdict" style="color:${isCorrect ? 'var(--ok)' : 'var(--wrong)'}">${isCorrect ? '— Exact' : '— À réviser'}</span>`;
  // Images intruses : on garde uniquement la BONNE image (en grand) ; en référence intruses, on
  // garde uniquement la case CHOISIE (avec son verdict écrit dedans) — les deux autres disparaissent.
  const keepIndex = intrusMode === 'image' ? q.choices.indexOf(q.correct) : chosenIndex;
  document.querySelectorAll(`#intrus-prompt-card ${choiceSelector}, #intrus-choices ${choiceSelector}`).forEach((btn, i) => {
    btn.disabled = true;
    if (i === keepIndex) {
      if (intrusMode !== 'image') btn.insertAdjacentHTML('beforeend', verdictHtml);
    } else {
      btn.remove();
    }
  });
  if (intrusMode === 'image') {
    const kept = $('intrus-prompt-card').querySelector('.intrus-image-choice');
    if (kept) kept.classList.add('intrus-image-choice-solo');
    // On ne garde plus la référence initiale (Auteur/Titre) affichée à droite : juste le verdict.
    $('intrus-choices').innerHTML = `<p style="text-align:center;font-family:Arial,sans-serif;font-weight:700;font-size:1.1rem;color:${isCorrect ? 'var(--ok)' : 'var(--wrong)'}">${isCorrect ? 'Exact' : 'À réviser'}</p>`;
  }

  const dims = formatDimensionsDisplay(q.correct);
  intrusSpeak(spokenFullReference(q.correct));
  const detailsParts = [];
  detailsParts.push(`<span class="correction-label">Auteur</span><span class="correction-value">${escapeHtml(q.correct.artist)}</span>`);
  detailsParts.push(`<span class="correction-label">Titre de l'œuvre</span><span class="correction-value"><em>« ${escapeHtml(q.correct.title)} »</em></span>`);
  if (intrusExtraFields.includes('date')) detailsParts.push(`<span class="correction-label">Date</span><span class="correction-value">${escapeHtml(q.correct.date || '—')}</span>`);
  if (intrusExtraFields.includes('materiaux') && q.correct.materials) detailsParts.push(`<span class="correction-label">Matériau</span><span class="correction-value">${escapeHtml(q.correct.materialsPhrase || q.correct.materials)}</span>`);
  if (intrusExtraFields.includes('dimensions') && dims) detailsParts.push(`<span class="correction-label">Dimensions</span><span class="correction-value">${dims}</span>`);
  if (intrusExtraFields.includes('location')) detailsParts.push(`<span class="correction-label">Lieu</span><span class="correction-value">${escapeHtml(q.correct.location || '—')}</span>`);
  $('intrus-correction-details').innerHTML = detailsParts.join('');
  $('intrus-correction').classList.remove('hidden');
  $('intrus-score-label').textContent = `${intrusCorrectCount} / ${intrusIndex + 1} réponse${intrusCorrectCount > 1 ? 's' : ''} correcte${intrusCorrectCount > 1 ? 's' : ''}`;
  $('intrus-next-button').textContent = intrusIndex === INTRUS_SESSION.length - 1 ? 'Terminer' : 'Suivant →';
  if (intrusAutoAdvance) intrusTimers.push(setTimeout(() => $('intrus-next-button')?.click(), intrusAutoAdvanceDelay));
}

$('intrus-next-button')?.addEventListener('click', async () => {
  if (intrusIndex < INTRUS_SESSION.length - 1) {
    intrusIndex++;
    intrusShowQuestion();
  } else {
    // Fin de l'exercice : enregistrement du score, à part des scores de quiz.
    if (firebaseReady && currentUser) {
      try {
        await db.collection('users').doc(currentUser.uid).collection('scores').add({
          type: 'entrainement',
          exerciseName: 'Intrus',
          timeSpent: intrusTimer.stop(),
          correct: intrusCorrectCount, possible: INTRUS_SESSION.length,
          percent: Math.round((intrusCorrectCount / INTRUS_SESSION.length) * 100),
          questionCount: INTRUS_SESSION.length,
          quizLabel: `Intrus — ${intrusMode === 'image' ? 'images intruses' : 'références intruses'}`,
          quizLevel: intrusSelectedLevels().map((lvl) => `Niveau ${lvl}`).join(' + '),
          quizArts: intrusSelectedArts(), quizCenturies: intrusSelectedCenturies(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { /* enregistrement best-effort */ }
    }
    showPanel('intrus-setup');
    const feedback = $('intrus-setup-feedback');
    feedback.classList.remove('hidden');
    feedback.textContent = `Terminé : ${intrusCorrectCount} / ${INTRUS_SESSION.length} bonnes réponses.`;
  }
});

document.querySelectorAll('.modal-close').forEach((button) => {
  button.addEventListener('click', () => { closeModal(button.dataset.modal); updateSelectorSummaries(); });
});
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (event) => { if (event.target === overlay) { overlay.classList.add('hidden'); updateSelectorSummaries(); } });
});

// Avertissement affiché une fois (par session, ou définitivement si « Ne plus afficher » a été
// coché — mémorisé sur l'appareil) dès que le 20e siècle est coché.
let century20eNoticeShown = false;
$('century-20e')?.addEventListener('change', (event) => {
  if (event.target.checked && !century20eNoticeShown && localStorage.getItem('century20eNoticeDismissed') !== 'true') {
    century20eNoticeShown = true;
    openModal('modal-century-20e-notice');
  }
});
$('century-20e-notice-close')?.addEventListener('click', () => {
  if ($('century-20e-notice-dismiss')?.checked) localStorage.setItem('century20eNoticeDismissed', 'true');
});
function selectedArts() { return ['peinture', 'sculpture'].filter((art) => $(`art-${art}`).checked); }
function selectedCenturies() { return ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].filter((century) => $(`century-${century}`).checked); }
function selectedZones() { return ['france', 'europe', 'amerique', 'asie'].filter((zone) => $(`zone-${zone}`)?.checked); }
const ZONE_LABELS = { france: 'France', europe: "Autres pays d'Europe", amerique: 'Amérique', asie: 'Asie' };
// Zone géographique déduite de la nationalité (colonne I, texte libre) : rattachement par
// sous-chaîne, dans le même esprit que NATIONALITY_FLAGS. "france" est à part des autres pays
// européens, comme demandé (un joueur peut vouloir réviser "France" seule vs "reste de l'Europe").
const ZONE_BY_NATIONALITY_KEYWORD = {
  france: ['francaise', 'francais'],
  europe: [
    'italienne', 'italien', 'espagnole', 'espagnol', 'catalane', 'catalan', 'flamande', 'flamand',
    'belge', 'hollandaise', 'hollandais', 'neerlandaise', 'neerlandais', 'allemande', 'allemand',
    'autrichienne', 'autrichien', 'suisse', 'anglaise', 'anglais', 'britannique', 'ecossaise',
    'ecossais', 'irlandaise', 'irlandais', 'russe', 'portugaise', 'portugais', 'danoise', 'danois',
    'norvegienne', 'norvegien', 'suedoise', 'suedois', 'finlandaise', 'finlandais', 'polonaise',
    'polonais', 'tcheque', 'boheme', 'hongroise', 'hongrois', 'grecque', 'grec', 'byzantine',
    'byzantin', 'croate', 'ukrainienne', 'ukrainien', 'bulgare', 'bielorusse', 'maltaise', 'suedoise',
  ],
  amerique: ['americaine', 'americain', 'mexicaine', 'mexicain', 'canadienne', 'canadien', 'bresilienne', 'bresilien', 'argentine'],
  asie: ['chinoise', 'chinois', 'japonaise', 'japonais', 'coreenne', 'coreen', 'indienne', 'indien', 'persane', 'persan', 'iranienne', 'iranien'],
};
function zoneOfNationality(rawValue) {
  const key = keyName(rawValue);
  if (!key) return null;
  for (const zone of Object.keys(ZONE_BY_NATIONALITY_KEYWORD)) {
    if (ZONE_BY_NATIONALITY_KEYWORD[zone].some((kw) => key.includes(kw))) return zone;
  }
  return null;
}
function selectedLevels() { return ['1', '2', '3'].filter((lvl) => $(`level-${lvl}`).checked); }
function selectedQuestionCount() { const checked = document.querySelector('input[name="nb-questions"]:checked'); return checked ? checked.value : '30'; }
function updateSelectorSummaries() {
  const arts = selectedArts();
  const artText = arts.length ? arts.map((a) => ART_LABELS[a]).join(', ') : 'Aucun art choisi';
  const centuries = selectedCenturies();
  const zones = selectedZones();
  const centuryText = centuries.length ? centuries.map((c) => CENTURY_LABELS[c]).join(', ') : 'Aucun siècle choisi';
  const zoneText = zones.length ? ` · ${zones.map((z) => ZONE_LABELS[z]).join(', ')}` : '';
  const rubriques = allFields.filter((field) => $(field.checkbox).checked).map((field) => field.label);
  const rubriquesText = rubriques.length ? rubriques.join(', ') : 'Aucune rubrique choisie';
  const levels = selectedLevels();
  const count = selectedQuestionCount();
  const countText = count === 'max' ? 'maximum disponible' : `${count} questions`;
  const levelsText = levels.length ? levels.map((lvl) => LEVEL_LABELS[lvl]).join(' + ') : '';
  const levelText = levels.length ? `${levelsText} — ${countText}` : 'Aucun niveau choisi';
  // Conservé pour le récapitulatif (showQuizSummary), qui reprend ces mêmes textes.
  state.selectorSummaries = { artText, centuryText: centuryText + zoneText, rubriquesText, levelText };
}
updateSelectorSummaries();
refreshAccordionLabels();

const LEVEL_QUESTION_COUNTS = { '1': 30, '2': 60, '3': 120 };

async function fetchQuizRows(art, century) {
  // Un seul fichier par (art, siècle) désormais : le filtrage par niveau se fait côté appli via
  // la colonne "Niveau" de chaque ligne (voir plus bas), plus de suffixe "-niveauX" dans l'URL.
  const url = `quizzes/${art}-${century}.xlsx`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('fichier introuvable');
  const buffer = await response.arrayBuffer();
  const book = XLSX.read(buffer, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
  return normaliseRows(rows).map((q) => ({ ...q, art }));
}

$('launch-quiz-button')?.addEventListener('click', async () => {
  const arts = selectedArts();
  const centuries = selectedCenturies();
  const levels = selectedLevels();
  const chosenKeys = allFields.filter((field) => $(field.checkbox).checked).map((field) => field.key);
  const feedback = $('launch-feedback');
  feedback.classList.remove('hidden');
  if (!arts.length) { feedback.textContent = 'Choisissez au moins un art (« Choisissez votre art »).'; return; }
  if (!centuries.length) { feedback.textContent = 'Choisissez au moins un siècle (« Choisissez votre siècle »).'; return; }
  if (!levels.length) { feedback.textContent = 'Choisissez au moins un niveau (« Choisissez votre niveau »).'; return; }
  if (!chosenKeys.length) { feedback.textContent = 'Choisissez au moins une rubrique à réviser (« Choisissez vos rubriques »).'; return; }
  // Mémorise la configuration choisie (sur l'appareil) si la case est cochée, pour la retrouver
  // au prochain jeu sans repasser par tout le menu de sélection.
  if ($('remember-choice-checkbox')?.checked) {
    localStorage.setItem('savedQuizConfig', JSON.stringify({
      arts, centuries, zones: selectedZones(), levels, chosenKeys,
      count: selectedQuestionCount(), savedAt: new Date().toISOString(),
    }));
  }
  feedback.textContent = 'Chargement du quiz…';
  try {
    if (!window.XLSX) throw new Error('Le module de lecture Excel n’a pas été chargé. Vérifiez votre connexion Internet et rechargez la page.');
    const zones = selectedZones();
    const allRows = [];
    const missing = []; // combinaisons art/siècle sans fichier du tout : signalées, sans bloquer le quiz
    // Un seul fichier par (art, siècle) désormais ; le niveau ne détermine plus quel fichier
    // charger, seulement quelles lignes en garder (colonne "Niveau", filtrage exact juste après).
    // Chaque niveau est un réservoir indépendant ; les mélanger suppose de sélectionner
    // plusieurs niveaux conjointement dans l'interface.
    for (const art of arts) {
      for (const century of centuries) {
        try {
          allRows.push(...(await fetchQuizRows(art, century)));
        } catch (error) {
          missing.push(`${ART_LABELS[art]} — ${CENTURY_LABELS[century]}`);
        }
      }
    }
    if (!allRows.length) throw new Error('Ce site est en construction. Le quiz sera bientôt disponible.');
    if (missing.length) {
      alert(`Ce site est en construction pour : ${missing.join(', ')}. Le quiz continue avec les autres choix disponibles.`);
    }
    // Conservé pour la page « autres œuvres » : elle doit retrouver tout ce que la base connaît
    // d'un artiste, même les œuvres d'un autre niveau que celui choisi pour ce quiz.
    state.allRowsForArtistLookup = allRows;
    // Filtre par niveau (indépendant) : seules les œuvres des niveaux sélectionnés sont gardées.
    let levelFilteredRows = allRows.filter((r) => levels.includes(String(r.niveau || 1)));
    if (!levelFilteredRows.length) levelFilteredRows = allRows; // filet de sécurité si la colonne Niveau est absente/mal renseignée
    // Filtre par zone géographique (colonne Nationalité) : les œuvres sans nationalité connue
    // restent incluses dans tous les cas, pour ne pas écarter des fichiers pas encore renseignés.
    let filteredRows = levelFilteredRows;
    if (zones.length) {
      filteredRows = levelFilteredRows.filter((r) => {
        const z = zoneOfNationality(r.nationality);
        return !z || zones.includes(z);
      });
      if (!filteredRows.length) {
        feedback.textContent = 'Aucune œuvre disponible pour cette combinaison siècle(s) / zone(s). Essayez une autre zone.';
        return;
      }
    }
    // Le nombre de questions est choisi indépendamment du niveau (ex. 30 questions piochées
    // dans un réservoir de niveau 3).
    const requestedCount = selectedQuestionCount();
    let targetCount = requestedCount === 'max' ? filteredRows.length : parseInt(requestedCount, 10);
    if (filteredRows.length < targetCount) {
      targetCount = filteredRows.length;
      alert(`Pas assez de questions disponibles pour ce choix. Le quiz démarre avec les ${filteredRows.length} questions disponibles.`);
    }
    const shuffled = shuffleQuestions(filteredRows);
    state.selectedFieldKeys = chosenKeys;
    state.mode = 'normal';
    state.fullQuestions = shuffled.slice(0, targetCount);
    state.questions = state.fullQuestions;
    state.answers = []; state.index = 0;
    state.currentScoreSaved = false;
    // Conserve la configuration du quiz (art, siècle, niveau, nombre de questions, rubriques
    // testées) pour l'historique des scores : deux quiz avec des rubriques différentes n'ont pas
    // la même difficulté et ne doivent donc pas partager la même colonne d'évolution.
    const effectiveLevelLabel = `${levels.map((lvl) => LEVEL_LABELS[lvl]).join(' + ') || 'Niveau'} — ${targetCount} questions`;
    const rubriqueLabels = chosenKeys.map((key) => allFields.find((f) => f.key === key)?.label || key);
    // Repère court affiché en haut de l'écran de quiz et de correction. Volontairement abrégé et
    // SANS le nombre de questions (déjà visible via la barre de progression) pour gagner de la
    // place à l'écran, notamment sur mobile : ex. "Peint. · 19e (Fr.) · Niveau 1".
    const artsAbbr = arts.map((a) => ART_ABBR[a]).join(' + ');
    const centuriesAbbr = centuries.map((c) => c.toUpperCase()).join('+');
    const zoneAbbr = zones.length ? ` (${zones.map((z) => ZONE_ABBR[z]).join(', ')})` : '';
    const levelAbbr = levels.map((lvl) => `Niveau ${lvl}`).join('+');
    const quizReference = `${artsAbbr} · ${centuriesAbbr}${zoneAbbr} · ${levelAbbr}`;
    state.quizConfig = {
      arts: arts.map((a) => ART_LABELS[a]),
      centuries: centuries.map((c) => CENTURY_LABELS[c]),
      level: effectiveLevelLabel,
      rubriques: rubriqueLabels,
      label: `${arts.map((a) => ART_LABELS[a]).join(' + ')} · ${centuries.map((c) => CENTURY_LABELS[c]).join(', ')} · ${rubriqueLabels.join(', ')}`,
      reference: quizReference,
      signature: `${arts.slice().sort().join(',')}|${centuries.slice().sort().join(',')}|${levels.slice().sort().join('+')}-${targetCount}|${chosenKeys.slice().sort().join(',')}`,
    };
    const refEl = $('quiz-reference');
    if (refEl) refEl.textContent = quizReference;
    showPanel('quiz');
    quizTimer.start();
    renderQuestion();
  } catch (error) {
    // Le message « site en construction » se suffit à lui-même, sans préfixe « Erreur : ».
    feedback.textContent = error.message === 'Ce site est en construction. Le quiz sera bientôt disponible.' ? error.message : `Erreur : ${error.message}`;
  }
});
function finalizeCurrentAnswer() {
  const answer = answerFor(state.index);
  if (answer.checked) return; // déjà validée : on ne relit pas les champs (vidés depuis), pour ne pas écraser la réponse enregistrée
  saveInputs();
  answer.checked = true;
  // On vide les champs à l'écran une fois la réponse enregistrée : évite qu'un texte dicté
  // laissé dans un champ (faute d'avoir pu avancer vers un champ suivant) ne réapparaisse
  // par erreur sur la question suivante.
  allFields.forEach(({ input }) => { $(input).value = ''; });
}
function goToNextOrResults() {
  finalizeCurrentAnswer();
  if (state.index === state.questions.length - 1) { showResults(); }
  else { state.index++; renderQuestion(); }
}
$('answer-form').addEventListener('submit', (event) => {
  event.preventDefault();
  finalizeCurrentAnswer(); // note la réponse même si on ne clique jamais sur « Suivante »
  renderQuestion(); // affiche la correction ; on attend le clic sur « Suivante »
});
$('previous-button-overlay').addEventListener('click', () => {
  if (!answerFor(state.index).checked) saveInputs(); // ne pas écraser une réponse déjà validée (champs vidés depuis)
  if (state.index > 0) { state.index--; renderQuestion(); }
});
$('next-button-overlay').addEventListener('click', goToNextOrResults);
$('lightbox-close-button')?.addEventListener('click', () => $('image-lightbox').classList.add('hidden'));
// Recliquer sur l'image (ou le fond) referme aussi la visionneuse : plus fiable que le seul
// bouton ✕, notamment sur mobile.
$('lightbox-image')?.addEventListener('click', () => $('image-lightbox').classList.add('hidden'));
$('image-lightbox')?.addEventListener('click', (event) => { if (event.target.id === 'image-lightbox') $('image-lightbox').classList.add('hidden'); });
$('review-button').addEventListener('click', () => {
  // Reprendre depuis le début le même jeu de questions (normal ou révision en cours)
  showPanel('quiz'); state.index = 0; renderQuestion();
});
$('review-errors-button').addEventListener('click', () => {
  const missed = state.questions.filter((question, index) => !isFullyCorrect(state.answers[index], question));
  if (!missed.length) return;
  state.mode = 'review';
  state.questions = missed;
  state.answers = [];
  state.index = 0;
  state.currentScoreSaved = false;
  showPanel('quiz'); renderQuestion();
});
$('restart-full-button').addEventListener('click', () => {
  state.mode = 'normal';
  state.questions = state.fullQuestions;
  state.answers = [];
  state.index = 0;
  state.currentScoreSaved = false;
  showPanel('quiz'); renderQuestion();
});
$('view-my-results-button')?.addEventListener('click', () => { showPanel('account'); loadAccountPage(); });
$('download-my-report-button')?.addEventListener('click', async () => {
  const button = $('download-my-report-button');
  const originalText = button.textContent;
  button.disabled = true; button.textContent = 'Préparation du fichier…';
  try {
    if (!lastAccountLevelGroups) await fetchScoreLevelGroups();
    if (!lastAccountLevelGroups || !lastAccountLevelGroups.size) {
      alert('Aucun score enregistré pour le moment. Terminez un quiz pour commencer votre historique.');
      return;
    }
    downloadAccountTable();
  } finally {
    button.disabled = false; button.textContent = originalText;
  }
});

// Touche Entrée : clique le bouton d'action principal actuellement visible (Valider, Suivant,
// Commencer…), pour avancer d'écran en écran sans toucher la souris. On laisse le clavier ouvrir
// une nouvelle ligne si le joueur est dans un champ multi-ligne (aucun ici, mais par prudence),
// et on n'intercepte rien si un menu déroulant ou un élément non pertinent a le focus.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (!getGlobalPrefs().enterValidate) return;
  if (event.target.tagName === 'TEXTAREA') return;
  const visiblePanel = [...document.querySelectorAll('main.main-content > section')].find((s) => !s.classList.contains('hidden'));
  if (!visiblePanel) return;
  const candidate = [...visiblePanel.querySelectorAll('.primary-button:not(:disabled)')].find((btn) => btn.offsetParent !== null);
  if (candidate) { event.preventDefault(); candidate.click(); }
});

// Ouverture directe d'une section via une ancre d'URL (#base, #exercices) — sert à proposer de
// vrais liens « nouvel onglet » depuis le texte d'accueil et le menu hamburger, plutôt que de
// simples raccourcis internes qui n'ouvriraient rien dans un nouvel onglet séparé.
function openPanelFromHash() {
  if (location.hash === '#base') { showPanel('welcome'); $('menu-item-artistes')?.click(); }
  else if (location.hash === '#exercices') { showPanel('training-hub'); updateExerciseSummaries(); }
}
window.addEventListener('DOMContentLoaded', openPanelFromHash);
if (document.readyState !== 'loading') openPanelFromHash();

// Écoute les flèches précédent/suivant du navigateur : on rejoue le panneau mémorisé dans l'état
// d'historique plutôt que de laisser le navigateur quitter l'application. Le drapeau évite de
// réempiler une entrée d'historique en retour, ce qui romprait la pile précédent/suivant.
window.addEventListener('popstate', (event) => {
  suppressHistoryPush = true;
  showPanel(event.state?.panel || 'welcome');
  suppressHistoryPush = false;
});

// Le lien « Créez un compte » du texte d'accueil met en évidence le vrai bouton de connexion
// plutôt que de dupliquer sa logique.
$('intro-account-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  const loginBtn = $('account-login-button');
  loginBtn?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  loginBtn?.classList.add('intro-highlight');
  setTimeout(() => loginBtn?.classList.remove('intro-highlight'), 2000);
});
