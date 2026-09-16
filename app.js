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
// Bouton texte « Voir/Arrêter la correction complète » (bandeau du haut) — court-circuite la
// restriction de rubrique choisie, sans modifier ce choix lui-même. Reste actif d'une page à
// l'autre au sein d'une même session, jusqu'à ce que le joueur le désactive.
let showFullCorrection = false;
function toggleFullCorrection(rerenderFn) {
  showFullCorrection = !showFullCorrection;
  rerenderFn?.();
}
// Panneaux où ce bouton doit apparaître (les 4 exercices ayant un choix de rubrique), avec la
// fonction de réaffichage sûre à appeler quand elle existe (voir showPanel plus bas pour l'usage).
const FULL_CORRECTION_PANELS = { impregnation: () => { if (IMP_SESSION.length) impShowCurrent(); }, vraifaux: null, intrus: () => intrusRefreshCorrectionDetails(), reconstitution: () => reconRefreshCorrectionDetails() };
let db = null;
let currentUser = null;
let accountMode = 'login'; // 'login' | 'register'
const firebaseReady = FIREBASE_CONFIG.apiKey !== "VOTRE_API_KEY" && typeof firebase !== 'undefined';
if (firebaseReady) {
  firebase.initializeApp(FIREBASE_CONFIG);
  auth = firebase.auth();
  db = firebase.firestore();
  // Bug réel repéré (boutons du tableau d'accueil lents et capricieux sur PC) : la prévention de
  // suivi de certains navigateurs (Edge notamment) bloque l'accès au stockage nécessaire au canal
  // de connexion habituel de Firestore (WebChannel) — la connexion échoue alors en boucle (erreurs
  // 400 répétées dans la console), ce qui accapare le réseau et l'appareil en arrière-plan. Forcer
  // le repli sur le "long polling" (une méthode de connexion plus simple, moins dépendante du
  // stockage du navigateur) évite cette boucle d'échecs.
  try { db.settings({ experimentalAutoDetectLongPolling: true }); } catch (e) { /* ignoré si déjà configuré */ }
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
  renderSavedGuidedConfigsList();
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
// --- Page « Mon compte » à deux niveaux : le tableau de bord (les 6 boutons + le bouton vert,
// sans aucune case à cocher visible) et une page dédiée par choix (une seule section à la fois,
// les 5 autres boutons disparaissent). En haut d'une page dédiée : le bouton du choix courant
// (grisé, comme dans le menu), entouré de flèches pour aller au choix précédent/suivant sans
// repasser par le tableau de bord. Mes scores n'est pas une page de configuration : elle n'entre
// pas dans ce parcours (pas de flèche vers elle, on revient au tableau de bord pour valider). ---
const PROFILE_CONFIG_SEQUENCE = ['profile-menu-tech', 'profile-menu-esthetique', 'profile-menu-rubriques', 'profile-menu-fields', 'profile-menu-artists'];
function showProfileHub() {
  $('profile-menu-grid').classList.remove('hidden');
  $('profile-menu-grid-2').classList.remove('hidden');
  $('pf-validate-button').classList.remove('hidden');
  $('profile-hub-secondary-buttons').classList.remove('hidden');
  $('pf-section-nav').classList.add('hidden');
  document.querySelectorAll('.profile-menu-btn').forEach((b) => b.classList.add('inactive'));
  ['profile-section-tech', 'profile-section-esthetique', 'profile-section-fields', 'profile-section-artists', 'profile-section-rubriques', 'profile-section-configs'].forEach((id) => {
    $(id)?.classList.add('hidden');
  });
}
function showProfileSection(btn) {
  $('profile-menu-grid').classList.add('hidden');
  $('profile-menu-grid-2').classList.add('hidden');
  $('pf-validate-button').classList.add('hidden');
  // Sur une page dédiée (ex. Mes paramètres techniques), on ne montre plus « Mes configurations
  // enregistrées » ni « Mes scores » : le joueur doit comprendre que cette page ne concerne QUE
  // le réglage affiché — il les retrouve sur le tableau de bord général de Mon compte.
  $('profile-hub-secondary-buttons').classList.add('hidden');
  $('profile-section-configs')?.classList.add('hidden');
  document.querySelectorAll('.profile-menu-btn').forEach((b) => b.classList.toggle('inactive', b !== btn));
  ['profile-section-tech', 'profile-section-esthetique', 'profile-section-fields', 'profile-section-artists', 'profile-section-rubriques'].forEach((id) => {
    $(id)?.classList.toggle('hidden', id !== btn.dataset.target);
  });
  // Navigation par flèches en haut, à la place de la grille : le bouton courant grisé, avec une
  // flèche de chaque côté si un choix précédent/suivant existe dans le parcours.
  const idx = PROFILE_CONFIG_SEQUENCE.indexOf(btn.id);
  if (idx === -1) { $('pf-section-nav').classList.add('hidden'); return; }
  $('pf-section-nav').classList.remove('hidden');
  $('pf-section-current-label').innerHTML = btn.innerHTML.replace(/\sid="[^"]*"/g, '');
  $('pf-section-prev').style.visibility = idx > 0 ? 'visible' : 'hidden';
  $('pf-section-next').style.visibility = idx < PROFILE_CONFIG_SEQUENCE.length - 1 ? 'visible' : 'hidden';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('.profile-menu-btn').forEach((btn) => {
  btn.addEventListener('click', () => { showProfileSection(btn); });
});
$('profile-menu-scores')?.addEventListener('click', () => { showPanel('account'); loadAccountPage(); });
$('profile-menu-saved-configs')?.addEventListener('click', () => {
  $('profile-menu-grid').classList.add('hidden');
  $('profile-menu-grid-2').classList.add('hidden');
  $('pf-validate-button').classList.add('hidden');
  $('pf-section-nav').classList.add('hidden');
  // Page dédiée elle aussi : ni les 3 boutons de choix ni « Mes scores » ne doivent traîner ici,
  // pour que le joueur comprenne que cette page ne concerne que ses configurations enregistrées.
  $('profile-hub-secondary-buttons').classList.add('hidden');
  document.querySelectorAll('.profile-menu-btn').forEach((b) => b.classList.add('inactive'));
  ['profile-section-tech', 'profile-section-esthetique', 'profile-section-fields', 'profile-section-artists', 'profile-section-rubriques'].forEach((id) => $(id)?.classList.add('hidden'));
  $('profile-section-configs').classList.remove('hidden');
  renderProfileConfigsTable();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('pf-section-prev')?.addEventListener('click', () => {
  const idx = PROFILE_CONFIG_SEQUENCE.indexOf(document.querySelector('.profile-menu-btn:not(.inactive)')?.id);
  if (idx > 0) $(PROFILE_CONFIG_SEQUENCE[idx - 1])?.click();
});
$('pf-section-next')?.addEventListener('click', () => {
  const idx = PROFILE_CONFIG_SEQUENCE.indexOf(document.querySelector('.profile-menu-btn:not(.inactive)')?.id);
  if (idx > -1 && idx < PROFILE_CONFIG_SEQUENCE.length - 1) $(PROFILE_CONFIG_SEQUENCE[idx + 1])?.click();
});
document.querySelectorAll('.pf-back-to-menu-button').forEach((btn) => {
  btn.addEventListener('click', () => { showProfileHub(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
});
document.querySelectorAll('.pf-next-button').forEach((btn) => {
  btn.addEventListener('click', () => { $(btn.dataset.next)?.click(); });
});
// « Effacer la sélection » pour Technique et Esthétique (les seules 2 pages sans bouton dédié
// déjà existant) : remet les réglages à leur valeur par défaut, comme les autres pages le font
// pour leur propre choix.
document.querySelectorAll('.pf-clear-inline-button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const section = btn.closest('[id^="profile-section-"]');
    if (section?.id === 'profile-section-tech') {
      $('pf-show-timer').checked = false; setGlobalPref('showTimer', false);
      $('pf-enter-validate').checked = false; setGlobalPref('enterValidate', false);
      $('pf-show-explanations').checked = false; setGlobalPref('showExplanations', false);
      $('pf-show-rules').checked = true; setGlobalPref('showRules', true);
      $('pf-flags-artists').checked = true; setGlobalPref('flagsArtists', true);
      $('pf-flags-locations').checked = true; setGlobalPref('flagsLocations', true);
      $('pf-audio').checked = false; setGlobalPref('audioOn', false);
      $('pf-handedness').value = 'right';
      localStorage.setItem('handedness', 'righty');
      applyHandedness(false);
    } else if (section?.id === 'profile-section-esthetique') {
      const defaultRadio = document.querySelector('input[name="pf-ambiance"][value=""]');
      if (defaultRadio) defaultRadio.checked = true;
      applyAmbiance('');
      localStorage.removeItem('ambiance');
    }
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
  showProfileHub();
  loadProfilePhoto();
  $('profile-email').textContent = currentUser?.email || '';
  $('profile-resume-exercise-button')?.classList.toggle('hidden', !returnToExercisePanel);
  const prefs = getGlobalPrefs();
  $('pf-show-timer').checked = prefs.showTimer;
  $('pf-enter-validate').checked = prefs.enterValidate;
  $('pf-show-explanations').checked = prefs.showExplanations;
  $('pf-show-rules').checked = prefs.showRules;
  $('pf-flags-artists').checked = prefs.flagsArtists;
  $('pf-flags-locations').checked = prefs.flagsLocations;
  $('pf-audio').checked = prefs.audioOn;
  $('pf-handedness').value = document.body.classList.contains('lefty') ? 'left' : 'right';
  const savedAmbiance = localStorage.getItem('ambiance') || '';
  const ambianceRadio = document.querySelector(`input[name="pf-ambiance"][value="${savedAmbiance}"]`);
  if (ambianceRadio) ambianceRadio.checked = true;
  // Activé par défaut (case à DÉCOCHER pour s'en passer) — sur demande, la logique de valeur par
  // défaut s'inverse : « true » sauf si le joueur l'a explicitement désactivé une fois.
  if ($('pf-link-ambiance-field')) $('pf-link-ambiance-field').checked = localStorage.getItem('linkAmbianceToField') !== 'false';
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('fr'));
  $('pf-voice').innerHTML = voices.length
    ? voices.map((v) => `<option value="${escapeHtml(v.name)}" ${v.name === prefs.voiceName ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')
    : '<option value="">Voix par défaut du système</option>';
  let fieldDefaults = {};
  try { fieldDefaults = JSON.parse(localStorage.getItem('globalFieldDefaults') || '{}'); } catch (e) {}
  document.querySelectorAll('.pf-field-art').forEach((el) => { el.checked = (fieldDefaults.arts || []).includes(el.value); });
  document.querySelectorAll('.pf-field-century').forEach((el) => { el.checked = (fieldDefaults.centuries || []).includes(el.value); });
  document.querySelectorAll('.pf-field-zone').forEach((el) => { el.checked = (fieldDefaults.zones || []).includes(el.value); });
  // Le choix d'artiste(s) est une simple liste cliquable (voir populateArtistSuggestions), rien à
  // pré-remplir ici — elle se construit et se coche toute seule à l'ouverture de sa section.
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
  applyMonCompteExplanationsVisibility();
}
// Liste, sous chaque tableau (champ / rubrique), les exercices pour lesquels une sélection
// spécifique a été mémorisée (via l'icône ✏️ sur leur bouton) — avec un bouton pour l'oublier.
function renderExerciseOverrides() {
  const artLabel = { peinture: 'Peinture', sculpture: 'Sculpture' };
  const rows = { fields: [], rubriques: [] };
  Object.entries(EXERCISE_INFO).forEach(([prefix, info]) => {
    const idPrefix = prefix === 'quiz' ? '' : `${prefix}-`;
    let state;
    try { state = JSON.parse(localStorage.getItem(`lastSelection_${info.panel}`) || '{}'); } catch (e) { state = {}; }
    const checkedKeys = Object.keys(state).filter((k) => state[k]);
    if (!checkedKeys.length) return;
    const arts = checkedKeys.filter((k) => k.startsWith(`${idPrefix}art-`)).map((k) => artLabel[k.replace(`${idPrefix}art-`, '')]);
    const centuries = checkedKeys.filter((k) => k.startsWith(`${idPrefix}century-`)).map((k) => k.replace(`${idPrefix}century-`, ''));
    const zones = checkedKeys.filter((k) => k.startsWith(`${idPrefix}zone-`)).map((k) => k.replace(`${idPrefix}zone-`, ''));
    const levels = checkedKeys.filter((k) => k.startsWith(`${idPrefix}level-`)).map((k) => k.replace(`${idPrefix}level-`, ''));
    const fieldsList = checkedKeys.filter((k) => k.startsWith(`${idPrefix}field-`) || k.startsWith('rubrique-')).map((k) => k.replace(`${idPrefix}field-`, '').replace('rubrique-', ''));
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
function applyMonCompteExplanationsVisibility() {
  const show = getGlobalPrefs().showExplanations;
  $('pf-fields-explanation')?.classList.toggle('hidden', !show);
  $('pf-rubriques-explanation')?.classList.toggle('hidden', !show);
  $('pf-tech-explanation')?.classList.toggle('hidden', !show);
}
$('pf-show-explanations')?.addEventListener('change', () => {
  setGlobalPref('showExplanations', $('pf-show-explanations').checked);
  applyMonCompteExplanationsVisibility();
});
$('pf-show-rules')?.addEventListener('change', () => setGlobalPref('showRules', $('pf-show-rules').checked));
$('pf-flags-artists')?.addEventListener('change', () => setGlobalPref('flagsArtists', $('pf-flags-artists').checked));
$('pf-flags-locations')?.addEventListener('change', () => setGlobalPref('flagsLocations', $('pf-flags-locations').checked));
$('pf-audio')?.addEventListener('change', () => setGlobalPref('audioOn', $('pf-audio').checked));
$('pf-voice')?.addEventListener('change', () => setGlobalPref('voiceName', $('pf-voice').value));
$('pf-handedness')?.addEventListener('change', () => {
  const lefty = $('pf-handedness').value === 'left';
  localStorage.setItem('handedness', lefty ? 'lefty' : 'righty');
  applyHandedness(lefty);
});

// --- Ambiance esthétique (Mon compte) : change juste l'accent de couleur et le fond de page,
// mémorisé sur l'appareil. Valeur vide = apparence actuelle, inchangée.
function applyAmbiance(value) {
  if (value) document.body.setAttribute('data-ambiance', value);
  else document.body.removeAttribute('data-ambiance');
}
applyAmbiance(localStorage.getItem('ambiance') || '');
document.querySelectorAll('input[name="pf-ambiance"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    localStorage.setItem('ambiance', radio.value);
    applyAmbiance(radio.value);
  });
});
$('pf-link-ambiance-field')?.addEventListener('change', (e) => {
  localStorage.setItem('linkAmbianceToField', e.target.checked ? 'true' : 'false');
});
// Bouton d'accès rapide dans le bandeau (icône 🎨) : change l'ambiance à la volée, y compris en
// plein exercice, sans avoir à quitter pour passer par Mon compte.
$('global-ambiance-button')?.addEventListener('click', (event) => {
  event.stopPropagation();
  const picker = $('ambiance-quick-picker');
  const opening = picker.classList.contains('hidden');
  if (opening) {
    const current = localStorage.getItem('ambiance') || '';
    const radio = document.querySelector(`input[name="quick-ambiance"][value="${current}"]`);
    if (radio) radio.checked = true;
  }
  picker.classList.toggle('hidden');
});
document.querySelectorAll('input[name="quick-ambiance"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    localStorage.setItem('ambiance', radio.value);
    applyAmbiance(radio.value);
    const mainRadio = document.querySelector(`input[name="pf-ambiance"][value="${radio.value}"]`);
    if (mainRadio) mainRadio.checked = true;
  });
});
document.addEventListener('click', (event) => {
  const picker = $('ambiance-quick-picker');
  if (!picker || picker.classList.contains('hidden')) return;
  if (!picker.contains(event.target) && event.target !== $('global-ambiance-button')) {
    picker.classList.add('hidden');
  }
});

// --- Choix de champ (art/siècle/zone) : si mémorisé, chaque bouton d'exercice démarre
// directement dessus, sans repasser par sa page de configuration. ---
function saveFieldChoiceGeneral() {
  sessionStorage.setItem('hasConfiguredThisSession', 'true');
  const arts = [...document.querySelectorAll('.pf-field-art:checked')].map((el) => el.value);
  const centuries = [...document.querySelectorAll('.pf-field-century:checked')].map((el) => el.value);
  const zones = [...document.querySelectorAll('.pf-field-zone:checked')].map((el) => el.value);
  localStorage.setItem('globalFieldDefaults', JSON.stringify({ arts, centuries, zones, remember: true }));
  updateExerciseSummaries();
  updateProfileMenuBadges();
  // Le champ vient de changer : la liste d'artistes compatibles change avec lui, et un artiste
  // déjà choisi peut être devenu incompatible — on rafraîchit les suggestions et on revalide.
  populateArtistSuggestions();
}
// Enregistrement automatique à chaque coche — comme les paramètres techniques juste au-dessus,
// plutôt que d'exiger un clic sur « Appliquer » qu'on peut oublier.
document.querySelectorAll('.pf-field-art, .pf-field-century, .pf-field-zone').forEach((el) => {
  el.addEventListener('change', saveFieldChoiceGeneral);
});
$('pf-fields-apply')?.addEventListener('click', saveFieldChoiceGeneral);
$('pf-fields-clear')?.addEventListener('click', () => {
  localStorage.removeItem('globalFieldDefaults');
  document.querySelectorAll('.pf-field-art, .pf-field-century, .pf-field-zone').forEach((el) => { el.checked = false; });
  updateExerciseSummaries();
  updateProfileMenuBadges();
  populateArtistSuggestions();
});

// --- Choix d'artiste(s) : section séparée, qui affine le champ et le niveau ci-dessus plutôt que
// de les remplacer — on clique un nom dans la liste pour le sélectionner/désélectionner, la liste
// elle-même ne montrant que des artistes déjà compatibles (impossible donc de choisir ici un
// artiste qui contredirait un choix précédent). ---
// Un artiste est éligible s'il correspond à l'art/siècle/zone actuellement cochés — un champ vide
// pour une dimension donnée ne restreint rien sur cette dimension (comportement identique à
// celui des exercices eux-mêmes : rien coché = tout accepté).
function artistMatchesCurrentField(row) {
  const fields = readGlobalFieldDefaults();
  const rowArts = String(row['Art(s)'] || '').split(',').map((s) => s.trim().toLocaleLowerCase('fr-FR'));
  const rowCenturies = String(row['Siècle(s)'] || '').split(',').map((s) => s.trim());
  if (fields.arts?.length && !rowArts.some((a) => fields.arts.includes(a))) return false;
  if (fields.centuries?.length && !rowCenturies.some((c) => fields.centuries.includes(c))) return false;
  if (fields.zones?.length) {
    const z = zoneOfNationality(row['Nationalité']);
    if (z && !fields.zones.includes(z)) return false;
  }
  return true;
}
async function populateArtistSuggestions() {
  const list = $('pf-artist-clickable-list');
  const status = $('pf-artist-list-status');
  if (!list) return;
  status.textContent = 'Chargement de la liste des artistes…';
  const ok = await loadArtistListIfNeeded();
  if (!ok) {
    status.textContent = "La liste des artistes n'a pas pu être chargée (connexion internet ?).";
    list.innerHTML = '';
    return;
  }
  let matchingRows = artistListRows.filter(artistMatchesCurrentField);
  // Le niveau de célébrité n'est pas une colonne du fichier maître des artistes — il se lit sur
  // leurs œuvres elles-mêmes (colonne Niveau des fichiers quiz). On ne va vérifier ceci œuvre par
  // œuvre que si la liste est déjà raisonnablement réduite par le champ (sinon, trop d'artistes à
  // interroger un par un pour rester fluide) — sinon on affiche la liste filtrée par champ seule.
  const levels = readGlobalRubriqueDefaults().levels || [];
  if (levels.length && matchingRows.length <= 80) {
    status.textContent = 'Vérification du niveau des artistes…';
    const kept = [];
    for (const row of matchingRows) {
      const works = await fetchWorksForArtistRow(row);
      if (!works.length || works.some((w) => levels.includes(String(w.niveau || 1)))) kept.push(row);
    }
    matchingRows = kept;
  }
  const names = matchingRows.map((r) => [r['Prénom'], r['Patronyme']].filter(Boolean).join(' ').trim())
    .filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr'));
  const selected = (readGlobalArtistDefaults().artists || []);
  list.innerHTML = names.map((name) => {
    const isSel = selected.includes(name);
    return `<button type="button" class="pf-artist-pick" data-name="${escapeHtml(name)}" style="display:block;width:100%;text-align:left;padding:7px 10px;border:0;cursor:pointer;font:inherit;border-radius:4px;margin-bottom:2px;background:${isSel ? 'var(--accent)' : 'none'};color:${isSel ? '#fff' : 'inherit'};font-weight:${isSel ? '700' : '400'};">${isSel ? '✓ ' : ''}${escapeHtml(name)}</button>`;
  }).join('');
  list.querySelectorAll('.pf-artist-pick').forEach((btn) => {
    btn.addEventListener('click', () => toggleArtistSelection(btn.dataset.name));
  });
  status.textContent = `${names.length} artiste${names.length > 1 ? 's' : ''} compatible${names.length > 1 ? 's' : ''} avec vos choix de niveau et de champ actuels. Cochez des noms si vous voulez réduire le jeu aux artistes cochés. Attention, les artistes les plus célèbres (de niveau 1) ont au moins 12 œuvres dans la base, ceux de niveau 2, 8 œuvres et ceux de niveau 3, 4 œuvres. Si vous voulez jouer avec peu d'artistes, sélectionnez-en tout de même plusieurs pour que les jeux offrent de vrais choix de réponse.`;
}
function toggleArtistSelection(name) {
  sessionStorage.setItem('hasConfiguredThisSession', 'true');
  const current = readGlobalArtistDefaults().artists || [];
  const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
  localStorage.setItem('globalArtistDefaults', JSON.stringify({ artists: next, remember: true }));
  updateExerciseSummaries();
  updateProfileMenuBadges();
  populateArtistSuggestions(); // rafraîchit la liste pour montrer la coche à jour
}
$('pf-artists-clear')?.addEventListener('click', () => {
  localStorage.removeItem('globalArtistDefaults');
  updateExerciseSummaries();
  updateProfileMenuBadges();
  populateArtistSuggestions();
});
$('profile-menu-artists')?.addEventListener('click', populateArtistSuggestions);
// « Aller au choix suivant » : simple raccourci qui clique le bouton de menu correspondant, pour
// avancer dans l'ordre logique (technique → esthétique → rubrique/niveau → champ → artiste →
// scores) sans devoir remonter chercher le bon bouton en haut de page à chaque fois.
document.querySelectorAll('.pf-next-button').forEach((btn) => {
  btn.addEventListener('click', () => { $(btn.dataset.next)?.click(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
});
// --- Choix de rubrique et de niveau : idem, sur ce qui est testé et le niveau. Enregistrement
// automatique à chaque coche, comme ci-dessus. ---
// Résumés en temps réel sur les boutons de menu et le bouton vert — pour voir d'un coup d'œil,
// en progressant, ce qui a déjà été choisi. Rien coché nulle part = rien n'apparaît (pas de
// placeholder trompeur laissant croire à un choix qui n'existe pas).
// Le bouton vert ne doit rien montrer tant que le joueur n'a rien choisi DURANT CETTE SESSION —
// sinon, en revenant un autre jour, il afficherait encore les choix d'une session précédente,
// qu'on ne veut pas voir resurgir silencieusement. On marque donc la session dès qu'un choix
// change (voir saveFieldChoiceGeneral / saveRubriqueChoiceGeneral / saveArtistChoiceGeneral).
function updateProfileMenuBadges() {
  if ($('pf-validate-summary')) {
    if (sessionStorage.getItem('hasConfiguredThisSession') !== 'true') {
      $('pf-validate-summary').textContent = '';
      return;
    }
    const gr = readGlobalRubriqueDefaults();
    const gf = readGlobalFieldDefaults();
    const ga = readGlobalArtistDefaults();
    const rubriqueParts = [];
    if (gr.levels?.length) rubriqueParts.push('N' + gr.levels.join('+'));
    if (gr.rubriques?.length) rubriqueParts.push(gr.rubriques.join('+'));
    const fieldParts = [];
    if (gf.arts?.length) fieldParts.push(gf.arts.map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join('+'));
    if (gf.centuries?.length) fieldParts.push(gf.centuries.join('+'));
    if (gf.zones?.length) fieldParts.push(gf.zones.length + ' zone(s)');
    const all = [...rubriqueParts, ...fieldParts];
    if (ga.artists?.length) all.push(ga.artists.slice(0, 3).join(', ') + (ga.artists.length > 3 ? '…' : ''));
    $('pf-validate-summary').textContent = all.length ? all.join(' · ') : 'Aucun choix particulier — champs les plus étendus';
  }
}
updateProfileMenuBadges();
function saveRubriqueChoiceGeneral() {
  sessionStorage.setItem('hasConfiguredThisSession', 'true');
  const rubriques = [...document.querySelectorAll('.pf-rubrique-field:checked')].map((el) => el.value);
  const levels = [...document.querySelectorAll('.pf-rubrique-level:checked')].map((el) => el.value);
  let count = document.querySelector('input[name="pf-count"]:checked')?.value || '';
  if (count === 'custom') count = $('pf-count-custom').value?.trim() || '';
  localStorage.setItem('globalRubriqueDefaults', JSON.stringify({ rubriques, levels, count, remember: true }));
  updateExerciseSummaries();
  updateProfileMenuBadges();
  // Le niveau vient éventuellement de changer : un artiste déjà choisi peut être devenu
  // incompatible (ses œuvres ne correspondent plus au niveau sélectionné).
  populateArtistSuggestions();
}
document.querySelectorAll('.pf-rubrique-field, .pf-rubrique-level').forEach((el) => {
  el.addEventListener('change', saveRubriqueChoiceGeneral);
});
document.querySelectorAll('input[name="pf-count"]').forEach((el) => { el.addEventListener('change', saveRubriqueChoiceGeneral); });
$('pf-count-custom')?.addEventListener('change', saveRubriqueChoiceGeneral);
$('pf-rubriques-apply')?.addEventListener('click', saveRubriqueChoiceGeneral);
$('pf-rubriques-clear')?.addEventListener('click', () => {
  localStorage.removeItem('globalRubriqueDefaults');
  document.querySelectorAll('.pf-rubrique-field, .pf-rubrique-level').forEach((el) => { el.checked = false; });
  updateExerciseSummaries();
  updateProfileMenuBadges();
});
// Bouton « Valider mes paramètres » : tous les réglages s'enregistrent déjà automatiquement à
// chaque coche, mais l'absence de confirmation explicite déroutait certains joueurs (impression
// de ne pas savoir si un choix avait bien été pris en compte). Ce bouton n'a rien de plus à
// enregistrer techniquement — son rôle est de donner un geste de confirmation clair, puis
// d'amener directement au menu des exercices.
$('pf-validate-button')?.addEventListener('click', () => {
  // L'animation « intro-highlight » dure 3 secondes (3 pulsations), mais la page change au bout
  // de seulement 500ms — elle était donc interrompue brutalement en plein milieu d'une pulsation,
  // ce qui donnait un effet de clignotement disgracieux plutôt qu'une confirmation nette. Retirée :
  // le changement de page lui-même sert déjà de confirmation visuelle suffisante.
  // Valider depuis Mon compte (accès « par les menus ») active aussi le mode simplifié du tableau
  // des exercices : plus de texte de présentation, juste la phrase de configuration en haut.
  guidedModeActive = true;
  localStorage.setItem('guidedModeActive', 'true');
  showPanel('training-hub');
  updateExerciseSummaries();
  applyFieldLinkedAmbiance();
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
const DEFAULT_PREFS = { showTimer: true, enterValidate: true, rememberSelection: true, audioOn: true, voiceName: '', showExplanations: true, showRules: true, flagsArtists: true, flagsLocations: true, defaultAdvance: 'manual', defaultDelay: 5000 };
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

const EXERCISE_PLAY_PANELS = ['impregnation', 'intrus', 'reconstitution', 'vraifaux', 'famille', 'chrono', 'quiz'];
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


const EXERCISE_RULES = {
  imp: {
    titre: 'Imprégnation — comment ça marche',
    texte: "Cet exercice sert à mémoriser passivement, sans notation ni score. Une œuvre s'affiche à l'écran, et sa référence complète (artiste, titre, date, lieu de conservation…) s'écrit progressivement pendant qu'une voix la lit à voix haute. Il n'y a rien à faire d'autre que regarder et écouter, à votre rythme. Utilisez la flèche → (ou la touche Entrée) pour passer à l'œuvre suivante, ← pour revenir à la précédente, et ⏸ pour mettre en pause.",
  },
  intrus: {
    titre: 'Intrus — comment ça marche',
    texte: "Trois propositions (images ou références selon votre choix) vous sont présentées pour une même œuvre annoncée : une seule est la bonne, les deux autres sont des intrus. Cliquez sur celle qui correspond réellement. Une correction s'affiche ensuite avec la référence complète de l'œuvre.",
  },
  recon: {
    titre: 'Reconstitution — comment ça marche',
    texte: "Un détail très resserré d'une œuvre s'affiche — parfois difficile à reconnaître au premier coup d'œil. Parmi 3 références complètes proposées, cliquez sur celle qui correspond à ce détail. La correction affiche ensuite l'œuvre entière avec sa référence.",
  },
  vf: {
    titre: 'Vrai/Faux — comment ça marche',
    texte: "Une image s'affiche avec sa référence complète (artiste, titre, date, lieu…). Cette référence est soit entièrement exacte, soit comporte un ou deux détails inventés. Jugez chaque élément un par un, en cliquant sur Vrai ou Faux pour chacun. La correction affiche la bonne réponse en vert là où vous vous êtes trompé.",
  },
  fam: {
    titre: 'Famille — comment ça marche',
    texte: "6 ou 8 images s'affichent, selon votre choix : la moitié d'entre elles sont d'un même artiste, les autres sont des intrus. Repérez d'abord les bonnes images en cliquant dessus, puis validez. Il faut ensuite retrouver le titre de chacune des œuvres repérées. Le score est tout ou rien : un point uniquement si l'artiste et tous les titres sont exacts.",
  },
  chrono: {
    titre: 'Chronologie — comment ça marche',
    texte: "4 œuvres s'affichent dans un ordre mélangé. Cliquez dessus dans l'ordre chronologique, en commençant par la plus ancienne. La correction affiche ensuite les 4 références complètes, classées dans le bon ordre.",
  },
  quiz: {
    titre: 'Quiz final — comment ça marche',
    texte: "Une œuvre s'affiche. Pour chaque rubrique choisie (artiste, titre, date, lieu…), tapez votre réponse dans le champ correspondant, ou dictez-la avec le micro 🎤. Une fois toutes les rubriques renseignées, validez : la correction affiche les informations disponibles, avec un indicateur « Exact » ou « À réviser » pour chacune. Les réponses proches (fautes d'orthographe, surnoms) sont tolérées dans une certaine mesure.",
  },
};
let exerciseRulesConfirmCallback = null;
function showExerciseRules(prefix, onConfirm) {
  const rules = EXERCISE_RULES[prefix];
  if (!rules || !getGlobalPrefs().showRules) { onConfirm(); return; }
  $('exercise-rules-title').textContent = rules.titre;
  $('exercise-rules-text').textContent = rules.texte;
  exerciseRulesConfirmCallback = onConfirm;
  openModal('modal-exercise-rules');
}
$('exercise-rules-confirm')?.addEventListener('click', () => {
  closeModal('modal-exercise-rules');
  const cb = exerciseRulesConfirmCallback;
  exerciseRulesConfirmCallback = null;
  cb?.();
});
$('exercise-rules-cancel')?.addEventListener('click', () => {
  closeModal('modal-exercise-rules');
  exerciseRulesConfirmCallback = null;
});
// Fenêtre de fin d'exercice : score, message encourageant, retour au menu des exercices — plutôt
// que de renvoyer directement à la page de configuration, ce qui déroutait des joueurs (un
// bouton « Terminer » qui semblait ramener en arrière plutôt que clore la session).
let exerciseResultsCloseTarget = 'training-hub';
function encouragingMessage(percent) {
  if (percent >= 90) return "Excellent ! Une mémoire remarquable.";
  if (percent >= 70) return "Très bon résultat, continuez comme ça !";
  if (percent >= 50) return "Bon travail — encore quelques essais et ce sera parfait.";
  return "C'est en s'exerçant qu'on progresse — bravo d'avoir été jusqu'au bout !";
}
function showExerciseResultsModal(exerciseName, correct, total, closeTarget) {
  exerciseResultsCloseTarget = closeTarget || 'training-hub';
  $('exercise-results-title').textContent = exerciseName;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  $('exercise-results-score').textContent = `${correct} / ${total}`;
  $('exercise-results-message').textContent = encouragingMessage(percent);
  openModal('modal-exercise-results');
}
$('exercise-results-close')?.addEventListener('click', () => {
  closeModal('modal-exercise-results');
  showPanel(exerciseResultsCloseTarget);
});
// Sonorise le parcours guidé (texte d'intro et question de chaque étape) — respecte le réglage
// audio global, comme partout ailleurs dans l'appli.
// --- Ambiance liée au champ étudié (option « Lier les ambiances au choix de champ », décochée
// par défaut) : le décor change avec le siècle/artiste étudié — la mémoire s'imprègne aussi du
// style d'une époque. Priorité : artiste précis (colonne du fichier maître) > siècle si un seul
// style possible > on demande au joueur si plusieurs styles cohabitent.
// Siècles à style unique (pas de choix à poser) ; 14e/15e passent en Renaissance si la zone
// choisie est UNIQUEMENT l'Italie (le Quattrocento y a démarré plus tôt qu'ailleurs en Europe).
const CENTURY_SINGLE_AMBIANCE = { '14e': 'gothique', '15e': 'gothique', '16e': 'renaissance', '17e': 'versailles' };
// Siècles à styles multiples : plusieurs décors plausibles selon les courants de l'époque —
// impossible de trancher seul, on pose la question au joueur.
const CENTURY_MULTI_AMBIANCE = { '18e': ['ermitage', 'wedgwood'], '19e': ['pitti', ''], '20e': ['bauhaus', 'space'] };
const AMBIANCE_NAMES = { gothique: 'Gothique international', renaissance: 'Galerie Renaissance', versailles: 'Château de Versailles', ermitage: 'Ermitage Rococo', wedgwood: 'Pure Wedgwood', pitti: 'Romantique Pitti', '': 'Salon Renoir', bauhaus: 'Bauhaus', space: 'Space Age' };
// Lit la colonne de style d'un artiste dans le fichier maître (vide = rien de spécial prévu pour
// lui, ex. Giotto : on retombe alors sur la règle du siècle). Le fichier n'est chargé qu'à la
// demande ; si indisponible, on considère prudemment qu'aucun artiste n'a de style renseigné.
function getArtistStyleAmbiance(artistName) {
  if (!artistListLoaded) return '';
  const row = findArtistRow(artistName);
  const raw = String(row?.['Ambiance'] || row?.['Style'] || '').trim().toLowerCase();
  return raw in AMBIANCE_NAMES ? raw : '';
}
function centuryAmbianceOptions(century, zones) {
  if ((century === '14e' || century === '15e') && zones?.length === 1 && zones[0] === 'italie') return ['renaissance'];
  if (CENTURY_SINGLE_AMBIANCE[century]) return [CENTURY_SINGLE_AMBIANCE[century]];
  if (CENTURY_MULTI_AMBIANCE[century]) return CENTURY_MULTI_AMBIANCE[century];
  return [];
}
// Détermine ce qu'il faut faire pour la session en cours : { type: 'auto', ambiance, reason } —
// changement silencieux, { type: 'ask', options, reason } — on pose la question au joueur, ou
// { type: 'none' } — rien de particulier ne se dégage (pas de champ précis, ou styles cohérents
// avec l'ambiance déjà en place sans qu'il y ait lieu d'insister).
async function computeFieldAmbiance() {
  const ga = readGlobalArtistDefaults();
  const gf = readGlobalFieldDefaults();
  if (ga.artists?.length) {
    await loadArtistListIfNeeded();
    const styles = [...new Set(ga.artists.map(getArtistStyleAmbiance).filter(Boolean))];
    if (styles.length === 1) return { type: 'auto', ambiance: styles[0], reason: 'artist' };
    if (styles.length > 1) return { type: 'ask', options: styles, reason: 'artist' };
    // Aucun artiste sélectionné n'a de style renseigné : on retombe sur la règle du siècle.
  }
  const centuries = gf.centuries?.length ? gf.centuries : [];
  if (!centuries.length) return { type: 'none' };
  const allOptions = [...new Set(centuries.flatMap((c) => centuryAmbianceOptions(c, gf.zones)))];
  if (allOptions.length === 1) return { type: 'auto', ambiance: allOptions[0], reason: 'century' };
  if (allOptions.length > 1) return { type: 'ask', options: allOptions, reason: 'century' };
  return { type: 'none' };
}
// Textes pédagogiques accompagnant le changement (ou la question posée) — brefs, dans l'esprit
// « la mémoire s'imprègne aussi du style d'une époque ».
const AMBIANCE_AUTO_TEXTS = {
  gothique: "Aux 14e et 15e siècles, l'art occidental restait marqué par le style gothique international — or et bleus profonds des enluminures. Vous voilà plongé dans cette ambiance.",
  renaissance: "La Renaissance a débuté au Quattrocento en Italie. Vous voilà dans un environnement Renaissance.",
  versailles: "Le 17e siècle en France, c'est le siècle du Roi-Soleil et de Versailles. Vous voilà dans cette ambiance.",
};
const AMBIANCE_ASK_TEXTS = {
  '18e': "Le 18e siècle a vu cohabiter la légèreté du rococo et l'épure naissante du classicisme. Quelle ambiance choisissez-vous pour cette session ?",
  '19e': "Au 19e siècle cohabitaient plusieurs styles — un peintre impressionniste pouvait très bien vivre dans un appartement décoré à la mode romantique. Quelle ambiance choisissez-vous pour cette session ?",
  '20e': "Le 20e siècle a vu s'affronter la rigueur du Bauhaus et l'élan de la conquête spatiale. Quelle ambiance choisissez-vous pour cette session ?",
  default: "Plusieurs styles cohabitent dans votre sélection. Quelle ambiance choisissez-vous pour cette session ?",
  artist: "Les artistes choisis n'appartiennent pas au même courant. Quelle ambiance choisissez-vous pour cette session ?",
};
function ambianceAskText(decision) {
  if (decision.reason === 'artist') return AMBIANCE_ASK_TEXTS.artist;
  const gf = readGlobalFieldDefaults();
  const singleCentury = gf.centuries?.length === 1 ? gf.centuries[0] : null;
  return AMBIANCE_ASK_TEXTS[singleCentury] || AMBIANCE_ASK_TEXTS.default;
}
async function applyFieldLinkedAmbiance() {
  $('ambiance-auto-message')?.classList.add('hidden');
  $('ambiance-ask-box')?.classList.add('hidden');
  // Activé par défaut — désactivé seulement si le joueur a explicitement décoché la case.
  if (localStorage.getItem('linkAmbianceToField') === 'false') return;
  const decision = await computeFieldAmbiance();
  if (decision.type === 'auto') {
    localStorage.setItem('ambiance', decision.ambiance);
    applyAmbiance(decision.ambiance);
    const msg = $('ambiance-auto-message');
    if (msg) {
      msg.textContent = `L'ambiance a changé. ${AMBIANCE_AUTO_TEXTS[decision.ambiance] || `Vous voilà dans l'ambiance ${AMBIANCE_NAMES[decision.ambiance]}.`}`;
      msg.classList.remove('hidden');
    }
  } else if (decision.type === 'ask') {
    $('ambiance-ask-text').textContent = ambianceAskText(decision);
    $('ambiance-ask-buttons').innerHTML = decision.options.map((amb) => `<button type="button" class="secondary-button ambiance-ask-choice" data-ambiance="${escapeHtml(amb)}" style="padding:8px 16px;">${escapeHtml(AMBIANCE_NAMES[amb])}</button>`).join('');
    $('ambiance-ask-buttons').querySelectorAll('.ambiance-ask-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        localStorage.setItem('ambiance', btn.dataset.ambiance);
        applyAmbiance(btn.dataset.ambiance);
        $('ambiance-ask-box').classList.add('hidden');
      });
    });
    $('ambiance-ask-box')?.classList.remove('hidden');
  }
}
function guidedSpeak(text) {
  if (!getGlobalPrefs().audioOn || !window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(fixSpeechPronunciation(text));
  u.lang = 'fr-FR'; u.rate = 0.85;
  const voice = getGlobalVoice();
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
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
  const u = new SpeechSynthesisUtterance(fixSpeechPronunciation(el.textContent));
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
    const prefixes = ['imp', 'intrus', 'recon', 'vf', 'fam'];
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

// Bandeau du haut : nom de l'exercice + progression à gauche, score à droite — mis à jour à
// chaque question par chacun des jeux. Vidé automatiquement par showPanel() en dehors d'un jeu.
// Étiquette de champ courte (ex. « Peint/15e ») affichée dans le bandeau, à côté du nom de
// l'exercice — calculée une fois au démarrage de la session à partir des arts/siècles choisis.
function buildFieldLabel(arts, centuries) {
  // Le choix d'artiste(s) est maintenant une section séparée qui affine le champ plutôt que de le
  // remplacer — dans ce bandeau compact, on privilégie l'affichage des noms d'artistes quand ils
  // sont choisis (plus parlant), sinon le résumé art/siècle habituel.
  const artists = readGlobalArtistDefaults().artists || [];
  if (artists.length) {
    const shown = artists.slice(0, 2).join(', ');
    return artists.length > 2 ? `${shown} +${artists.length - 2}` : shown;
  }
  const artLabels = { peinture: 'Peint', sculpture: 'Sculpt' };
  if (!arts.length || !centuries.length) return '';
  const artsPart = arts.map((a) => artLabels[a] || a).join('+');
  const centuriesPart = centuries.length <= 2 ? centuries.join('+') : `${centuries.length} siècles`;
  return `${artsPart}/${centuriesPart}`;
}
function updateTopBanner(exerciseName, progressText, fieldLabel) {
  if ($('topbar-exercise-name')) $('topbar-exercise-name').textContent = [fieldLabel, exerciseName].filter(Boolean).join(' ');
  if ($('topbar-exercise-progress')) $('topbar-exercise-progress').textContent = progressText || '';
}
function updateTopBannerScore(scoreText) {
  if ($('topbar-score')) $('topbar-score').textContent = scoreText || '';
}
function clearTopBanner() {
  updateTopBanner('', '');
  updateTopBannerScore('');
}
// Registre de tous les chronomètres créés, pour pouvoir tous les arrêter d'un coup en quittant
// un jeu (showPanel) — sinon celui resté actif continue de tourner en fond indéfiniment, même
// une fois revenu au menu, et pourrait entrer en conflit avec le suivant démarré.
const ALL_TIMERS = [];
let activeTimer = null; // le chronomètre actuellement en cours, pour le clic sur le bandeau
function createTimer(labelElementId) {
  let startTime = null, interval = null, pausedElapsed = 0, paused = false;
  function tick() {
    const el = $(labelElementId);
    if (!el || !startTime) return;
    const s = pausedElapsed + Math.floor((Date.now() - startTime) / 1000);
    el.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const timer = {
    start() {
      startTime = Date.now(); pausedElapsed = 0; paused = false;
      activeTimer = timer;
      $(labelElementId)?.classList.toggle('hidden', !getGlobalPrefs().showTimer);
      if (interval) clearInterval(interval);
      interval = setInterval(tick, 1000);
      tick();
    },
    stop() {
      if (interval) clearInterval(interval); interval = null;
      if (activeTimer === timer) activeTimer = null;
      return startTime ? pausedElapsed + Math.round((Date.now() - startTime) / 1000) : 0;
    },
    // Pause : garde le temps déjà écoulé en mémoire, arrête juste le décompte visuel — un clic
    // suffit à reprendre. Différent de stop(), qui clôt la session (utilisé au changement de page).
    pause() {
      if (paused || !startTime) return;
      pausedElapsed += Math.floor((Date.now() - startTime) / 1000);
      if (interval) clearInterval(interval);
      interval = null;
      paused = true;
    },
    resume() {
      if (!paused) return;
      startTime = Date.now();
      paused = false;
      interval = setInterval(tick, 1000);
      tick();
    },
    isPaused() { return paused; },
  };
  ALL_TIMERS.push(timer);
  return timer;
}
function stopAllTimers() { ALL_TIMERS.forEach((t) => t.stop()); }
const quizTimer = createTimer('topbar-timer');
// Clic sur le chronomètre du bandeau : 1er clic = pause (reprise possible d'un clic), 2e clic (si
// déjà en pause) = désactivation complète, à réactiver depuis Mon compte → Mes paramètres
// techniques → « Afficher le chronomètre ».
$('topbar-timer')?.addEventListener('click', () => {
  if (!activeTimer) return;
  if (!activeTimer.isPaused()) {
    activeTimer.pause();
  } else {
    setGlobalPref('showTimer', false);
    $('topbar-timer').classList.add('hidden');
  }
});

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
  // Depuis l'écran de configuration (ouvert via l'icône ✏️), on n'enregistre le choix comme
  // propre à ce jeu que si le joueur l'a explicitement demandé — sinon un simple essai depuis
  // cet écran deviendrait un choix permanent sans qu'on l'ait voulu. On cherche la case DANS le
  // panneau plutôt que de reconstruire son identifiant (le préfixe technique du jeu — « vf »,
  // « fam »… — ne correspond pas toujours au nom du panneau).
  const saveCheckbox = $(panelId)?.querySelector('input[id$="-save-choice"]');
  if (saveCheckbox && !saveCheckbox.checked) return;
  const state = {};
  $(panelId)?.querySelectorAll('input[type="checkbox"]').forEach((el) => { state[el.id] = el.checked; });
  localStorage.setItem(`lastSelection_${panelId}`, JSON.stringify(state));
}
// Bouton « Valider mon choix pour ce jeu » : enregistre la sélection courante comme choix propre
// à cet exercice puis revient directement au menu, sans lancer la partie — pour voir tout de
// suite le badge du bouton changer, sans passer par tout un exercice.
const VALIDATE_CHOICE_PANELS = {
  'imp-validate-choice-button': 'impregnation-setup-panel',
  'intrus-validate-choice-button': 'intrus-setup-panel',
  'recon-validate-choice-button': 'reconstitution-setup-panel',
  'vf-validate-choice-button': 'vraifaux-setup-panel',
  'fam-validate-choice-button': 'famille-setup-panel',
  'chrono-validate-choice-button': 'chrono-setup-panel',
  'quiz-validate-choice-button': 'quiz-setup-panel',
};
Object.entries(VALIDATE_CHOICE_PANELS).forEach(([btnId, panelId]) => {
  $(btnId)?.addEventListener('click', () => {
    const saveCheckbox = $(panelId)?.querySelector('input[id$="-save-choice"]');
    if (saveCheckbox) saveCheckbox.checked = true;
    saveLastSelection(panelId);
    showPanel('training-hub');
    updateExerciseSummaries();
  });
});
function restoreLastSelection(panelId) {
  if (!getGlobalPrefs().rememberSelection) return;
  let state;
  try { state = JSON.parse(localStorage.getItem(`lastSelection_${panelId}`) || '{}'); } catch (e) { return; }
  $(panelId)?.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    if (state[el.id] !== undefined && !el.id.includes('opt-') && !el.id.includes('skip-objective')) el.checked = state[el.id];
  });
}

// Pilotage du personnage à la voix dans le plan rapproché de la salle d'exposition : « gauche »,
// « droite », « plus vite », « moins vite »/« ralentis », « stop »/« arrête ». Même schéma
// d'écoute continue avec redémarrage automatique que le micro du quiz, mais on « renforce » la
// fiabilité en examinant TOUTES les hypothèses de reconnaissance (maxAlternatives) plutôt que la
// seule première — une commande courte est plus vite noyée dans une reconnaissance imparfaite
// qu'une phrase entière dictée.
function attachExhibitionVoiceControl(button) {
  if (!voiceSupported || !button) { button?.classList.add('hidden'); return; }
  button.classList.remove('hidden');
  let recognition = null, listening = false, manualStop = false;
  const commandMatches = (transcript, words) => words.some((w) => transcript.includes(w));
  const handleTranscript = (transcript) => {
    const t = transcript.toLowerCase();
    if (commandMatches(t, ['arrête', 'stop', 'arrete'])) { stopWalking(); return; }
    if (commandMatches(t, ['plus vite', 'accélère', 'accelere', 'plus rapide'])) {
      walkSpeed = Math.min(12, walkSpeed + 2);
      if (walkDirection !== 0) startWalking(walkDirection);
      return;
    }
    if (commandMatches(t, ['moins vite', 'ralentis', 'ralenti', 'plus lentement'])) {
      walkSpeed = Math.max(2, walkSpeed - 2);
      if (walkDirection !== 0) startWalking(walkDirection);
      return;
    }
    if (commandMatches(t, ['gauche'])) { startWalking(-1); return; }
    if (commandMatches(t, ['droite'])) { startWalking(1); return; }
  };
  button.addEventListener('click', () => {
    if (listening) { manualStop = true; try { recognition.abort(); } catch (e) {} button.classList.remove('listening'); listening = false; return; }
    manualStop = false;
    try { recognition = new SpeechRecognitionImpl(); } catch (e) { return; }
    recognition.lang = 'fr-FR'; recognition.continuous = true; recognition.interimResults = false; recognition.maxAlternatives = 3;
    button.classList.add('listening'); listening = true;
    const thisRecognition = recognition;
    recognition.addEventListener('result', (event) => {
      const last = event.results[event.results.length - 1];
      // On examine chaque hypothèse renvoyée par le moteur, pas seulement la plus probable — une
      // commande d'un ou deux mots se glisse plus facilement dans une hypothèse secondaire.
      for (let i = 0; i < last.length; i += 1) handleTranscript(last[i].transcript);
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
attachExhibitionVoiceControl($('scale-voice-control-button'));
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

// Corrige des prononciations connues avant de passer le texte à la synthèse vocale.
// 1) De nombreux moteurs épellent lettre par lettre un mot tout en MAJUSCULES de plusieurs
//    lettres, le prenant pour un sigle (ex. "MALEVITCH" → "M-A-L-E-V-I-T-C-H"). Comme les noms de
//    famille sont stockés en majuscules dans les fichiers, ça touche potentiellement beaucoup
//    d'artistes, pas seulement celui-ci : on remet donc systématiquement en casse normale
//    (première lettre capitale) tout mot tout en majuscules de 3 lettres ou plus avant de parler,
//    quel que soit l'endroit du texte où il apparaît.
// 2) Quelques noms restent mal prononcés même en casse normale à cause de leur transcription
//    (finales slaves, etc.) : PRONUNCIATION_FIXES permet une réécriture phonétique ciblée,
//    appliquée après la correction de casse.
// Certaines entrées se terminent par « * » : elles corrigent un préfixe, y compris quand le mot
// est collé au suivant dans un composé allemand (« Kunsthistorisches », « Kunstmuseum »...) — la
// limite de mot n'est alors imposée qu'au début, pas à la fin.
const PRONUNCIATION_FIXES = {
  'sœurs': 'seurs',
  'chassériau': 'Chasériau',
  'malevitch': 'Malévitch',
  'poyer': 'Poyé',
  'marmion': 'Marmiyon',
  'chœur': 'keur',
  'adam': 'Adan',
  'kunst*': 'kounst',
  'tempera': 'tanpéra',
  'escorial': 'Eskorial',
  'vespucci': 'Vespoutchi',
  'transfiguration': 'transfigurassion',
  'sacrements': 'sakremans',
  'cosmè': 'Kosmè',
  'fiore': 'Fioré',
  'schifanoia': 'Skifanoya',
  'bouts': 'Bout',
  'alte': 'Alté',
  'gemäldegalerie': 'Guémeldegalery',
  'linaioli': 'Linayoli',
  'botticelli': 'Bottitchelli',
  'groeninge': 'Grouningue',
  'francesca': 'Franchéska',
  'gentile': 'Gentilé',
  'vecchietta': 'Vekietta',
  'patmos': 'Patmoss',
  'verrocchio': 'Verrokio',
  'ecce': 'Étché',
  'condottiere': 'condotière',
  'condottière': 'condotière',
  'rogier': 'Roger',
  'weyden': 'Wédenne',
  'pollaiuolo': 'Pollayouolo',
  'veneziano': 'Vénétsiano',
  'angelico': 'Angéliko',
  'ursins': 'Ursin',
  'ciarda': 'Tcharda',
  'dürer': 'Duré',
  'durer': 'Duré',
  'alvise': 'Alvisé',
  'benozzo': 'Bénotso',
  'gozzoli': 'Gotsoli',
  'simone': 'Simoné',
  'cione': 'Chioné',
  'lorenzetti': 'Lorenzétti',
  'orsanmichele': 'Orsanmikélé',
  'santa croce': 'Santa Croché',
  'cimabue': 'Chimaboué',
  'menabuoi': 'Ménabuoîe',
  'duccio': 'Douchio',
  'buoninsegna': 'Bouninségna',
  'firenze': 'Firenzé',
  'trastevere': 'Trastévéré',
  'modena': 'Modéna',
  'aretino': 'Arétino',
  'altichiero': 'Altikiero',
  'giobbe': 'Giobbé',
  'brera': 'Bréra',
  'procris': 'Pro criss',
  'bacchante': 'Bakante',
  'canova': 'Kanova',
  'méphistophélès': 'méphistophélèsse',
  'jason': 'Jazon',
  'thorvaldsen': 'Thordvalsenne',
  'tate britain': 'Téte Britèn',
  'mcneill': 'Macnil',
  'jongkind': 'Jonkin',
  'fine': 'Faïne',
  'oxbow': 'Oxbo',
  'jaleo': 'raléo',
  'repin': 'Ryépine',
  'waterhouse': 'WaterHaouse',
  'hayez': 'Aiez',
  'hodler': 'Hodleur',
  'epsom': 'Epsome',
  'haussmann': 'Hosmane',
  'rügen': 'Ruguéne',
  'böcklin': 'Beuklin',
  'edwin': 'Edwine',
  'iceberg': 'Aïceberg',
  'tahitiennes': 'Tahissiennes',
  'phryné': 'Friné',
  'vallotton': 'Vallotto',
  'gismonda': 'Guismonda',
  'léonidas': 'Léonidasse',
  'caliban': 'Caliba',
  'hylas': 'Ilasse',
  'thétis': 'Thétisse',
  'carlyle': 'Carlaile',
  'alyscamps': 'Aliscan',
  'poisson': 'Pouasson',
  'vœu': 'veu',
  'bernin': 'Bérnini',
};
// Corrections qui dépendent de la nationalité de l'artiste (ex. « Michael » se prononce à
// l'anglaise pour un artiste anglais, mais pas pour un Michael allemand/autrichien/néerlandais).
// currentSpeechNationality est positionnée juste avant de parler, là où l'objet œuvre est
// disponible (nationalité brute du fichier, non normalisée).
let currentSpeechNationality = '';
const NATIONALITY_AWARE_FIXES = {
  'michael': { exceptFor: /anglais|britannique|english/i, otherwise: 'Mikaël' },
};
function fixSpeechPronunciation(text) {
  // Le texte entre parenthèses (ex. un nom de musée alternatif) reste utile à l'écran mais
  // alourdit la lecture à voix haute : on le retire ici, avant toute autre correction, pour que
  // ça s'applique partout où l'on parle, sans avoir à y penser exercice par exercice.
  let out = String(text || '').replace(/\s*\([^)]*\)/g, '');
  // Frontières Unicode : \b ne reconnaît que les lettres ASCII comme « caractères de mot », donc
  // échoue silencieusement pour tout mot commençant ou finissant par une lettre accentuée (ex.
  // « Cosmè » : le \b après le è ne se déclenchait pas). On utilise des lookarounds explicites sur
  // \p{L}\p{N} à la place, qui couvrent aussi les lettres accentuées.
  const NB = '(?<![\\p{L}\\p{N}])';
  const NA = '(?![\\p{L}\\p{N}])';
  out = out.replace(new RegExp(`${NB}[A-ZÀ-Ý]{3,}${NA}`, 'gu'), (word) => word.charAt(0) + word.slice(1).toLowerCase());
  Object.entries(NATIONALITY_AWARE_FIXES).forEach(([wrong, { exceptFor, otherwise }]) => {
    if (exceptFor.test(currentSpeechNationality)) return; // nationalité exceptée : on ne touche pas
    out = out.replace(new RegExp(`${NB}${wrong}${NA}`, 'giu'), otherwise);
  });
  Object.entries(PRONUNCIATION_FIXES).forEach(([wrong, right]) => {
    const isPrefix = wrong.endsWith('*');
    const stem = isPrefix ? wrong.slice(0, -1) : wrong;
    out = out.replace(new RegExp(`${NB}${stem}${isPrefix ? '' : NA}`, 'giu'), right);
  });
  return out;
}
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
    if (!imageKey) throw new Error("La colonne « image » est introuvable dans ce fichier.");
    // Trois colonnes optionnelles de photos supplémentaires (portrait de l'artiste, vue du lieu de
    // conservation, autre photo du cycle) — absentes des anciens fichiers, ignorées sans erreur si
    // non trouvées.
    const artistImageKey = findColumn(row, ["image de l artiste", 'portrait artiste', 'photo artiste']);
    const locationImageKey = findColumn(row, ['images du lieu', 'image du lieu', 'photo lieu', 'photo musee', 'photo musée']);
    const cycleImageKey = findColumn(row, ['images du cycle', 'image du cycle', 'photo cycle']);
    const artistImage = artistImageKey ? String(row[artistImageKey] || '').trim() : '';
    const locationImage = locationImageKey ? String(row[locationImageKey] || '').trim() : '';
    const cycleImage = cycleImageKey ? String(row[cycleImageKey] || '').trim() : '';

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
    const villeKey = findColumn(row, ['ville', 'ville de creation', 'lieu de conservation']);
    const lieuPrecisKey = findColumn(row, ['lieu precis', 'lieu precis de conservation']);
    const sousLieuKey = findColumn(row, ['sous lieu', 'sous lieu de conservation']);
    let location, ville = '';
    if (villeKey || lieuPrecisKey) {
      ville = villeKey ? String(row[villeKey] || '').trim() : '';
      const lieuPrecis = lieuPrecisKey ? String(row[lieuPrecisKey] || '').trim() : '';
      const sousLieu = sousLieuKey ? String(row[sousLieuKey] || '').trim() : '';
      // Si la ville apparaît déjà telle quelle dans le lieu précis ou le sous-lieu (ex. « Église
      // Saint-Antoine de Loches » pour la ville « Loches »), inutile de la répéter à la fin.
      const villeDejaMentionnee = ville && [sousLieu, lieuPrecis].some((part) => keyName(part).includes(keyName(ville)));
      location = [sousLieu, lieuPrecis, villeDejaMentionnee ? '' : ville].filter(Boolean).join(', ');
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
      date: String(row[dateKey] || '').trim(), location, ville, title, cycle, titleOriginal,
      artistDates, materials, nature, materialsPhrase, hauteur, longueur, profondeur, nationality, niveau,
      artistImage, locationImage, cycleImage,
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
  "roumaine": "🇷🇴", "roumain": "🇷🇴", "roumanie": "🇷🇴",
  "serbe": "🇷🇸", "serbie": "🇷🇸",
  "bulgare": "🇧🇬", "bulgarie": "🇧🇬",
};
function nationalityFlag(rawValue) {
  const key = keyName(rawValue);
  if (!key) return '';
  for (const label of Object.keys(NATIONALITY_FLAGS)) {
    if (key.includes(label)) return NATIONALITY_FLAGS[label];
  }
  return '';
}
// Drapeau de nationalité d'un ARTISTE (liste des artistes, fiche « Autres œuvres »...) — distinct
// du drapeau de LIEU de conservation (voir locationWithFlag) : les deux se règlent indépendamment
// dans Mon compte, certaines personnes n'aimant pas les drapeaux pour l'un ou l'autre usage.
function artistFlag(rawValue) {
  return getGlobalPrefs().flagsArtists ? nationalityFlag(rawValue) : '';
}
// Ville de conservation -> pays, pour afficher un petit drapeau à côté du lieu quand la ville
// est peu connue (ex. « Sibiu » → 🇷🇴) — aide à situer l'œuvre sans avoir à chercher. Couvre les
// villes les plus fréquentes dans les fichiers ; à compléter au fil des retours.
const CITY_TO_COUNTRY = {
  'paris': 'francaise', 'rouen': 'francaise', 'lyon': 'francaise', 'lille': 'francaise', 'dijon': 'francaise', 'chantilly': 'francaise', 'tours': 'francaise', 'nantes': 'francaise', 'strasbourg': 'francaise', 'aix en provence': 'francaise', 'marseille': 'francaise',
  'londres': 'anglaise', 'edimbourg': 'anglaise', 'oxford': 'anglaise', 'cambridge': 'anglaise', 'manchester': 'anglaise', 'glasgow': 'anglaise', 'dublin': 'irlandaise',
  'new york': 'americaine', 'washington': 'americaine', 'chicago': 'americaine', 'boston': 'americaine', 'philadelphie': 'americaine', 'los angeles': 'americaine', 'baltimore': 'americaine', 'cleveland': 'americaine', 'detroit': 'americaine', 'san francisco': 'americaine', 'houston': 'americaine', 'fort worth': 'americaine', 'kansas city': 'americaine', 'minneapolis': 'americaine', 'saint louis': 'americaine',
  'rome': 'italienne', 'florence': 'italienne', 'venise': 'italienne', 'milan': 'italienne', 'naples': 'italienne', 'turin': 'italienne', 'bologne': 'italienne', 'sienne': 'italienne', 'perouse': 'italienne', 'parme': 'italienne', 'gênes': 'italienne', 'ferrare': 'italienne', 'urbino': 'italienne', 'padoue': 'italienne', 'palerme': 'italienne',
  'madrid': 'espagnole', 'barcelone': 'espagnole', 'seville': 'espagnole', 'bilbao': 'espagnole', 'tolede': 'espagnole', 'saragosse': 'espagnole', 'escorial': 'espagnole', 'grenade': 'espagnole', 'cordoue': 'espagnole',
  'berlin': 'allemande', 'munich': 'allemande', 'dresde': 'allemande', 'cologne': 'allemande', 'francfort': 'allemande', 'hambourg': 'allemande', 'karlsruhe': 'allemande', 'stuttgart': 'allemande', 'darmstadt': 'allemande', 'brunswick': 'allemande', 'kassel': 'allemande',
  'vienne': 'autrichienne', 'salzbourg': 'autrichienne', 'innsbruck': 'autrichienne',
  'amsterdam': 'neerlandaise', 'la haye': 'neerlandaise', 'rotterdam': 'neerlandaise', 'utrecht': 'neerlandaise', 'haarlem': 'neerlandaise',
  'bruxelles': 'belge', 'anvers': 'belge', 'bruges': 'belge', 'gand': 'belge', 'liege': 'belge',
  'saint petersbourg': 'russe', 'moscou': 'russe',
  'lisbonne': 'portugaise', 'porto': 'portugaise',
  'copenhague': 'danoise', 'oslo': 'norvegienne', 'stockholm': 'suedoise', 'helsinki': 'finlandaise',
  'varsovie': 'polonaise', 'cracovie': 'polonaise', 'prague': 'tcheque', 'budapest': 'hongroise',
  'athenes': 'grecque', 'zagreb': 'croate', 'belgrade': 'serbe', 'sofia': 'bulgare',
  'geneve': 'suisse', 'zurich': 'suisse', 'bâle': 'suisse', 'berne': 'suisse',
  'mexico': 'mexicaine', 'rio de janeiro': 'bresilienne', 'sao paulo': 'bresilienne', 'buenos aires': 'argentine',
  'pekin': 'chinoise', 'shanghai': 'chinoise', 'tokyo': 'japonaise', 'kyoto': 'japonaise', 'seoul': 'coreenne',
  'sibiu': 'roumaine', 'bucarest': 'roumaine',
};
function cityFlag(ville) {
  const key = keyName(ville);
  if (!key) return '';
  return nationalityFlag(CITY_TO_COUNTRY[key] || '');
}
// Nom de pays (pour l'info-bulle au survol du drapeau) à partir de l'adjectif de nationalité
// utilisé dans CITY_TO_COUNTRY.
const COUNTRY_NAMES = {
  francaise: 'France', anglaise: 'Royaume-Uni', irlandaise: 'Irlande', americaine: 'États-Unis',
  italienne: 'Italie', espagnole: 'Espagne', allemande: 'Allemagne', autrichienne: 'Autriche',
  neerlandaise: 'Pays-Bas', belge: 'Belgique', russe: 'Russie', portugaise: 'Portugal',
  danoise: 'Danemark', norvegienne: 'Norvège', suedoise: 'Suède', finlandaise: 'Finlande',
  polonaise: 'Pologne', tcheque: 'République tchèque', hongroise: 'Hongrie', grecque: 'Grèce',
  croate: 'Croatie', serbe: 'Serbie', bulgare: 'Bulgarie', suisse: 'Suisse',
  mexicaine: 'Mexique', bresilienne: 'Brésil', argentine: 'Argentine',
  chinoise: 'Chine', japonaise: 'Japon', coreenne: 'Corée du Sud', roumaine: 'Roumanie',
};
function countryNameFromFlag(ville) {
  const key = keyName(ville);
  const nat = CITY_TO_COUNTRY[key];
  return nat ? (COUNTRY_NAMES[nat] || '') : '';
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
// Sigles de musées courants qu'un joueur pourrait taper au lieu du nom complet : on les
// élargit avant comparaison. "MET" fonctionne déjà via la règle générique de sous-chaîne
// (préfixe de "Metropolitan"), mais "MoMA" n'est pas un sous-mot littéral de "Museum of Modern
// Art".
const LOCATION_ACRONYMS = { moma: 'museum of modern art' };
function isMatch(actual, expected, fieldKey) {
  let answer = keyName(actual); const target = keyName(expected);
  if (fieldKey === 'location' && LOCATION_ACRONYMS[answer]) answer = LOCATION_ACRONYMS[answer];
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
// Pour le lieu spécifiquement : distingue une réponse qui ne donne que la ville (acceptée comme
// bonne, mais on peut suggérer d'être plus précis à l'oral) d'une réponse qui précise aussi le
// musée. Renvoie 'none' | 'city-only' | 'precise'.
function locationMatchQuality(actual, work) {
  if (!isMatchAny(actual, work, 'location')) return 'none';
  const ville = String(work.ville || '').trim();
  if (!ville) return 'precise'; // pas de ville distincte enregistrée : rien à nuancer
  const answer = keyName(actual);
  const resteKey = keyName(String(work.location || '').split(',').filter((part) => keyName(part) !== keyName(ville)).join(', '));
  if (resteKey && (resteKey.includes(answer) || answer.includes(resteKey) || isCloseEnough(answer, resteKey))) return 'precise';
  return 'city-only';
}
function correctCount(answer, question) { return activeFields().reduce((count, field) => count + Number(isMatchAny(answer[field.key], question, field.key)), 0); }
function isFullyCorrect(answer, question) { return answer?.checked && correctCount(answer, question) === activeFields().length; }
function totalCorrect() { return state.questions.reduce((total, question, index) => total + (state.answers[index]?.checked ? correctCount(state.answers[index], question) : 0), 0); }
function checkedQuestions() { return state.answers.filter((answer) => answer?.checked).length; }
function imageSource(reference) {
  if (/^(https?:|data:)/i.test(reference)) return reference;
  return state.imageFiles.get(reference) || state.imageFiles.get(reference.toLocaleLowerCase('fr-FR')) || reference;
}
// Variante qui demande une taille adaptée à l'affichage réel quand le lien vient de Wikimedia
// Commons (paramètre "width" supporté nativement) — évite de télécharger une image en pleine
// résolution pour l'afficher en 150px, ce qui accélère le chargement (utile sur le mur de la vue
// à l'échelle, où plusieurs images se chargent en même temps).
// Précharge discrètement une image en arrière-plan (sans l'afficher) — utilisé pour l'œuvre
// SUIVANTE pendant que le joueur répond encore à la question en cours : par le temps qu'il passe
// à celle-ci, l'image d'après a déjà eu le temps de charger depuis Wikimedia, et s'affiche alors
// instantanément au lieu de démarrer son chargement à ce moment-là (c'est ce qui donnait
// l'impression d'un « rideau » qui se déroule lentement à l'écran).
function preloadImage(reference, widthPx) {
  if (!reference) return;
  const img = new Image();
  img.src = imageSourceSized(reference, widthPx);
}
function imageSourceSized(reference, widthPx) {
  const url = imageSource(reference);
  if (!/commons\.wikimedia\.org\/wiki\/Special:FilePath\//i.test(url)) return url;
  const target = Math.max(Math.round(widthPx * 2), 80); // x2 pour les écrans à forte densité
  return `${url.split('?')[0]}?width=${target}`;
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
  // Remise à zéro systématique du marqueur « en plein exercice » (fond de l'ambiance) à chaque
  // navigation — seul le clic explicite sur « Démarrer le jeu » le repose ensuite.
  document.body.classList.remove('in-exercise');
  document.querySelectorAll('.chrono-drag-ghost').forEach((g) => g.remove());
  // Vide le bandeau (nom d'exercice, progression, score) sauf si on va justement vers un jeu —
  // chaque jeu le remplit ensuite lui-même à chaque question.
  const PLAY_PANELS = ['impregnation', 'intrus', 'reconstitution', 'vraifaux', 'famille', 'chrono', 'quiz'];
  // Arrête TOUS les chronomètres à chaque changement de page : sinon celui resté actif continue
  // de tourner indéfiniment en arrière-plan, même après avoir fermé le jeu. Celui qu'on rejoint,
  // s'il y en a un, le relance lui-même via son propre .start().
  stopAllTimers();
  if (!PLAY_PANELS.includes(name)) clearTopBanner();
  hideBottomGallery();
  // Nettoie le mode « fenêtre superposée » (configuration d'un jeu ouverte par-dessus le menu) à
  // chaque vraie navigation — sinon la classe et le fond assombri resteraient collés au panneau.
  document.querySelectorAll('.config-popup-mode').forEach((el) => el.classList.remove('config-popup-mode'));
  $('config-popup-backdrop')?.remove();
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
  // Bouton « Voir/Arrêter la correction complète » : un par exercice concerné (à côté de son
  // propre 🏠 « Retour au menu des exercices »), toujours à jour avec l'état réel.
  updateFullCorrectionButtonsText();
  impTimers = []; vfTimers = []; famTimers = []; reconTimers = []; intrusTimers = []; chronoTimers = [];

  // name: 'welcome' | 'training-hub' | 'impregnation-setup' | 'impregnation' | 'intrus-setup' |
  // 'intrus' | 'quiz-setup' | 'quiz' | 'results' | 'account' | 'other-works' — centralise
  // l'affichage des panneaux et de la barre latérale (titre + import), visible uniquement sur la
  // page d'accueil.
  $('welcome-panel').classList.toggle('hidden', name !== 'welcome');
  $('training-hub-panel')?.classList.toggle('hidden', name !== 'training-hub');
  if (name === 'training-hub') {
    // Relance l'animation de l'icône du texte et fait clignoter en même temps la vraie icône
    // du bandeau, pour montrer clairement où se trouve « Mon compte ».
    const icon = $('hub-account-icon');
    if (icon) { icon.style.animation = 'none'; void icon.offsetWidth; icon.style.animation = ''; }
    $('global-account-button')?.classList.add('intro-highlight');
    setTimeout(() => $('global-account-button')?.classList.remove('intro-highlight'), 3000);
  }
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
  $('chrono-setup-panel')?.classList.toggle('hidden', name !== 'chrono-setup');
  $('chrono-panel')?.classList.toggle('hidden', name !== 'chrono');
  $('quiz-setup-panel')?.classList.toggle('hidden', name !== 'quiz-setup');
  $('quiz-panel').classList.toggle('hidden', name !== 'quiz');
  $('results-panel').classList.toggle('hidden', name !== 'results');
  $('account-panel')?.classList.toggle('hidden', name !== 'account');
  $('profile-panel')?.classList.toggle('hidden', name !== 'profile');
  $('guided-config-panel')?.classList.toggle('hidden', name !== 'guided-config');
  $('other-works-panel')?.classList.toggle('hidden', name !== 'other-works');
  $('sidebar')?.classList.toggle('hidden', name !== 'welcome');
  $('bg-mosaic')?.classList.toggle('hidden', name !== 'welcome' && name !== 'training-hub' && name !== 'guided-config');
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
  const image = $('artwork-image'); const message = $('image-message'); const source = imageSourceSized(work.image, 900);
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
$('quiz-launch-first-button')?.addEventListener('click', () => {
  $('quiz-ready-screen').classList.add('hidden');
  $('quiz-quiz-grid').classList.remove('hidden');
  $('bg-mosaic').classList.add('hidden');
  document.body.classList.add('in-exercise');
  quizTimer.start();
  renderQuestion();
});
function renderQuestion() {
  document.body.classList.remove('has-other-works'); // repart d'un état propre à chaque question
  const question = state.questions[state.index]; const answer = answerFor(state.index);
  const modeLabel = state.mode === 'review' ? 'Révision des erreurs — ' : '';
  $('quiz-reference').textContent = `${state.quizConfig?.reference || ''} — ${modeLabel}Q. ${state.index + 1}/${state.questions.length}`;
  updateTopBanner('Quiz final', `${modeLabel}Question ${state.index + 1}/${state.questions.length}`, quizFieldLabel);
  $('progress-bar').style.width = `${((state.index + 1) / state.questions.length) * 100}%`;
  const possible = checkedQuestions() * activeFields().length;
  $('score-summary').textContent = `${totalCorrect()} / ${possible} point${totalCorrect() > 1 ? 's' : ''}`;
  updateTopBannerScore(`${totalCorrect()}/${possible} pt${totalCorrect() > 1 ? 's' : ''}`);
  displayArtworkImage(question, `Œuvre ${state.index + 1}`, answer.checked);
  preloadImage(state.questions[state.index + 1]?.image, 900);
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
// Lieu affiché avec son petit drapeau quand la ville est reconnue (voir CITY_TO_COUNTRY) — factorisé
// ici pour que TOUS les exercices en bénéficient de la même façon, pas seulement Imprégnation et
// le quiz principal qui l'avaient chacun réimplémenté à leur façon (bug repéré : Famille,
// Reconstitution et Intrus affichaient le lieu en texte brut, sans jamais appeler cityFlag).
function locationWithFlag(work) {
  const loc = escapeHtml(work?.location || '');
  if (!getGlobalPrefs().flagsLocations) return loc;
  const flag = work ? cityFlag(work.ville) : '';
  return flag ? `${loc} <span title="${escapeHtml(countryNameFromFlag(work.ville))}">${flag}</span>` : loc;
}
function formatCorrectionValue(key, rawValue, work) {
  if (key === 'artist') return escapeHtml(formatArtistName(rawValue));
  if (key === 'title') return `<em>${escapeHtml(rawValue)}</em>`;
  if (key === 'location') return locationWithFlag(work);
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
  const flag = artistFlag(work.nationality);
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
// ont juste un nombre, d'autres ont déjà « cm » ou « m » écrit). Gère aussi un éventuel préfixe
// « c. » ou « c, » (mesure approximative) : il est retiré et « environ » est ajouté à la fin —
// plus naturel à l'oral pour une mesure que de le mettre en tête comme pour une date.
function withCm(value) {
  let v = String(value || '').trim();
  const isApprox = /^c[.,]\s*/i.test(v);
  if (isApprox) v = v.replace(/^c[.,]\s*/i, '').trim();
  const withUnit = /\b(cm|mm|m)\b/i.test(v) ? v : `${v} cm`;
  return isApprox ? `${withUnit} environ` : withUnit;
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
  if (work.longueur) parts.push(`${withCm(work.longueur).replace(/\bcm\b/i, 'centimètres')} de longueur`);
  if (work.profondeur) parts.push(`${withCm(work.profondeur).replace(/\bcm\b/i, 'centimètres')} de profondeur`);
  if (!parts.length) return '';
  if (parts.length === 1) return `de ${parts[0]}`;
  return `de ${parts.slice(0, -1).join(', ')}, et ${parts[parts.length - 1]}`;
}
// Phrase de référence complète, dans l'ordre demandé : « Artiste, «Titre», Date. Nature en
// matériau de H cm de hauteur, L de longueur et P de profondeur. Lieu. » — chaque partie
// manquante est simplement omise plutôt que de laisser un blanc ou une ponctuation orpheline.
// Bug réel corrigé : cette fonction parlait toujours de tout (date, matériau, dimensions, lieu)
// sans jamais tenir compte de la rubrique choisie ni de la correction complète — la voix
// « trichait » et révélait des informations que l'affichage, lui, cachait bien comme prévu.
// extraFields (optionnel) restreint ce qui est dit ; omis ou null = tout dire (comportement par
// défaut, utilisé quand la correction complète est active).
function spokenFullReference(work, extraFields = null) {
  const on = (key) => !extraFields || extraFields.includes(key);
  const dimsPhrase = on('dimensions') ? spokenDimensionsPhrase(work) : '';
  const matDims = [on('materiaux') ? (work.materialsPhrase || work.materials) : '', dimsPhrase].filter(Boolean).join(' ');
  const parts = [
    `${work.artist}, « ${work.title} »${on('date') ? `, ${work.date}` : ''}.`,
    matDims ? `${matDims}.` : '',
    (on('location') && work.location) ? `${work.location}.` : '',
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
    else value = formatCorrectionValue(key, displayedWork[key], displayedWork);
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
function quizSpeak(text) {
  if (!getGlobalPrefs().audioOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(fixSpeechPronunciation(text));
  u.lang = 'fr-FR'; u.rate = 0.85;
  const voice = getGlobalVoice();
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
function renderCorrection(answer, question) {
  correctionMainWork = question;
  renderCorrectionDetails(question, question, answer);
  showBottomGallery(question);
  // Cas particulier du lieu : si la réponse ne donnait que la ville (acceptée comme bonne), on le
  // signale à l'oral en encourageant à préciser le musée la prochaine fois.
  if (state.selectedFieldKeys.includes('location') && locationMatchQuality(answer.location, question) === 'city-only') {
    const reste = String(question.location || '').split(',').filter((part) => keyName(part) !== keyName(question.ville || '')).join(', ').trim();
    quizSpeak(`Tu as bien indiqué ${question.ville}. Tu aurais pu préciser${reste ? ' : ' + reste : ' le musée'}.`);
  }
}
let currentArtistWorksIndex = -1;
// Galerie du bas : photos complémentaires (portrait de l'artiste, vue du lieu de conservation)
// posées lors des corrections, quand ces colonnes existent dans le fichier. Cliquables, ouvrent la
// même visionneuse plein écran que les vignettes d'œuvres.
// Vue à l'échelle : silhouette de référence (170 cm) affichée à côté de l'œuvre, redimensionnée
// selon ses dimensions réelles (colonnes Hauteur/Longueur). Bascule accessible uniquement quand
// ces dimensions sont connues pour l'œuvre affichée.
let currentLightboxWork = null;
function parseCmValue(raw) {
  const m = String(raw || '').replace(',', '.').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}
// Échelle relative « vraie » pour les jeux de comparaison d'images (Intrus, Famille) : la plus
// grande œuvre du lot reçoit la taille maximale disponible à l'écran, les autres suivent en
// PROPORTION RÉELLE (pas compressée) — avec un plancher minimal pour qu'une toute petite œuvre
// (un médaillon d'émail à côté d'un Courbet monumental) reste tout de même visible et cliquable.
// Chaque image reste de toute façon bornée par sa propre case dans la grille (CSS width:100% +
// max-width) : si la case est plus étroite que la taille calculée ici, l'image se réduit
// naturellement à la largeur de sa case — inutile de recalculer un facteur de réduction à part.
function relativeImageSizes(works, maxPx = 560, minPx = 70, defaultPx = 320) {
  const heights = works.map((w) => parseCmValue(w?.hauteur));
  const validHeights = heights.filter((h) => h && h > 0);
  // Moins de 2 hauteurs connues : rien à comparer, on garde toutes les cases à une taille
  // généreuse par défaut plutôt que d'afficher une différence arbitraire basée sur une seule
  // donnée isolée.
  if (validHeights.length < 2) return works.map(() => defaultPx);
  const maxH = Math.max(...validHeights);
  return heights.map((h) => {
    if (!h || h <= 0) return defaultPx; // hauteur manquante pour cette œuvre précise : taille par défaut
    return Math.max(minPx, Math.round((h / maxH) * maxPx));
  });
}
function setLightboxScaleData(work) {
  currentLightboxWork = work && parseCmValue(work.hauteur) ? work : null;
  $('lightbox-scale-toggle-topbar')?.classList.toggle('hidden', !currentLightboxWork);
  exitScaleView();
}
function populateOverviewThumbs(candidates) {
  const container = $('scale-overview-thumbs');
  container.innerHTML = '';
  if (!candidates.length) return;
  // Vue d'ensemble : simples pastilles miniatures dispersées sur le mur, pour donner une idée du
  // nombre d'œuvres sans chercher à être proportionnées (ce sera le rôle du plan rapproché). Le
  // trapèze est plus étroit en haut (voir clip-path en CSS, 18%-82% à 0% de hauteur, 0%-100% à
  // 100%) — sans en tenir compte, les vignettes des rangées du haut tombaient hors de la forme
  // visible et semblaient toutes s'accumuler tout en bas (bug réel repéré : "les tableaux sont sur
  // le sol"). On calcule donc la largeur réellement visible à chaque rangée.
  const perRow = 6;
  candidates.slice(0, 24).forEach((w, i) => {
    const thumb = document.createElement('img');
    thumb.src = imageSourceSized(w.image, 60);
    thumb.alt = '';
    thumb.className = 'scale-overview-thumb';
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const topPct = 14 + row * 20;
    const narrow = 18 * (1 - topPct / 100); // marge perdue de chaque côté à cette hauteur
    const visibleLeft = narrow + 4;
    const visibleRight = 100 - narrow - 4;
    const step = (visibleRight - visibleLeft) / perRow;
    thumb.style.left = `${visibleLeft + col * step}%`;
    thumb.style.top = `${topPct}%`;
    thumb.style.width = `${Math.max(step - 1.5, 3)}%`;
    thumb.style.height = '11%';
    container.appendChild(thumb);
  });
}
function enterScaleView() {
  // Filet de sécurité pour « Revoir l'exposition » : si on est repassé par l'accueil entre-temps,
  // currentLightboxWork peut avoir été perdu alors que la sélection d'œuvres, elle, est toujours
  // là — on reprend simplement la première œuvre disponible dans ce cas.
  if (!currentLightboxWork && state.currentOtherWorks?.length) currentLightboxWork = state.currentOtherWorks[0];
  if (!currentLightboxWork) return;
  $('lightbox-scale-view').classList.remove('hidden');
  $('lightbox-scale-toggle-topbar').classList.add('hidden');
  $('lightbox-scale-back-button').classList.remove('hidden');
  const candidates = (state.currentOtherWorks && state.currentOtherWorks.length ? state.currentOtherWorks : [currentLightboxWork])
    .filter((w) => parseCmValue(w.hauteur));
  // On entre toujours par la vue d'ensemble (1er plan) — le mur rapproché (2e plan, ci-dessous)
  // ne s'affiche qu'après avoir tiré la silhouette vers l'avant. Le sol de la vue d'ensemble a sa
  // propre forme en trapèze (#scale-overview-floor, une perspective différente de celle du mur) —
  // le sol rectangulaire (#scale-floor) reste réservé au mur rapproché uniquement, pour ne pas
  // afficher deux sols superposés (bug réel repéré sur smartphone).
  $('scale-overview').classList.remove('hidden');
  $('scale-wall-line').classList.add('hidden');
  ['scale-floor', 'scale-silhouette', 'scale-silhouette-label', 'scale-wall', 'lightbox-scale-caption', 'scale-voice-control-button', 'scale-move-buttons', 'scale-minimap'].forEach((id) => $(id).classList.add('hidden'));
  populateOverviewThumbs(candidates);
  state.scaleViewCandidates = candidates;
}
// Les œuvres de la session sont réparties sur 4 murs (façon vraie salle rectangulaire) plutôt que
// sur un seul long mur — state.roomWalls garde les 4 groupes, currentWallIndex celui affiché.
let currentWallIndex = 0;
function splitIntoFourWalls(candidates) {
  const walls = [[], [], [], []];
  candidates.forEach((w, i) => walls[i % 4].push(w));
  return walls;
}
function positionMinimapDot() {
  const dot = $('scale-minimap-dot');
  if (!dot) return;
  // 0=mur du haut (fond), 1=mur de droite, 2=mur du bas (entrée), 3=mur de gauche.
  const positions = [
    { left: '50%', top: '12%' },
    { left: '88%', top: '50%' },
    { left: '50%', top: '88%' },
    { left: '12%', top: '50%' },
  ];
  const p = positions[currentWallIndex] || positions[0];
  dot.style.left = p.left; dot.style.top = p.top;
}
function goToWall(index) {
  currentWallIndex = ((index % 4) + 4) % 4;
  positionMinimapDot();
  populateCloserPlanWall((state.roomWalls || [[]])[currentWallIndex] || []);
}
function enterCloserPlan() {
  const candidates = state.scaleViewCandidates || [];
  state.roomWalls = splitIntoFourWalls(candidates);
  $('scale-overview').classList.add('hidden');
  $('scale-wall-line').classList.remove('hidden');
  ['scale-floor', 'scale-silhouette', 'scale-silhouette-label', 'scale-wall', 'lightbox-scale-caption', 'scale-voice-control-button', 'scale-move-buttons', 'scale-minimap'].forEach((id) => $(id).classList.remove('hidden'));
  // On attend que le navigateur ait vraiment posé la mise en page après avoir retiré "hidden" —
  // sans ce délai d'une frame, la silhouette pouvait encore mesurer une hauteur nulle sur certains
  // mobiles (rendu moins immédiat qu'sur ordinateur), ce qui plaçait alors tout, y compris les
  // tableaux, au ras du sol au lieu de les accrocher à hauteur des yeux.
  requestAnimationFrame(() => { goToWall(currentWallIndex); positionSilhouetteMic(); });
}
function backToOverview() {
  $('scale-overview').classList.remove('hidden');
  $('scale-wall-line').classList.add('hidden');
  ['scale-floor', 'scale-silhouette', 'scale-silhouette-label', 'scale-wall', 'lightbox-scale-caption', 'scale-voice-control-button', 'scale-move-buttons', 'scale-minimap'].forEach((id) => $(id).classList.add('hidden'));
}
function populateCloserPlanWall(candidates) {
  // La silhouette est fixée au bas de l'écran (voir CSS, position:fixed) — on lit sa position
  // réelle après affichage pour placer chaque œuvre en conséquence, plutôt que de deviner des
  // chiffres qui se déréglent au moindre changement de mise en page.
  const silhRect = $('scale-silhouette').getBoundingClientRect();
  const pxPerCm = silhRect.height / 170;
  const maxPx = Math.min(window.innerHeight * 0.7, 900);
  const eyeLevelFromBottom = silhRect.height * 0.92;
  const wall = $('scale-wall');
  wall.innerHTML = '';
  let cursorLeft = silhRect.right + 28;
  let currentNote = '';
  let currentHCm = 0;
  candidates.forEach((w) => {
    const hCm = parseCmValue(w.hauteur);
    const lCm = parseCmValue(w.longueur) || hCm;
    let artH = hCm * pxPerCm;
    let artW = lCm * pxPerCm;
    let note = '';
    if (artH > maxPx) {
      const ratio = artH / maxPx;
      artW = artW / ratio; artH = maxPx;
      note = ` — environ ${Math.round(hCm / 170)} fois la hauteur de la silhouette`;
    }
    // Les tableaux s'accrochent à hauteur des yeux (comme un vrai accrochage de musée) ; les
    // sculptures, elles, reposent au sol — comme une vraie statue sur son socle, pas suspendue en
    // l'air. On distingue via la catégorie d'origine (peinture/sculpture).
    const isSculpture = w.artCategory === 'sculpture';
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'scale-wall-item' + (isSculpture ? ' scale-sculpture' : '') + (w === currentLightboxWork ? ' current' : '');
    item.style.width = `${Math.max(artW, 4)}px`;
    item.style.height = `${Math.max(artH, 4)}px`;
    item.style.left = `${cursorLeft}px`;
    item.style.bottom = isSculpture ? '0px' : `${Math.max(eyeLevelFromBottom - artH / 2, 0)}px`;
    item.innerHTML = `<img src="${escapeHtml(imageSourceSized(w.image, artW))}" alt="" />`;
    item.addEventListener('click', () => {
      $('lightbox-scale-caption').textContent = `Hauteur réelle : ${hCm} cm${note}`;
      enterFocusView(w, hCm, note);
    });
    wall.appendChild(item);
    cursorLeft += Math.max(artW, 4) + 40;
    if (w === currentLightboxWork) { currentNote = note; currentHCm = hCm; }
  });
  $('lightbox-scale-caption').textContent = `Hauteur réelle : ${currentHCm} cm${currentNote}`;
}
// Vue rapprochée d'une œuvre précise : elle occupe le plus possible de l'écran, la silhouette se
// tient juste à côté à sa vraie échelle relative — même principe que le mur, mais en très grand,
// pour bien ressentir la taille d'une seule œuvre. On sort en tirant la silhouette hors du cadre ;
// le mur retrouve sa position exacte (la promenade continue là où elle s'était arrêtée).
function enterFocusView(work, hCm, note) {
  const lCm = parseCmValue(work.longueur) || hCm;
  $('scale-focus-view').classList.remove('hidden');
  const maxArtH = window.innerHeight * 0.82;
  const maxArtW = window.innerWidth * 0.62;
  const pxPerCm = Math.min(maxArtH / hCm, maxArtW / lCm);
  const artH = hCm * pxPerCm;
  const artW = lCm * pxPerCm;
  const silhH = 170 * pxPerCm;
  const img = $('scale-focus-img');
  img.src = imageSourceSized(work.image, artW);
  img.style.width = `${artW}px`;
  img.style.height = `${artH}px`;
  img.style.left = `calc(50% - ${artW / 2 - 60}px)`;
  img.style.top = `calc(50% - ${artH / 2}px)`;
  const sil = $('scale-focus-silhouette');
  const silW = silhH * (100 / 340); // largeur réelle du SVG (viewBox 100×340), pour ne jamais chevaucher l'œuvre
  sil.style.height = `${silhH}px`;
  sil.style.left = `calc(50% - ${artW / 2 - 60}px - ${silW + 14}px)`;
  sil.style.top = `calc(50% + ${artH / 2}px - ${silhH}px)`;
  $('scale-focus-caption').textContent = `Hauteur réelle : ${hCm} cm${note}`;
}
function exitFocusView() {
  $('scale-focus-view').classList.add('hidden');
}
makeSilhouetteDraggable($('scale-focus-silhouette'), {
  onDragEnd: (dx, dy) => {
    // Un geste net suffit à sortir du cadre — pas besoin d'un seuil énorme, l'œuvre occupant déjà
    // tout l'écran, un petit glissement dans n'importe quelle direction est déjà volontaire.
    if (Math.abs(dx) > 40 || Math.abs(dy) > 40) exitFocusView();
  },
});
// Navigation entièrement par la silhouette, qu'on « tire » à la souris ou au doigt — plus aucun
// bouton de direction séparé. Sur la vue d'ensemble : tirer vers le haut (vers l'avant) fait
// entrer dans le mur rapproché. Sur le mur rapproché : tirer vers le bas (vers l'arrière) repasse
// à la vue d'ensemble ; tirer à gauche/droite fait défiler le mur d'autant, en direct.
function makeSilhouetteDraggable(el, { onDrag, onDragEnd } = {}) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  el.style.cursor = 'grab';
  el.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    el.style.cursor = 'grabbing';
    el.setPointerCapture?.(event.pointerId);
  });
  el.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    onDrag?.(event.clientX - startX, event.clientY - startY);
  });
  const stop = (event) => {
    if (!dragging) return;
    dragging = false;
    el.style.cursor = 'grab';
    onDragEnd?.(event.clientX - startX, event.clientY - startY, event.clientX, event.clientY);
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
}
// Glisser la silhouette jusque dans un coin inférieur de l'écran fait sortir complètement de la
// salle (retour à l'image normale), depuis n'importe lequel des deux plans — un geste qui
// prolonge naturellement le "tirer vers l'arrière/le bas" déjà utilisé pour reculer d'un plan.
function isNearBottomCorner(clientX, clientY) {
  const nearBottom = clientY > window.innerHeight - 70;
  const nearEdge = clientX < 70 || clientX > window.innerWidth - 70;
  return nearBottom && nearEdge;
}
// Les mains cliquables (tap/glisser/double-tap) ont été essayées puis retirées : les deux flèches
// ◄ ► ci-dessous se sont avérées plus simples et plus claires à l'usage.
// Appui maintenu = avance tant qu'on garde le doigt/la souris dessus, relâchement = arrêt immédiat.
function attachMoveButton(btn, direction) {
  if (!btn) return;
  const start = (event) => { event.preventDefault(); startWalking(direction); };
  const stop = () => stopWalking();
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('pointerleave', stop); // relâché hors du bouton (doigt qui glisse) = arrêt aussi
}
attachMoveButton($('scale-move-left'), -1);
attachMoveButton($('scale-move-right'), 1);
// Glisser le point rouge de la mini-carte vers un des 4 côtés du rectangle fait passer sur ce mur
// — on détermine le côté le plus proche au relâchement (pas besoin de viser pile un coin).
(function attachMinimapDrag() {
  const minimap = $('scale-minimap');
  const dot = $('scale-minimap-dot');
  if (!minimap || !dot) return;
  let dragging = false;
  const moveTo = (clientX, clientY) => {
    const rect = minimap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    dot.style.left = `${x * 100}%`; dot.style.top = `${y * 100}%`;
    // Distance au centre de chaque côté (haut/droite/bas/gauche), en coordonnées 0..1.
    const distances = [y, 1 - x, 1 - y, x];
    const nearest = distances.indexOf(Math.min(...distances));
    if (nearest !== currentWallIndex) goToWall(nearest);
  };
  dot.addEventListener('pointerdown', (event) => { event.preventDefault(); dragging = true; dot.setPointerCapture?.(event.pointerId); dot.style.cursor = 'grabbing'; });
  dot.addEventListener('pointermove', (event) => { if (dragging) moveTo(event.clientX, event.clientY); });
  const stop = () => { dragging = false; dot.style.cursor = 'grab'; positionMinimapDot(); };
  dot.addEventListener('pointerup', stop);
  dot.addEventListener('pointercancel', stop);
})();
// Repositionne le micro façon audioguide, contre l'oreille de la silhouette — recalculé à chaque
// entrée dans le mur rapproché, puisque la taille de la silhouette change avec l'échelle choisie.
function positionSilhouetteMic() {
  const sil = $('scale-silhouette');
  const mic = $('scale-voice-control-button');
  if (!sil || !mic || sil.classList.contains('hidden')) return;
  const rect = sil.getBoundingClientRect();
  if (!rect.height) return;
  // L'oreille se situe vers le tiers droit de la tête, elle-même les ~6 % du haut du corps.
  mic.style.left = `${rect.left + rect.width * 0.62 - 13}px`;
  mic.style.top = `${rect.top + rect.height * 0.045 - 13}px`;
}
window.addEventListener('resize', positionSilhouetteMic);
makeSilhouetteDraggable($('scale-overview-silhouette'), {
  onDragEnd: (dx, dy, endX, endY) => {
    if (isNearBottomCorner(endX, endY)) { exitScaleViewCompletely(); return; }
    // Tirer vers le haut (vers le fond de la salle) fait avancer vers le mur rapproché.
    if (dy < -40) enterCloserPlan();
  },
});
// Marche fluide et maîtrisée : on tire la silhouette d'un côté, elle avance à vitesse constante
// dans cette direction tant qu'on maintient — le mur défile exactement au même rythme, dans la
// même boucle d'animation, donc les deux restent strictement synchronisés (plus de désynchro
// possible). Une fois une direction engagée (horizontale ou verticale), elle seule compte pour ce
// geste — évite les mouvements désordonnés qui produisaient des sorties par erreur.
let walkAnimationId = null;
let walkSpeed = 4; // pixels par image (~60 im/s) — ajustable à la voix ("plus vite"/"moins vite")
let walkDirection = 0; // -1 gauche, 0 arrêté, 1 droite — mémorisé pour "plus vite" sans redonner le sens
function stopWalking() {
  if (walkAnimationId) clearTimeout(walkAnimationId);
  walkAnimationId = null;
  walkDirection = 0;
  $('scale-silhouette').classList.remove('walking-left', 'walking-right');
}
function startWalking(direction) {
  stopWalking();
  walkDirection = direction;
  const wall = $('scale-wall');
  const sil = $('scale-silhouette');
  sil.classList.add(direction > 0 ? 'walking-right' : 'walking-left');
  const step = () => {
    wall.scrollLeft += walkDirection * walkSpeed;
    walkAnimationId = setTimeout(step, 16); // ~60 images/seconde, sans dépendre de requestAnimationFrame
  };
  walkAnimationId = setTimeout(step, 16);
}
makeSilhouetteDraggable($('scale-silhouette'), {
  onDrag: (dx, dy) => {
    // Une seule direction engagée par geste : la première franchie (horizontale ou verticale, au
    //-delà d'un petit seuil) « gagne » pour le reste du geste, l'autre est ignorée.
    const sil = $('scale-silhouette');
    if (!sil.dataset.dragAxis) {
      if (Math.abs(dx) > 12) sil.dataset.dragAxis = 'x';
      else if (Math.abs(dy) > 12) sil.dataset.dragAxis = 'y';
      else return;
    }
    if (sil.dataset.dragAxis === 'x') {
      startWalking(dx > 0 ? 1 : -1);
    } else {
      stopWalking();
    }
  },
  onDragEnd: (dx, dy, endX, endY) => {
    stopWalking();
    delete $('scale-silhouette').dataset.dragAxis;
    if (isNearBottomCorner(endX, endY)) { exitScaleViewCompletely(); return; }
    // Seuil plus élevé, et le geste doit être franchement vertical (pas un déplacement latéral
    // avec un peu de tremblement) — trop sensible avant, un retour brutal au plan général pouvait
    // se déclencher par erreur en voulant simplement se déplacer le long du mur.
    if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) backToOverview();
  },
});
function exitScaleView() {
  $('lightbox-scale-view').classList.add('hidden');
  $('lightbox-scale-back-button').classList.add('hidden');
  $('scale-focus-view').classList.add('hidden');
  $('lightbox-scale-toggle-topbar')?.classList.toggle('hidden', !currentLightboxWork);
}
// Sortie complète de la salle (geste du coin) : referme toute la visionneuse, pas seulement la
// vue à l'échelle — sinon l'image normale restait affichée en dessous (celle de la première
// œuvre, ex. « Charles VII »), obligeant à appuyer une seconde fois sur la croix pour vraiment
// sortir. Bug réel repéré.
function exitScaleViewCompletely() {
  exitScaleView();
  $('image-lightbox').classList.add('hidden');
  currentLightboxWork = null;
}
$('lightbox-scale-toggle-topbar')?.addEventListener('click', enterScaleView);
$('lightbox-scale-back-button')?.addEventListener('click', exitScaleView);
function openLightboxImage(url, caption, work) {
  $('lightbox-image').src = imageSourceSized(url, 1000);
  $('lightbox-caption').textContent = caption || '';
  setLightboxScaleData(work || null);
  const sourceLink = $('lightbox-source-link');
  const commonsUrl = commonsFilePageUrl(imageSource(url));
  if (sourceLink) {
    if (commonsUrl) { sourceLink.href = commonsUrl; sourceLink.classList.remove('hidden'); }
    else sourceLink.classList.add('hidden');
  }
  $('image-lightbox').classList.remove('hidden');
}
function showBottomGallery(work) {
  const bar = $('bottom-gallery');
  if (!bar) return;
  const items = [];
  if (work.artistImage) items.push({ url: work.artistImage, label: work.artist, caption: work.artist });
  if (work.locationImage) items.push({ url: work.locationImage, label: work.ville || 'Lieu', caption: work.location });
  if (!items.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.innerHTML = items.map((item) => `<button type="button" class="bottom-gallery-item" data-url="${escapeHtml(item.url)}" data-caption="${escapeHtml(item.caption)}">
    <img src="${escapeHtml(imageSourceSized(item.url, 100))}" alt="" /><span>${escapeHtml(item.label)}</span>
  </button>`).join('');
  bar.querySelectorAll('.bottom-gallery-item').forEach((btn) => {
    btn.addEventListener('click', () => openLightboxImage(btn.dataset.url, btn.dataset.caption));
  });
  bar.classList.remove('hidden');
}
function hideBottomGallery() {
  const bar = $('bottom-gallery');
  if (bar) { bar.classList.add('hidden'); bar.innerHTML = ''; }
}
async function openArtistWorksPage(idx) {
  const row = artistListSortedRows[idx];
  if (!row) return;
  currentArtistWorksIndex = idx;
  const artistName = [row['Prénom'], row['Patronyme']].filter(Boolean).join(' ').trim();
  const displayName = String(row['Surnom'] || '').trim() || artistName;
  closeModal('modal-artist-list');
  showPanel('other-works');
  $('other-works-artist-name').textContent = displayName;
  $('other-works-artist-flag').textContent = artistFlag(row['Nationalité']);
  $('other-works-artist-dates').textContent = '';
  const list = $('other-works-panel-list');
  list.innerHTML = '<p class="modal-hint">Chargement des œuvres…</p>';
  const arts = String(row['Art(s)'] || '').split(',').map((s) => keyName(s.trim())).filter(Boolean);
  const centuries = String(row['Siècle(s)'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  let allRows = [];
  for (const art of arts) {
    for (const century of centuries) {
      try {
        const rows = await fetchQuizRows(art, century);
        rows.forEach((r) => { r.artCategory = art; });
        allRows.push(...rows);
      } catch (e) { /* fichier absent, ignoré */ }
    }
  }
  const works = allRows
    .filter((w) => keyName(w.artist) === keyName(artistName))
    .sort((a, b) => {
      const yearA = yearsOf(a.date)[0]; const yearB = yearsOf(b.date)[0];
      if (yearA == null && yearB == null) return 0;
      if (yearA == null) return 1;
      if (yearB == null) return -1;
      return yearA - yearB;
    });
  if (works[0]?.artistDates) $('other-works-artist-dates').textContent = works[0].artistDates;
  state.currentOtherWorks = works;
  if (!works.length) { list.innerHTML = '<p class="modal-hint">Aucune œuvre trouvée pour cet artiste.</p>'; return; }
  renderOtherWorksPanel();
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
  // Quand la hauteur réelle est connue, la vignette est mise à l'échelle par rapport à la plus
  // grande œuvre connue de cet artiste — pour voir d'un coup d'œil les écarts de taille entre ses
  // œuvres, sans avoir besoin d'ouvrir la vue à l'échelle. Les œuvres sans hauteur connue gardent
  // la taille par défaut (impossible de les mettre à l'échelle).
  const knownHeights = otherWorks.map((w) => parseCmValue(w.hauteur)).filter(Boolean);
  const maxHeightCm = knownHeights.length ? Math.max(...knownHeights) : 0;
  list.innerHTML = otherWorks.map((otherQuestion, index) => {
    const source = imageSourceSized(otherQuestion.image, 400);
    const titleValue = formatCorrectionValue('title', otherQuestion.title);
    const hCm = parseCmValue(otherQuestion.hauteur);
    const scaleStyle = hCm && maxHeightCm ? ` style="--scale-ratio:${Math.max(hCm / maxHeightCm, 0.15)};"` : '';
    return `<button type="button" class="other-work-card-big${hCm ? ' scaled' : ''}" data-index="${index}"${scaleStyle}>
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
      $('lightbox-image').src = imageSourceSized(work.image, 1000);
      $('lightbox-caption').innerHTML = `<strong>${titleValue}</strong><br>${escapeHtml(work.date)} — ${escapeHtml(work.location)}`;
      setLightboxScaleData(work);
      const sourceLink = $('lightbox-source-link');
      const commonsUrl = commonsFilePageUrl(imageSource(work.image));
      if (sourceLink) {
        if (commonsUrl) { sourceLink.href = commonsUrl; sourceLink.classList.remove('hidden'); }
        else sourceLink.classList.add('hidden');
      }
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
let artistListSort = { col: 'Patronyme', dir: 1 };
let artistListFilters = { nationalite: '', art: '', siecle: '' };
let artistListMode = 'full'; // 'full' = liste complète non filtrée, 'filtered' = avec les 3 menus
const ARTIST_LIST_COLS = [
  { key: 'Patronyme', label: 'Artiste' },
  { key: 'Nationalité', label: 'Nationalité' },
  { key: 'Art(s)', label: 'Art(s)' },
  { key: 'Siècle(s)', label: 'Siècle(s)' },
];
const ARTIST_NAME_PARTICLES = ['da','di','de','del','della','van','von','le','la','les','du','des','dei','af',"d'"];
function particleStrippedSortKey(patronyme) {
  const words = keyName(patronyme).split(' ').filter(Boolean);
  while (words.length && ARTIST_NAME_PARTICLES.includes(words[0])) words.shift();
  return words.join(' ') || keyName(patronyme);
}
function formatArtistListName(row) {
  // Si un surnom est connu (ex. « Le Greco », « Fra Angelico »), c'est lui qui identifie
  // l'artiste dans la liste — plus reconnaissable que le nom civil. Sinon, colonnes séparées
  // (Prénom, Patronyme) : l'entrée se lit nom puis prénom, le prénom en casse normale, le nom de
  // famille tel qu'enregistré (en général en majuscules) mis en avant.
  const surnom = String(row['Surnom'] || '').trim();
  if (surnom) return `<strong>${escapeHtml(surnom)}</strong>`;
  const nom = String(row['Patronyme'] || '').trim();
  const prenom = String(row['Prénom'] || '').trim();
  if (!nom) return `<strong>${escapeHtml(prenom)}</strong>`;
  const prenomPart = prenom ? ` ${escapeHtml(prenom)}` : '';
  return `<strong>${escapeHtml(nom)}</strong>${prenomPart}`;
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
let artistListSortedRows = [];
function artFormIcons(rawValue) {
  const v = keyName(rawValue);
  const parts = [];
  if (v.includes('peinture')) parts.push('<span title="Peinture" aria-label="Peinture">🖼️</span>');
  if (v.includes('sculpture')) parts.push('<span title="Sculpture" aria-label="Sculpture">🗿</span>');
  return parts.join(' ') || escapeHtml(rawValue || '');
}
function renderArtistListTable() {
  const container = $('artist-list-table');
  const { col, dir } = artistListSort;
  // Trie par surnom quand il existe (ex. « Le Greco » trie à G, « Bada Shanren » à B) — sinon,
  // par nom de famille. Dans les deux cas, les particules en tête (le, da, van...) sont ignorées.
  const sortKeyForRow = (row) => particleStrippedSortKey(row['Surnom'] || row['Patronyme']);
  const sorted = filteredArtistListRows().sort((a, b) => {
    if (col === 'Patronyme') {
      const byNom = dir * sortKeyForRow(a).localeCompare(sortKeyForRow(b), 'fr');
      if (byNom !== 0) return byNom;
      return dir * String(a['Prénom'] || '').localeCompare(String(b['Prénom'] || ''), 'fr');
    }
    return dir * String(a[col] || '').localeCompare(String(b[col] || ''), 'fr');
  });
  artistListSortedRows = sorted;
  const html = ['<table class="artist-table"><thead><tr>'];
  ARTIST_LIST_COLS.forEach((c) => {
    const arrow = col === c.key ? (dir === 1 ? ' ▲' : ' ▼') : '';
    html.push(`<th class="sortable-col" data-col="${c.key}">${c.label}${arrow}</th>`);
  });
  html.push('</tr></thead><tbody>');
  sorted.forEach((r, idx) => {
    html.push(`<tr><td><button type="button" class="artist-name-link" data-idx="${idx}">${formatArtistListName(r)}</button></td><td>${artistFlag(r['Nationalité']) || escapeHtml(r['Nationalité'] || '')}</td><td>${artFormIcons(r['Art(s)'])}</td><td>${escapeHtml(r['Siècle(s)'] || '')}</td></tr>`);
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
  container.querySelectorAll('.artist-name-link').forEach((btn) => {
    btn.addEventListener('click', () => openArtistWorksPage(Number(btn.dataset.idx)));
  });
  const status = $('artist-list-status');
  const hasFilter = artistListMode === 'filtered' && (artistListFilters.nationalite || artistListFilters.art || artistListFilters.siecle);
  status.textContent = hasFilter
    ? `${sorted.length} artiste${sorted.length > 1 ? 's' : ''} correspondant au filtre (sur ${artistListRows.length} au total).`
    : `${artistListRows.length} artistes référencés dans les quiz. Cliquez sur un nom pour voir ses œuvres.`;
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
async function loadArtistListIfNeeded() {
  if (artistListLoaded) return true;
  try {
    if (!window.XLSX) throw new Error('Le module de lecture Excel n’a pas été chargé.');
    const response = await fetch('quizzes/artistes-nationalites-maitre.xlsx');
    if (!response.ok) throw new Error('fichier introuvable');
    const buffer = await response.arrayBuffer();
    const book = XLSX.read(buffer, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
    if (!rows.length) throw new Error('liste vide');
    artistListRows = rows;
    artistListLoaded = true;
    return true;
  } catch (error) {
    return false;
  }
}
// --- Salle d'exposition : entrée par nom d'artiste (un ou plusieurs), directement dans la vue à
// l'échelle avec les œuvres combinées de tous les artistes demandés.
function findArtistRow(query) {
  const q = keyName(query);
  if (!q) return null;
  // Recherche par paliers de confiance décroissante — une correspondance exacte doit toujours
  // l'emporter sur une correspondance partielle, sinon un nom plus court entièrement contenu
  // dans la saisie (ex. "Mone" dans "Monet") peut passer avant le bon artiste dans la liste. Bug
  // réel repéré : chercher "Monet" renvoyait Jean MONE (patronyme "Mone", sous-chaîne de "Monet"),
  // qui apparaît plus tôt dans le fichier maître que Claude MONET.
  const exact = artistListRows.find((row) => {
    const full = keyName(`${row['Prénom'] || ''} ${row['Patronyme'] || ''}`);
    const patronyme = keyName(row['Patronyme'] || '');
    const surnom = keyName(row['Surnom'] || '');
    return full === q || patronyme === q || surnom === q;
  });
  if (exact) return exact;
  const partial = artistListRows.find((row) => {
    const full = keyName(`${row['Prénom'] || ''} ${row['Patronyme'] || ''}`);
    const surnom = keyName(row['Surnom'] || '');
    return full.includes(q) || (surnom && surnom.includes(q));
  });
  if (partial) return partial;
  return artistListRows.find((row) => {
    const patronyme = keyName(row['Patronyme'] || '');
    return patronyme && q.includes(patronyme);
  }) || null;
}
async function fetchWorksForArtistRow(row) {
  const artistName = [row['Prénom'], row['Patronyme']].filter(Boolean).join(' ').trim();
  // La salle se limite pour l'instant à la peinture (les sculptures y reviendront une fois le
  // détourage et le rail travaillés) — même si l'artiste pratique aussi la sculpture.
  const arts = String(row['Art(s)'] || '').split(',').map((s) => s.trim().toLocaleLowerCase('fr-FR')).filter((a) => a === 'peinture');
  const centuries = String(row['Siècle(s)'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const works = [];
  for (const art of arts) {
    for (const century of centuries) {
      try {
        const rows = await fetchQuizRows(art, century);
        rows.filter((w) => keyName(w.artist) === keyName(artistName)).forEach((w) => { w.artCategory = art; works.push(w); });
      } catch (e) { /* fichier absent, ignoré */ }
    }
  }
  return works;
}
$('global-exhibition-button')?.addEventListener('click', (event) => {
  event.stopPropagation();
  updateExhibitionButtonLabel();
  const picker = $('exhibition-picker');
  const wasHidden = picker.classList.contains('hidden');
  picker.classList.toggle('hidden');
  if (!wasHidden) return; // on referme simplement si elle était déjà ouverte
  // Si une exposition est déjà en cours dans cette session (le joueur est déjà entré une fois
  // dans la salle), on propose d'abord de la revoir directement, plutôt que de retaper les noms —
  // « Changer l'exposition » ramène au formulaire habituel.
  // Le double choix (revoir / changer) doit apparaître dès qu'une exposition existe déjà — pas
  // seulement si le joueur est déjà entré dans la salle CETTE session : une exposition choisie
  // lors d'une session précédente (mémorisée) compte tout autant comme « en cours ».
  let lastArtistsCheck = [];
  try { lastArtistsCheck = JSON.parse(localStorage.getItem('lastExhibitionArtists') || '[]'); } catch (e) {}
  const hasCurrentExhibition = (state.scaleViewCandidates && state.scaleViewCandidates.length > 0) || lastArtistsCheck.length > 0;
  $('exhibition-resume-choice').classList.toggle('hidden', !hasCurrentExhibition);
  $('exhibition-picker-form').classList.toggle('hidden', hasCurrentExhibition);
  if (hasCurrentExhibition) return;
  // Les noms de la dernière exposition sont proposés par défaut (uniquement si les champs sont
  // encore vides) — évite de les retaper à chaque fois qu'on veut revoir la même sélection.
  const firstField = picker.querySelector('.exhibition-artist-field');
  const allEmpty = [...picker.querySelectorAll('.exhibition-artist-field')].every((f) => !f.value.trim());
  if (allEmpty) {
    let lastArtists = [];
    try { lastArtists = JSON.parse(localStorage.getItem('lastExhibitionArtists') || '[]'); } catch (e) {}
    if (lastArtists.length) {
      const wrap = $('exhibition-artist-inputs');
      wrap.innerHTML = '';
      lastArtists.forEach((name) => {
        const field = document.createElement('input');
        field.type = 'text';
        field.className = 'exhibition-artist-field';
        field.placeholder = 'Ex. Jean Fouquet';
        field.value = name;
        field.style.cssText = 'width:100%;padding:8px;border:1px solid var(--border);border-radius:4px;font:inherit;margin-bottom:6px;';
        wrap.appendChild(field);
      });
    }
  }
  firstField?.focus();
});
$('exhibition-add-artist-button')?.addEventListener('click', () => {
  const wrap = $('exhibition-artist-inputs');
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'exhibition-artist-field';
  field.placeholder = 'Ex. Le Bernin';
  field.style.cssText = 'width:100%;padding:8px;border:1px solid var(--border);border-radius:4px;font:inherit;margin-bottom:6px;';
  wrap.appendChild(field);
  field.focus();
});
// Logique commune de chargement des œuvres d'une exposition (à partir de noms d'artistes) et
// d'entrée dans la vue à l'échelle — utilisée à la fois par la création d'une nouvelle exposition
// et par « Revoir l'exposition » quand les œuvres ne sont plus en mémoire (nouvelle session).
async function loadAndEnterExhibition(names, feedback) {
  if (feedback) { feedback.style.color = 'var(--muted)'; feedback.textContent = 'Recherche en cours…'; }
  const ok = await loadArtistListIfNeeded();
  if (!ok) { if (feedback) { feedback.style.color = 'var(--wrong)'; feedback.textContent = "La liste des artistes n'est pas disponible pour le moment."; } return false; }
  const matchedRows = [];
  names.forEach((name) => { const row = findArtistRow(name); if (row) matchedRows.push(row); });
  if (!matchedRows.length) { if (feedback) { feedback.style.color = 'var(--wrong)'; feedback.textContent = 'Aucun artiste trouvé.'; } return false; }
  let allWorks = [];
  for (const row of matchedRows) allWorks = allWorks.concat(await fetchWorksForArtistRow(row));
  if (!allWorks.length) { if (feedback) { feedback.style.color = 'var(--wrong)'; feedback.textContent = 'Aucune œuvre trouvée pour cette sélection.'; } return false; }
  allWorks.sort((a, b) => (a.artCategory === b.artCategory ? 0 : a.artCategory === 'sculpture' ? 1 : -1));
  state.currentOtherWorks = allWorks;
  const firstWithHeight = allWorks.find((w) => parseCmValue(w.hauteur)) || allWorks[0];
  const titleValue = formatCorrectionValue('title', firstWithHeight.title);
  $('lightbox-image').src = imageSourceSized(firstWithHeight.image, 1000);
  $('lightbox-caption').innerHTML = `<strong>${titleValue}</strong><br>${escapeHtml(firstWithHeight.date)} — ${escapeHtml(firstWithHeight.location)}`;
  setLightboxScaleData(firstWithHeight);
  $('image-lightbox').classList.remove('hidden');
  enterScaleView();
  return true;
}
$('exhibition-resume-button')?.addEventListener('click', async () => {
  $('exhibition-picker').classList.add('hidden');
  // Si les œuvres sont déjà en mémoire (le joueur est déjà entré cette session), on rouvre
  // directement — sinon (exposition mémorisée d'une session précédente), il faut les recharger.
  if (state.currentOtherWorks && state.currentOtherWorks.length) {
    $('image-lightbox').classList.remove('hidden');
    enterScaleView();
    return;
  }
  let lastArtists = [];
  try { lastArtists = JSON.parse(localStorage.getItem('lastExhibitionArtists') || '[]'); } catch (e) {}
  if (lastArtists.length) await loadAndEnterExhibition(lastArtists, null);
});
$('exhibition-change-button')?.addEventListener('click', () => {
  $('exhibition-resume-choice').classList.add('hidden');
  $('exhibition-picker-form').classList.remove('hidden');
  $('exhibition-picker').querySelector('.exhibition-artist-field')?.focus();
});
// Libellé compact des artistes en cours d'exposition, sur le bouton salle lui-même — même
// principe que sur les boutons de jeux, pour qu'on sache d'un coup d'œil ce qui est chargé.
function updateExhibitionButtonLabel() {
  const label = $('exhibition-button-label');
  if (!label) return;
  let artists = [];
  try { artists = JSON.parse(localStorage.getItem('lastExhibitionArtists') || '[]'); } catch (e) {}
  if (!artists.length) { label.textContent = ''; return; }
  const shown = artists.slice(0, 2).join('/');
  label.textContent = artists.length > 2 ? `${shown} +${artists.length - 2}` : shown;
}
// Pas d'appel au chargement de la page : le nom de l'exposition ne doit apparaître qu'en appuyant
// sur le bouton salle lui-même — laissé visible en permanence dans le bandeau, il donnait
// l'impression à tort d'être un champ appliqué aux exercices.
$('exhibition-launch-button')?.addEventListener('click', async () => {
  const feedback = $('exhibition-feedback');
  const names = [...document.querySelectorAll('.exhibition-artist-field')].map((f) => f.value.trim()).filter(Boolean);
  if (!names.length) { feedback.textContent = 'Indique au moins un nom d’artiste.'; return; }
  localStorage.setItem('lastExhibitionArtists', JSON.stringify(names));
  updateExhibitionButtonLabel();
  feedback.style.color = 'var(--muted)';
  feedback.textContent = 'Recherche en cours…';
  const ok = await loadArtistListIfNeeded();
  if (!ok) { feedback.style.color = 'var(--wrong)'; feedback.textContent = "La liste des artistes n'est pas disponible pour le moment."; return; }
  const matchedRows = [];
  const notFound = [];
  names.forEach((name) => {
    const row = findArtistRow(name);
    if (row) matchedRows.push(row); else notFound.push(name);
  });
  if (!matchedRows.length) {
    feedback.style.color = 'var(--wrong)';
    feedback.textContent = `Aucun artiste trouvé pour : ${notFound.join(', ')}.`;
    return;
  }
  // Si certains noms ne correspondent à aucun artiste, on le signale clairement avant de
  // continuer avec les autres — plutôt que d'avancer en silence avec une partie seulement de la
  // sélection, ce qui donnait l'impression trompeuse qu'un nom tapé n'était « pas pris en
  // compte » sans jamais dire pourquoi.
  if (notFound.length) {
    const continuer = window.confirm(`Artiste(s) introuvable(s) : ${notFound.join(', ')}.\n\nContinuer quand même avec : ${matchedRows.map((r) => [r['Prénom'], r['Patronyme'] || r['Surnom']].filter(Boolean).join(' ')).join(', ')} ?`);
    if (!continuer) { feedback.style.color = 'var(--wrong)'; feedback.textContent = `Corrige le nom : ${notFound.join(', ')}.`; return; }
  }
  let allWorks = [];
  for (const row of matchedRows) {
    allWorks = allWorks.concat(await fetchWorksForArtistRow(row));
  }
  if (!allWorks.length) {
    feedback.style.color = 'var(--wrong)';
    feedback.textContent = 'Aucune œuvre trouvée pour cette sélection.';
    return;
  }
  // Peintures d'abord, sculptures ensuite — plutôt qu'un simple enchaînement dans l'ordre de
  // récupération, pour préparer visuellement la distinction « tableaux en haut, statues au sol »
  // une fois affichées dans la salle.
  allWorks.sort((a, b) => (a.artCategory === b.artCategory ? 0 : a.artCategory === 'sculpture' ? 1 : -1));
  state.currentOtherWorks = allWorks;
  $('exhibition-picker').classList.add('hidden');
  document.querySelectorAll('.exhibition-artist-field').forEach((f, i) => { if (i > 0) f.remove(); else f.value = ''; });
  feedback.textContent = '';
  const firstWithHeight = allWorks.find((w) => parseCmValue(w.hauteur)) || allWorks[0];
  const titleValue = formatCorrectionValue('title', firstWithHeight.title);
  $('lightbox-image').src = imageSourceSized(firstWithHeight.image, 1000);
  $('lightbox-caption').innerHTML = `<strong>${titleValue}</strong><br>${escapeHtml(firstWithHeight.date)} — ${escapeHtml(firstWithHeight.location)}`;
  setLightboxScaleData(firstWithHeight);
  $('image-lightbox').classList.remove('hidden');
  enterScaleView();
  if (notFound.length) { /* signalé silencieusement pour l'instant : l'essentiel a été trouvé */ }
});
document.addEventListener('click', (event) => {
  const picker = $('exhibition-picker');
  if (!picker || picker.classList.contains('hidden')) return;
  if (!picker.contains(event.target) && event.target !== $('global-exhibition-button')) {
    picker.classList.add('hidden');
  }
});

$('menu-item-artistes')?.addEventListener('click', async () => {
  closeHamburgerMenu();
  openModal('modal-artist-list');
  if (artistListLoaded) return;
  const status = $('artist-list-status');
  const ok = await loadArtistListIfNeeded();
  if (ok) {
    populateArtistListFilters();
    setArtistListMode('full');
  } else {
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
// Sur petit écran, ces 4 boutons disparaissent du bandeau (faute de place) — ces entrées
// déclenchent le même bouton d'origine plutôt que de dupliquer sa logique.
// event.stopPropagation() est nécessaire ici : sans lui, le clic d'origine continue de remonter
// jusqu'au document APRÈS avoir déclenché le bouton visé, et se fait alors interpréter comme un
// « clic à l'extérieur » qui referme aussitôt le panneau qu'on vient d'ouvrir (repéré sur le
// bouton Salle d'exposition, resté inactif sur mobile pour cette raison).
$('menu-item-fullscreen')?.addEventListener('click', (event) => { event.stopPropagation(); closeHamburgerMenu(); $('global-fullscreen-button')?.click(); });
$('menu-item-ambiance')?.addEventListener('click', (event) => { event.stopPropagation(); closeHamburgerMenu(); $('global-ambiance-button')?.click(); });
$('menu-item-exhibition')?.addEventListener('click', (event) => { event.stopPropagation(); closeHamburgerMenu(); $('global-exhibition-button')?.click(); });
$('menu-item-account')?.addEventListener('click', (event) => { event.stopPropagation(); closeHamburgerMenu(); $('global-account-button')?.click(); });
$('open-mentions-legales')?.addEventListener('click', () => openModal('modal-mentions-legales'));
$('global-home-button')?.addEventListener('click', () => showPanel('welcome'));
// Bouton « page précédente » — utile seulement quand l'appli est installée comme application
// (barre d'adresse du navigateur, avec son propre bouton retour, non visible dans ce mode) : on
// s'appuie sur l'historique interne déjà tenu à jour par showPanel() à chaque navigation.
const isStandaloneApp = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
if (isStandaloneApp) $('global-back-button')?.classList.remove('hidden');
$('global-back-button')?.addEventListener('click', () => {
  // Sur une page de configuration (Mon compte ou parcours guidé), la flèche doit ramener à
  // l'étape de configuration précédente plutôt qu'à l'accueil — bug réel repéré : ces pages ne
  // posent pas leur propre halte dans l'historique du navigateur, donc history.back() sautait
  // par-dessus tout droit jusqu'à l'accueil.
  const activeProfileBtn = document.querySelector('.profile-menu-btn:not(.inactive)');
  if (activeProfileBtn && !$('profile-panel')?.classList.contains('hidden')) {
    const idx = PROFILE_CONFIG_SEQUENCE.indexOf(activeProfileBtn.id);
    if (idx > 0) { $(PROFILE_CONFIG_SEQUENCE[idx - 1])?.click(); return; }
    showProfileHub();
    return;
  }
  const activeGuidedStep = [...document.querySelectorAll('.gc-step')].find((el) => !el.classList.contains('hidden'));
  if (activeGuidedStep && !$('guided-config-panel')?.classList.contains('hidden')) {
    const steps = [...document.querySelectorAll('.gc-step')];
    const idx = steps.indexOf(activeGuidedStep);
    if (idx > 0) { steps.forEach((s, i) => s.classList.toggle('hidden', i !== idx - 1)); return; }
  }
  history.back();
});

// ============================================================
// MODULE RECONSTITUTION — un détail très resserré (< 10 % de la surface) sert d'indice ; 3
// références (artiste + titre) sont proposées. Même mécanique de correction que Intrus (référence
// choisie conservée avec son verdict), puis l'image entière est révélée avec la référence complète.
// ============================================================
function showReconConfig() {
  showPanel('reconstitution-setup'); populateReconVoices(); speakObjective('recon'); restoreLastSelection('reconstitution-setup-panel'); applyDefaultAdvance('recon-opt-autoadvance', 'recon-opt-delay', 'recon-delay-row');
}
$('open-reconstitution-setup')?.addEventListener('click', () => {
  applyGlobalFieldDefaultsTo('recon');
  suppressSaveLastSelection = true;
  applyDefaultAdvance('recon-opt-autoadvance', 'recon-opt-delay', 'recon-delay-row');
  showExerciseRules('recon', () => { speakObjective('recon'); $('recon-start-button')?.click(); });
});
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
  applyGlobalFieldDefaultsTo('vf');
  suppressSaveLastSelection = true;
  showExerciseRules('vf', () => { speakObjective('vf'); $('vf-start-button')?.click(); });
});
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
  applyGlobalFieldDefaultsTo('fam');
  suppressSaveLastSelection = true;
  showExerciseRules('fam', () => { speakObjective('fam'); $('fam-start-button')?.click(); });
});
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
function chronoSelectedZones() { return ['france', 'italie', 'espagne', 'royaume_uni', 'allemagne', 'europe_centrale_russie', 'europe_nord', 'amerique'].filter((z) => $(`chrono-zone-${z}`)?.checked); }
function chronoSelectedLevels() { return ['1', '2', '3'].filter((l) => $(`chrono-level-${l}`)?.checked); }
function showChronoConfig() {
  showPanel('chrono-setup'); speakObjective('chrono'); restoreLastSelection('chrono-setup-panel');
}
$('open-chrono-setup')?.addEventListener('click', () => {
  applyGlobalFieldDefaultsTo('chrono');
  suppressSaveLastSelection = true;
  showExerciseRules('chrono', () => { speakObjective('chrono'); $('chrono-start-button')?.click(); });
});
$('chrono-exit-link')?.addEventListener('click', () => { chronoTimers.forEach(clearTimeout); speechSynthesis.cancel(); showPanel('chrono-setup'); });
$('chrono-hub-link')?.addEventListener('click', () => { speechSynthesis.cancel(); showPanel('training-hub'); updateExerciseSummaries(); });
$('chrono-scores-link')?.addEventListener('click', () => { speechSynthesis.cancel(); returnToExercisePanel = 'chrono'; showPanel('account'); loadAccountPage(); });
$('chrono-setup-scores-link')?.addEventListener('click', () => { returnToExercisePanel = null; showPanel('account'); loadAccountPage(); });

let CHRONO_SESSION = [], chronoIndex = 0, chronoScore = 0, chronoAnswered = false, chronoSelectedOrder = [], chronoTimers = [], chronoFieldLabel = '';
const chronoTimer = createTimer('topbar-timer');

$('chrono-start-button')?.addEventListener('click', async () => {
  handleExtendAndRemember('chrono', 'chrono-setup-panel');
  saveLastSelection('chrono-setup-panel');
  let arts = chronoSelectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = chronoSelectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  chronoFieldLabel = buildFieldLabel(arts, centuries);
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
    // Si un ou plusieurs artistes précis ont été choisis dans « Mes choix de champ »
    // (Art/Siècle/Zone effacés automatiquement dans ce cas), on ne garde que leurs œuvres —
    // en dehors du bloc ci-dessus, qui ne s'exécute jamais quand les zones sont vides (ce
    // qui est justement le cas quand des artistes sont choisis : bug réel repéré, le filtre
    // ne s'appliquait alors jamais).
    pool = filterPoolByGlobalArtists(pool, allRows);
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
    $('chrono-ready-screen').classList.remove('hidden');
    $('chrono-quiz-grid').classList.add('hidden');
    $('bg-mosaic').classList.remove('hidden');
    populateSessionMosaic(CHRONO_SESSION.flatMap((q) => q.works.map((w) => w.image)));
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
  updateTopBanner('Chronologie', `Question ${chronoIndex + 1}/${CHRONO_SESSION.length}`, chronoFieldLabel);
  $('chrono-progress-bar').style.width = `${(chronoIndex / CHRONO_SESSION.length) * 100}%`;
  $('chrono-score-label').textContent = `${chronoScore} point${chronoScore > 1 ? 's' : ''}`;
  updateTopBannerScore(`${chronoScore} pt${chronoScore > 1 ? 's' : ''}`);
  $('chrono-correction').classList.add('hidden');
  $('chrono-correct-table').classList.add('hidden');
  $('chrono-validate-button').classList.remove('hidden');
  $('chrono-validate-button').disabled = true;
  $('chrono-cards-row').classList.remove('hidden');

  const shuffledDisplay = q.works.slice().sort(() => Math.random() - 0.5);
  q.displayOrder = shuffledDisplay;
  chronoAssigned = shuffledDisplay.map(() => undefined);
  renderChronoCards();
  famSpeak2('Quelle est l\u2019\u0153uvre la plus ancienne\u00a0? Touchez-la, puis les suivantes dans l\u2019ordre.');
}

// chronologique estimé, un numéro s'affiche directement dessus. Remplace l'ancien système à deux
// rangées (choisir puis déposer), qui coinçait sur certains smartphones.
let chronoAssigned = []; // index (dans displayOrder) -> numéro attribué (1 à 4), ou undefined
function chronoNextFreeNumber() {
  for (let n = 1; n <= 4; n++) if (!chronoAssigned.includes(n)) return n;
  return null;
}
function renderChronoCards() {
  const q = CHRONO_SESSION[chronoIndex];
  $('chrono-cards-row').innerHTML = q.displayOrder.map((work, i) => {
    const num = chronoAssigned[i];
    return `<button type="button" class="fam-image-cell chrono-source-item${num ? ' numbered' : ''}" data-index="${i}" style="order:${num || (10 + i)};position:relative;">
      ${num ? `<span class="chrono-slot-num" style="position:absolute;top:6px;left:6px;">${num}</span>` : ''}
      <img src="${escapeHtml(imageSourceSized(work.image, 250))}" alt="" />
    </button>`;
  }).join('');
  document.querySelectorAll('#chrono-cards-row .chrono-source-item').forEach((item) => {
    item.addEventListener('click', () => {
      const idx = Number(item.dataset.index);
      if (chronoAssigned[idx]) {
        chronoAssigned[idx] = undefined; // retire son numéro, libère la place
      } else {
        const n = chronoNextFreeNumber();
        if (n == null) return; // déjà 4 numéros attribués ailleurs
        chronoAssigned[idx] = n;
      }
      renderChronoCards();
      updateChronoValidateState();
    });
  });
}
function updateChronoValidateState() {
  const filled = chronoAssigned.filter(Boolean).length === 4;
  $('chrono-validate-button').disabled = !filled;
}

// Petit relais vocal indépendant du module Famille (mêmes réglages que les autres exercices).
let chronoAudioOn = true, chronoSelectedVoiceRef = null;
function famSpeak2(text, onEnd) {
  chronoAudioOn = getGlobalPrefs().audioOn;
  chronoSelectedVoiceRef = getGlobalVoice();
  if (!chronoAudioOn || !window.speechSynthesis) { if (onEnd) onEnd(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(fixSpeechPronunciation(text));
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

$('chrono-launch-first-button')?.addEventListener('click', () => {
  $('chrono-ready-screen').classList.add('hidden');
  $('chrono-quiz-grid').classList.remove('hidden');
  $('bg-mosaic').classList.add('hidden');
  document.body.classList.add('in-exercise');
  chronoTimer.start();
  chronoShowQuestion();
});
$('chrono-validate-button')?.addEventListener('click', () => {
  if (chronoAnswered) return;
  if (chronoAssigned.filter(Boolean).length < 4) return;
  chronoAnswered = true;
  const q = CHRONO_SESSION[chronoIndex];
  $('chrono-validate-button').classList.add('hidden');

  // Reconstitue l'ordre choisi par le joueur à partir des numéros posés sur chaque carte.
  const orderedIndexes = [1, 2, 3, 4].map((n) => chronoAssigned.indexOf(n));
  const playerOrder = orderedIndexes.map((idx) => q.displayOrder[idx]);
  const correctOrder = q.chronological;
  const rightFlags = playerOrder.map((w, i) => w === correctOrder[i]);
  const isCorrect = rightFlags.every(Boolean);
  const pointEarned = isCorrect ? 1 : 0;
  chronoScore = Math.round((chronoScore + pointEarned) * 10) / 10;
  $('chrono-score-label').textContent = `${chronoScore} point${chronoScore > 1 ? 's' : ''}`;
  updateTopBannerScore(`${chronoScore} pt${chronoScore > 1 ? 's' : ''}`);

  $('chrono-verdict').textContent = isCorrect ? 'Exact' : 'À réviser';
  $('chrono-verdict').style.color = isCorrect ? 'var(--ok)' : 'var(--wrong)';

  // La rangée reprend l'ordre choisi par le joueur (déjà rangé visuellement), encadrée en
  // rouge sur toute carte où l'ordre était faux, avec la référence complète sous chaque image.
  $('chrono-cards-row').innerHTML = playerOrder.map((work, i) => {
    const meta = [escapeHtml(work.date), locationWithFlag(work)].filter(Boolean).join(' — ');
    return `<div class="fam-image-cell ${rightFlags[i] ? 'right' : 'wrong'}" style="position:relative;margin-bottom:58px;">
      <span class="chrono-slot-num">${i + 1}</span><img src="${escapeHtml(imageSourceSized(work.image, 250))}" alt="" />
      <span class="fam-result-caption" style="position:absolute;bottom:-58px;left:0;right:0;">
        <strong>${formatArtistDisplayName(work)}</strong><br><em>« ${escapeHtml(work.title)} »</em><br>${meta}
      </span>
    </div>`;
  }).join('');

  // S'il y a eu une erreur, un second tableau montre le bon ordre (images + références).
  if (!isCorrect) {
    $('chrono-correct-table').classList.remove('hidden');
    $('chrono-correct-table').innerHTML = `<p class="modal-subheading" style="margin:70px 0 8px;">Le bon ordre était :</p>
      <div class="fam-result-grid">${correctOrder.map((work) => {
        const meta = [escapeHtml(work.date), locationWithFlag(work)].filter(Boolean).join(' — ');
        return `<div class="fam-result-item">
          <img src="${escapeHtml(imageSourceSized(work.image, 250))}" alt="" />
          <span class="fam-result-caption"><strong>${formatArtistDisplayName(work)}</strong><br><em>« ${escapeHtml(work.title)} »</em><br>${meta}</span>
        </div>`;
      }).join('')}</div>`;
  }

  const ordinals = ['la première', 'la deuxième', 'la troisième', 'la quatrième'];
  let spokenText;
  if (isCorrect) {
    const list = correctOrder.map((w, i) => `${ordinals[i]}, ${w.artist}, ${w.title}, en ${chronoYearOf(w)}`).join('. ');
    spokenText = `Exact. Voici l'ordre chronologique. ${list}.`;
  } else {
    const correctIndices = rightFlags.map((ok, i) => (ok ? i : -1)).filter((i) => i !== -1);
    const wrongIndices = rightFlags.map((ok, i) => (!ok ? i : -1)).filter((i) => i !== -1);
    const wrongList = wrongIndices.map((i) => `à ${ordinals[i]} position, ${correctOrder[i].artist}, ${correctOrder[i].title}, en ${chronoYearOf(correctOrder[i])}`).join('. ');
    if (!correctIndices.length) {
      spokenText = `À réviser. Voici l'ordre chronologique. ${wrongList}.`;
    } else {
      const goodList = correctIndices.map((i) => ordinals[i]).join(', ');
      spokenText = `Vous avez bien placé ${goodList}. Les autres œuvres se répartissent ainsi\u00a0: ${wrongList}.`;
    }
  }
  famSpeak2(spokenText);

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
    showExerciseResultsModal('Chronologie', chronoScore, CHRONO_SESSION.length, 'training-hub');
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
function famSelectedZones() { return ['france', 'italie', 'espagne', 'royaume_uni', 'allemagne', 'europe_centrale_russie', 'europe_nord', 'amerique'].filter((z) => $(`fam-zone-${z}`)?.checked); }
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

let FAM_SESSION = [], famIndex = 0, famScore = 0, famAnswered = false, famAudioOn = true, famSelectedVoiceRef = null, famSelectedImages = [], famStep = 1, famTimers = [], famPickedLabel = null, famFieldLabel = '';
const famTimer = createTimer('topbar-timer');
function famSpeak(text, onEnd) {
  if (!famAudioOn || !window.speechSynthesis) { if (onEnd) onEnd(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(fixSpeechPronunciation(text));
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
  // Famille a besoin d'œuvres « intruses » d'autres artistes pour que le jeu ait un sens —
  // impossible à construire avec un seul artiste choisi (tout serait alors « famille »).
  const globalArtistsFam = (readGlobalArtistDefaults().artists || []);
  if (globalArtistsFam.length === 1) {
    $('fam-setup-feedback').classList.remove('hidden');
    $('fam-setup-feedback').textContent = "Famille a besoin d'au moins 2 artistes choisis (pour proposer des œuvres intruses d'un autre artiste) — ajoute-en un second dans Mes choix de champ, ou choisis un art/siècle/zone à la place.";
    return;
  }
  let arts = famSelectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = famSelectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  famFieldLabel = buildFieldLabel(arts, centuries);
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
    // Si un ou plusieurs artistes précis ont été choisis dans « Mes choix de champ »
    // (Art/Siècle/Zone effacés automatiquement dans ce cas), on ne garde que leurs œuvres —
    // en dehors du bloc ci-dessus, qui ne s'exécute jamais quand les zones sont vides (ce
    // qui est justement le cas quand des artistes sont choisis : bug réel repéré, le filtre
    // ne s'appliquait alors jamais).
    pool = filterPoolByGlobalArtists(pool, allRows);
    famAudioOn = getGlobalPrefs().audioOn;
    famSelectedVoiceRef = getGlobalVoice();
    const countChoice = document.querySelector('input[name="fam-count"]:checked').value;
    const count = countChoice === 'max' ? 40 : Number(countChoice);
    let imgCountChoice = Number(document.querySelector('input[name="fam-images"]:checked').value);
    // Avec exactement 2 artistes choisis, le partage famille/intrus est toujours moitié-moitié
    // (la moitié des images vient forcément de l'autre artiste, faute d'un 3e) — sur une grille de
    // 4 images, ça donne 2 paires très reconnaissables d'un coup d'œil. On passe alors à 6 images
    // pour que ce soit un peu moins immédiat, même si le partage reste 50/50 dans ce cas précis.
    const globalArtistsCount = (readGlobalArtistDefaults().artists || []).length;
    if (globalArtistsCount === 2 && imgCountChoice < 6) imgCountChoice = 6;
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
    $('fam-ready-screen').classList.remove('hidden');
    $('fam-quiz-grid').classList.add('hidden');
    $('bg-mosaic').classList.remove('hidden');
    populateSessionMosaic(FAM_SESSION.flatMap((q) => q.images.map((w) => w.image)));
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
  famSelectedImages = [];
  // Bref délai de sécurité avant que la sélection ne devienne possible (famStep !== 0 bloque les
  // clics) : même correction que pour Intrus et Reconstitution, contre un tap trop rapide juste
  // après le tour précédent qui pouvait atterrir par accident sur une image du tour suivant.
  famStep = 1;
  famTimers.push(setTimeout(() => { famStep = 0; }, 400));
  famPickedLabel = null;
  const q = FAM_SESSION[famIndex];
  // Précharge les 6-8 images de la question suivante, pendant que le joueur répond encore.
  FAM_SESSION[famIndex + 1]?.images?.forEach((w) => preloadImage(w.image, 250));
  $('fam-progress-label').textContent = `Question ${famIndex + 1} / ${FAM_SESSION.length}`;
  $('fam-score-label').textContent = `${famScore} point${famScore > 1 ? 's' : ''}`;
  updateTopBanner('Famille', `Question ${famIndex + 1}/${FAM_SESSION.length}`, famFieldLabel);
  updateTopBannerScore(`${famScore} pt${famScore > 1 ? 's' : ''}`);
  $('fam-progress-bar').style.width = `${(famIndex / FAM_SESSION.length) * 100}%`;
  $('fam-correction').classList.add('hidden');
  $('fam-step0').classList.remove('hidden');
  $('fam-validate-selection-button').disabled = false;

  $('fam-image-grid').className = `fam-image-grid${q.imgCount === 6 ? ' fam-count-6' : ''}`;
  // Même échelle relative compressée que pour Intrus : les tailles à l'écran reflètent un peu les
  // vraies différences de taille entre les œuvres, sans rendre les plus petites illisibles.
  const famSizes = relativeImageSizes(q.images);
  $('fam-image-grid').innerHTML = q.images.map((work, i) =>
    `<button type="button" class="fam-image-cell" data-index="${i}"><img src="${escapeHtml(imageSourceSized(work.image, 250))}" alt="" style="max-width:${famSizes[i]}px;max-height:${famSizes[i]}px;" /></button>`
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

$('fam-launch-first-button')?.addEventListener('click', () => {
  $('fam-ready-screen').classList.add('hidden');
  $('fam-quiz-grid').classList.remove('hidden');
  $('bg-mosaic').classList.add('hidden');
  document.body.classList.add('in-exercise');
  famTimer.start();
  famShowQuestion();
});
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
  updateTopBannerScore(`${famScore} pt${famScore > 1 ? 's' : ''}`);

  $('fam-verdict').textContent = imagesCorrect ? 'Exact' : 'À réviser';
  $('fam-verdict').style.color = imagesCorrect ? 'var(--ok)' : 'var(--wrong)';

  const yearOf = (w) => { const m = String(w.date || '').match(/\b(1[3-9]|20)\d{2}\b/); return m ? Number(m[0]) : 9999; };
  const chronological = q.family.slice().sort((a, b) => yearOf(a) - yearOf(b));
  const wrongSelected = famSelectedImages.map((i) => q.images[i]).filter((w) => !q.family.includes(w));
  const foundFamily = chronological.filter((w) => q.family.indexOf(w) >= 0 && famSelectedImages.includes(q.images.indexOf(w)));
  const missedFamily = chronological.filter((w) => !foundFamily.includes(w));

  const captionOf = (work) => {
    const meta = [escapeHtml(work.date), locationWithFlag(work)].filter(Boolean).join(' — ');
    return `<strong>${formatArtistDisplayName(work)}</strong><br><em>« ${escapeHtml(work.title)} »</em><br>${meta}`;
  };
  const cellHtml = (work, revealed) => `<div class="fam-result-item${revealed ? '' : ' fam-result-pending'}">
      ${revealed ? `<img src="${escapeHtml(imageSourceSized(work.image, 250))}" alt="" /><span class="fam-result-caption">${captionOf(work)}</span>` : ''}
    </div>`;

  if (!wrongSelected.length && !missedFamily.length) {
    $('fam-image-grid').className = 'fam-result-grid';
    $('fam-image-grid').innerHTML = chronological.map((w) => cellHtml(w, true)).join('');
    const ordinals = ['La première', 'La deuxième', 'La troisième', 'La quatrième'];
    const titleList = chronological.map((w, i) => `${ordinals[i]}, ${w.title}`).join('. ');
    currentSpeechNationality = chronological[0]?.nationality || '';
    // La voix dit le surnom quand il existe (ex. « El Greco »), pas le nom complet parfois moins
    // reconnaissable (« Domenikos Theotokopoulos ») — cohérent avec ce qui est écrit à l'écran.
    const spokenArtistName = chronological[0]?.surnomFr || q.artist;
    famSpeak(`Ces ${famNumberWord(chronological.length)} œuvres sont bien de ${spokenArtistName}. ${titleList}.`);
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
      const intro = wrongSelected.length > 1 ? `Tu as fait ${famNumberWord(wrongSelected.length)} erreurs.` : 'Tu as fait une erreur.';
      const details = wrongSelected.map((w) => `Ce tableau était de ${w.surnomFr || w.artist}, intitulé ${w.title}.`).join(' ');
      currentSpeechNationality = wrongSelected[0]?.nationality || '';
      famSpeak(`${intro} ${details}`, next);
    }
    function announceFound(next) {
      if (!foundFamily.length) { next(); return; }
      foundFamily.forEach(revealTop);
      const spokenArtistName = foundFamily[0]?.surnomFr || q.artist;
      famSpeak(`Tu avais bien repéré ${famNumberWord(foundFamily.length)} œuvre${foundFamily.length > 1 ? 's' : ''} de ${spokenArtistName}.`, next);
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
    showExerciseResultsModal('Famille', famScore, FAM_SESSION.length, 'training-hub');
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
function vfSelectedZones() { return ['france', 'italie', 'espagne', 'royaume_uni', 'allemagne', 'europe_centrale_russie', 'europe_nord', 'amerique'].filter((z) => $(`vf-zone-${z}`)?.checked); }
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
  if (showFullCorrection) return all;
  const checkboxMap = { artist: 'vf-field-artist', title: 'vf-field-title', date: 'vf-field-date', materials: 'vf-field-materiaux', dimensions: 'vf-field-dimensions', location: 'vf-field-location' };
  const filtered = all.filter((f) => $(checkboxMap[f.key])?.checked);
  return filtered.length ? filtered : all;
}
function vfFieldValue(row, key) {
  if (key === 'dimensions') return formatDimensionsPlainText(row) || [row.hauteur, row.longueur].filter(Boolean).join(' × ');
  if (key === 'materials') return row.materialsPhrase || row.materials || '';
  return row[key] || '';
}

let VF_SESSION = [], vfIndex = 0, vfScore = 0, vfAnswered = false, vfAudioOn = true, vfSelectedVoiceRef = null, vfTimers = [], vfFieldLabel = '';
const vfTimer = createTimer('topbar-timer');
function vfSpeak(text, onEnd) {
  if (!vfAudioOn || !window.speechSynthesis) { if (onEnd) onEnd(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(fixSpeechPronunciation(text));
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
  // Vrai/Faux a besoin de proposer une fausse attribution crédible — impossible à construire
  // avec un seul artiste choisi (il n'y aurait personne d'autre à qui l'attribuer par erreur).
  const globalArtists = (readGlobalArtistDefaults().artists || []);
  if (globalArtists.length === 1) {
    $('vf-setup-feedback').classList.remove('hidden');
    $('vf-setup-feedback').textContent = "Vrai/Faux a besoin d'au moins 2 artistes choisis (pour proposer une fausse attribution) — ajoute-en un second dans Mes choix de champ, ou choisis un art/siècle/zone à la place.";
    return;
  }
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
    // Si un ou plusieurs artistes précis ont été choisis dans « Mes choix de champ »
    // (Art/Siècle/Zone effacés automatiquement dans ce cas), on ne garde que leurs œuvres —
    // en dehors du bloc ci-dessus, qui ne s'exécute jamais quand les zones sont vides (ce
    // qui est justement le cas quand des artistes sont choisis : bug réel repéré, le filtre
    // ne s'appliquait alors jamais).
    pool = filterPoolByGlobalArtists(pool, allRows);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const countChoice = document.querySelector('input[name="vf-count"]:checked').value;
    const count = countChoice === 'max' ? pool.length : Math.min(Number(countChoice), pool.length);
    vfAudioOn = getGlobalPrefs().audioOn;
    vfSelectedVoiceRef = getGlobalVoice();
    vfFieldLabel = buildFieldLabel(arts, centuries);
    const activeFields = vfActiveFields();
    if (!activeFields.length) { feedback.textContent = 'Choisissez au moins une rubrique.'; return; }
    VF_SESSION = pool.slice(0, count).map((correct) => {
      const hasError = Math.random() < 0.5;
      let errorFields = [];
      const displayed = {};
      const displayedSource = {}; // quelle œuvre a fourni chaque valeur affichée (utile pour la voix des dimensions)
      activeFields.forEach((f) => { displayed[f.key] = vfFieldValue(correct, f.key) || '—'; displayedSource[f.key] = correct; });
      if (hasError) {
        const nbErrors = activeFields.length > 1 && Math.random() < 0.5 ? 2 : 1; // jamais plus de deux erreurs
        const shuffledFields = activeFields.slice().sort(() => Math.random() - 0.5);
        errorFields = shuffledFields.slice(0, nbErrors).map((f) => f.key);
        // La correction doit toujours descendre dans l'ordre des rubriques (Auteur d'abord s'il
        // est concerné, puis Titre, Date, etc.) : on retrie après le tirage au sort aléatoire.
        errorFields.sort((a, b) => activeFields.findIndex((f) => f.key === a) - activeFields.findIndex((f) => f.key === b));
        errorFields.forEach((key) => {
          const others = pool.filter((r) => r !== correct && vfFieldValue(r, key));
          if (others.length) {
            const swapped = others[Math.floor(Math.random() * others.length)];
            displayed[key] = vfFieldValue(swapped, key);
            displayedSource[key] = swapped;
          }
        });
      }
      return { correct, hasError, errorFields, displayed, displayedSource, activeFields };
    });
    vfIndex = 0; vfScore = 0;
    showPanel('vraifaux');
    $('vf-ready-screen').classList.remove('hidden');
    $('vf-quiz-grid').classList.add('hidden');
    $('bg-mosaic').classList.remove('hidden');
    populateSessionMosaic(VF_SESSION.map((q) => q.correct.image));
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
  updateTopBanner('Vrai/Faux', `Question ${vfIndex + 1}/${VF_SESSION.length}`, vfFieldLabel);
  $('vf-progress-bar').style.width = `${(vfIndex / VF_SESSION.length) * 100}%`;
  $('vf-score-label').textContent = `${vfScore} point${Math.abs(vfScore) >= 2 ? 's' : ''}`;
  updateTopBannerScore(`${vfScore} pt${Math.abs(vfScore) >= 2 ? 's' : ''}`);
  $('vf-correction').classList.add('hidden');
  $('vf-validate-button').classList.remove('hidden');
  $('vf-validate-button').disabled = false;
  $('vf-stage-img').src = imageSourceSized(q.correct.image, 700);
  preloadImage(VF_SESSION[vfIndex + 1]?.correct?.image, 700);

  // Chaque rubrique a son propre bouton Vrai/Faux, réglé sur Vrai par défaut.
  $('vf-field-rows').innerHTML = q.activeFields.map((f) => {
    const isTitle = f.key === 'title';
    const isDimensions = f.key === 'dimensions';
    const shown = isTitle ? `« ${q.displayed[f.key]} »` : q.displayed[f.key];
    const shownHtml = isTitle ? `<em>${escapeHtml(shown)}</em>` : isDimensions ? (formatDimensionsDisplay(q.displayedSource[f.key]) || escapeHtml(shown)) : escapeHtml(shown);
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

  const spokenText = q.activeFields.map((f) => {
    if (f.key === 'title') return `« ${q.displayed[f.key]} »`;
    if (f.key === 'dimensions') return spokenDimensionsPhrase(q.displayedSource[f.key]) || q.displayed[f.key];
    return q.displayed[f.key];
  }).join(' — ');
  vfSpeak(spokenText);
}

// « Démarrer le jeu » : geste explicite avant d'afficher la toute première œuvre — le jeu ne
// démarre jamais tout seul juste après avoir fermé la fenêtre de règles ou la configuration.
$('vf-launch-first-button')?.addEventListener('click', () => {
  $('vf-ready-screen').classList.add('hidden');
  $('vf-quiz-grid').classList.remove('hidden');
  $('bg-mosaic').classList.add('hidden');
  document.body.classList.add('in-exercise');
  vfTimer.start();
  vfShowQuestion();
});
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
  updateTopBannerScore(`${vfScore} pt${Math.abs(vfScore) >= 2 ? 's' : ''}`);

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
    const shownCorrect = key === 'title' ? `<em>« ${escapeHtml(correctVal)} »</em>` : key === 'dimensions' ? (formatDimensionsDisplay(q.correct) || escapeHtml(correctVal)) : escapeHtml(correctVal);
    const el = $(`vf-value-${key}`);
    if (el) el.classList.add('vf-was-wrong');
    vfTimers.push(setTimeout(() => {
      if (el) {
        el.innerHTML = shownCorrect;
        el.classList.remove('vf-was-wrong');
        el.classList.add('vf-updated');
      }
      vfSpeak(naturalPhrase(key, correctVal), () => speakNextCorrection(i + 1));
    }, 2200));
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
      }, 2200));
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
    showExerciseResultsModal('Vrai/Faux', vfScore, VF_SESSION.length, 'training-hub');
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
function reconSelectedZones() { return ['france', 'italie', 'espagne', 'royaume_uni', 'allemagne', 'europe_centrale_russie', 'europe_nord', 'amerique'].filter((z) => $(`recon-zone-${z}`)?.checked); }
function reconSelectedLevels() { return ['1', '2', '3'].filter((lvl) => $(`recon-level-${lvl}`)?.checked); }

let RECON_SESSION = [], reconIndex = 0, reconCorrectCount = 0, reconAnswered = false, reconAudioOn = true, reconSelectedVoice = null, reconAutoAdvance = false, reconAutoAdvanceDelay = 5000, reconExtraFields = [], reconTimers = [], reconFieldLabel = '';
const reconTimer = createTimer('topbar-timer');
$('recon-opt-autoadvance')?.addEventListener('change', () => { $('recon-delay-row').style.display = $('recon-opt-autoadvance').checked ? 'flex' : 'none'; });
function reconSpeak(text) {
  if (!reconAudioOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(fixSpeechPronunciation(text));
  u.lang = 'fr-FR'; u.rate = 0.85;
  if (reconSelectedVoice) u.voice = reconSelectedVoice;
  speechSynthesis.speak(u);
}

$('recon-start-button')?.addEventListener('click', async () => {
  handleExtendAndRemember('recon', 'reconstitution-setup-panel');
  saveLastSelection('reconstitution-setup-panel');
  let arts = reconSelectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = reconSelectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  reconFieldLabel = buildFieldLabel(arts, centuries);
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
    // Si un ou plusieurs artistes précis ont été choisis dans « Mes choix de champ »
    // (Art/Siècle/Zone effacés automatiquement dans ce cas), on ne garde que leurs œuvres —
    // en dehors du bloc ci-dessus, qui ne s'exécute jamais quand les zones sont vides (ce
    // qui est justement le cas quand des artistes sont choisis : bug réel repéré, le filtre
    // ne s'appliquait alors jamais).
    pool = filterPoolByGlobalArtists(pool, allRows);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const countChoice = document.querySelector('input[name="recon-count"]:checked').value;
    const count = countChoice === 'max' ? pool.length : Math.min(Number(countChoice), pool.length);
    reconAudioOn = getGlobalPrefs().audioOn;
    reconSelectedVoice = getGlobalVoice();
    reconAutoAdvance = $('recon-opt-autoadvance')?.checked || false;
    reconAutoAdvanceDelay = Number($('recon-opt-delay')?.value || 5000);
    reconExtraFields = ['date', 'materiaux', 'dimensions', 'location'].filter((k) => $(`recon-field-${k}`)?.checked);
    // Même correction qu'Intrus : un choix global d'artiste (sans case ici) ne doit pas être
    // traité comme « rien choisi », sinon on retombe à tort sur toutes les rubriques.
    if (!reconExtraFields.length && !readGlobalRubriqueDefaults().rubriques?.length) {
      reconExtraFields = ['date', 'materiaux', 'dimensions', 'location'];
    }
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
    $('recon-ready-screen').classList.remove('hidden');
    $('recon-quiz-grid').classList.add('hidden');
    $('bg-mosaic').classList.remove('hidden');
    populateSessionMosaic(RECON_SESSION.map((q) => q.correct.image));
  } catch (error) {
    feedback.textContent = `Erreur : ${error.message}`;
  }
});

$('recon-launch-first-button')?.addEventListener('click', () => {
  $('recon-ready-screen').classList.add('hidden');
  $('recon-quiz-grid').classList.remove('hidden');
  $('bg-mosaic').classList.add('hidden');
  document.body.classList.add('in-exercise');
  reconTimer.start();
  reconShowQuestion();
});
function reconShowQuestion() {
  speechSynthesis.cancel();
  reconTimers.forEach(clearTimeout); reconTimers = [];
  // Même correction que pour Intrus : bref délai de sécurité avant que les choix deviennent
  // cliquables, pour éviter qu'un tap trop rapide juste après « Suivant » ne réponde par accident.
  reconAnswered = true;
  reconTimers.push(setTimeout(() => { reconAnswered = false; }, 400));
  const q = RECON_SESSION[reconIndex];
  preloadImage(RECON_SESSION[reconIndex + 1]?.correct?.image, 500);
  $('recon-progress-label').textContent = `Question ${reconIndex + 1} / ${RECON_SESSION.length}`;
  updateTopBanner('Reconstitution', `Question ${reconIndex + 1}/${RECON_SESSION.length}`, reconFieldLabel);
  $('recon-score-label').textContent = `${reconCorrectCount} / ${reconIndex} réponse${reconCorrectCount > 1 ? 's' : ''} correcte${reconCorrectCount > 1 ? 's' : ''}`;
  updateTopBannerScore(`${reconCorrectCount}/${reconIndex}`);
  $('recon-progress-bar').style.width = `${(reconIndex / RECON_SESSION.length) * 100}%`;
  $('recon-correction').classList.add('hidden');
  $('recon-choices').classList.remove('hidden');

  const src = escapeHtml(imageSourceSized(q.correct.image, 1200));
  $('recon-prompt-card').innerHTML = `<div class="recon-detail-crop" style="background-image:url('${src}');background-position:${q.cropX}% ${q.cropY}%;"></div>`;
  $('recon-choices').innerHTML = `<div class="intrus-choice-list">${q.choices.map((c, i) =>
    `<button type="button" class="intrus-choice-btn" data-index="${i}"><strong>${escapeHtml(c.artist)}</strong><br><em>« ${escapeHtml(c.title || c.date || 'œuvre non titrée')} »</em></button>`
  ).join('')}</div>`;
  $('recon-choices').querySelectorAll('.intrus-choice-btn').forEach((btn) => {
    btn.addEventListener('click', () => reconAnswer(Number(btn.dataset.index)));
  });
}

// Même principe que pour Intrus : fonction isolée, sans effet de bord, pour rafraîchir la
// correction affichée dès qu'on active/désactive la correction complète.
function reconRefreshCorrectionDetails() {
  const q = RECON_SESSION[reconIndex];
  if (!q) return;
  const dims = formatDimensionsDisplay(q.correct);
  const detailsParts = [];
  detailsParts.push(`<span class="correction-label">Auteur</span><span class="correction-value">${formatArtistDisplayName(q.correct)}</span>`);
  detailsParts.push(`<span class="correction-label">Titre de l'œuvre</span><span class="correction-value"><em>«\u00a0${escapeHtml(q.correct.title)}\u00a0»</em></span>`);
  if (showFullCorrection || reconExtraFields.includes('date')) detailsParts.push(`<span class="correction-label">Date</span><span class="correction-value">${escapeHtml(q.correct.date || '—')}</span>`);
  if ((showFullCorrection || reconExtraFields.includes('materiaux')) && q.correct.materials) detailsParts.push(`<span class="correction-label">Matériau</span><span class="correction-value">${escapeHtml(q.correct.materialsPhrase || q.correct.materials)}</span>`);
  if ((showFullCorrection || reconExtraFields.includes('dimensions')) && dims) detailsParts.push(`<span class="correction-label">Dimensions</span><span class="correction-value">${dims}</span>`);
  if (showFullCorrection || reconExtraFields.includes('location')) detailsParts.push(`<span class="correction-label">Lieu</span><span class="correction-value">${locationWithFlag(q.correct) || '—'}</span>`);
  $('recon-correction-details').innerHTML = detailsParts.join('');
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
  $('recon-prompt-card').innerHTML = `<img class="recon-full-image" src="${escapeHtml(imageSourceSized(q.correct.image, 700))}" alt="" />`;

  reconSpeak(spokenFullReference(q.correct, showFullCorrection ? null : reconExtraFields));
  reconRefreshCorrectionDetails();
  $('recon-correction').classList.remove('hidden');
  $('recon-score-label').textContent = `${reconCorrectCount} / ${reconIndex + 1} réponse${reconCorrectCount > 1 ? 's' : ''} correcte${reconCorrectCount > 1 ? 's' : ''}`;
  updateTopBannerScore(`${reconCorrectCount}/${reconIndex + 1}`);
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
    showExerciseResultsModal('Reconstitution', reconCorrectCount, RECON_SESSION.length, 'training-hub');
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
$('other-works-back-button')?.addEventListener('click', () => {
  const prevIdx = currentArtistWorksIndex - 1;
  if (prevIdx >= 0) openArtistWorksPage(prevIdx);
});
$('other-works-next-button')?.addEventListener('click', () => {
  const nextIdx = currentArtistWorksIndex + 1;
  if (nextIdx < artistListSortedRows.length) openArtistWorksPage(nextIdx);
});

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
// Images fixes de la mosaïque décorative (page d'accueil ET salle d'attente de chaque exercice —
// toujours la même mosaïque, hébergée localement plutôt que sur Wikimedia). Chargement immédiat,
// sans dépendre d'un service externe ni de la vitesse de connexion à cet instant précis — c'est ce
// qui causait le « rideau qui se déroule lentement » et la lenteur des boutons du tableau
// d'accueil sur smartphone.
const BG_MOSAIC_FILES = [
  'temeraire.jpg', 'neuvieme-vague.jpg', 'gulf-stream.jpg', 'la-nuit.jpg', 'rocky-mountains.jpg',
  'roses-heliogabale.jpg', 'gismonda.jpg', 'le-ballon.jpg', 'canari-mort.jpg', 'diderot.jpg',
  'marchande-crevettes.jpg', 'le-climax.jpg', 'david.jpg', 'venus-milo.jpg', 'naissance-venus.jpg',
];
function initBackgroundMosaic() {
  const container = $('bg-mosaic');
  if (!container) return;
  container.innerHTML = BG_MOSAIC_FILES.map((filename) => {
    const url = `assets/mosaique/${filename}`;
    // Filet de sécurité minimal : si un fichier venait à manquer, la case bascule sur le David
    // (toujours présent) plutôt que de rester vide.
    const fallback = 'assets/mosaique/david.jpg';
    return `<div class="bg-tile"><img src="${url}" alt="" loading="lazy" draggable="false" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='${fallback}';}" /></div>`;
  }).join('');
  wireBgMosaicTiles();
}
// La « salle d'attente » de chaque exercice utilise maintenant exactement la même mosaïque fixe
// que la page d'accueil (plus rapide, sans dépendre de Wikimedia) plutôt que les œuvres réelles de
// la session — purement décorative, elle n'a jamais eu besoin de montrer le contenu exact à venir.
function populateSessionMosaic() {
  initBackgroundMosaic();
}
function wireBgMosaicTiles() {
  const container = $('bg-mosaic');
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
$('open-quiz-setup')?.addEventListener('click', () => {
  applyGlobalDefaultsToQuiz();
  suppressSaveLastSelection = true;
  showExerciseRules('quiz', () => { speakObjective('quiz'); $('launch-quiz-button')?.click(); });
});
$('load-saved-choice-button')?.addEventListener('click', () => {
  const raw = localStorage.getItem('savedQuizConfig');
  if (!raw) return;
  const cfg = JSON.parse(raw);
  ['art-peinture', 'art-sculpture', 'century-14e', 'century-15e', 'century-16e', 'century-17e', 'century-18e', 'century-19e', 'century-20e',
   'zone-france', 'zone-italie', 'zone-espagne', 'zone-royaume_uni', 'zone-allemagne', 'zone-europe_centrale_russie', 'zone-europe_nord', 'zone-amerique', 'level-1', 'level-2', 'level-3'].forEach((id) => { const el = $(id); if (el) el.checked = false; });
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
  quiz: { name: 'Quiz final', open: 'open-quiz-setup', start: 'launch-quiz-button', panel: 'quiz-setup-panel' },
};
// Résumé abrégé (ex. « Peinture17 ») de la sélection mémorisée d'un exercice, affiché
// directement sur son bouton dans le menu — évite d'avoir à rouvrir la configuration pour
// se rappeler ce qui était choisi la dernière fois. Le choix général (depuis « Mon compte »)
// est prioritaire sur un choix propre à l'exercice, et affiché différemment (icône 🌐).
function readGlobalFieldDefaults() {
  try { return JSON.parse(localStorage.getItem('globalFieldDefaults') || '{}'); } catch (e) { return {}; }
}
function readGlobalArtistDefaults() {
  try { return JSON.parse(localStorage.getItem('globalArtistDefaults') || '{}'); } catch (e) { return {}; }
}
// Quand un ou plusieurs artistes précis sont choisis dans « Mes choix de champ » (plutôt qu'un
// choix d'art/siècle/zone), le réservoir de questions doit se limiter à leurs œuvres — appliqué
// après la récupération habituelle par art/siècle, qui aura alors tout ramené faute de filtre.
// Filet de sécurité supplémentaire : si le niveau choisi ailleurs élimine tout pour ces artistes
// précis (ex. aucune œuvre de niveau 3 chez Monet/Gauguin/Manet réunis), on se rabat sur
// l'ensemble de leurs œuvres tous niveaux confondus plutôt que de ne rien pouvoir lancer — bug
// réel repéré : le jeu refusait de démarrer sans que la cause (niveau incompatible) soit claire.
function filterPoolByGlobalArtists(pool, fallbackPool) {
  const artists = (readGlobalArtistDefaults().artists || []).map((n) => keyName(n)).filter(Boolean);
  if (!artists.length) return pool;
  const matches = (r) => artists.some((a) => keyName(r.artist).includes(a) || a.includes(keyName(r.artist)));
  const filtered = pool.filter(matches);
  if (filtered.length) return filtered;
  if (fallbackPool) {
    const widened = fallbackPool.filter(matches);
    if (widened.length) return widened;
  }
  return filtered;
}
function readGlobalRubriqueDefaults() {
  try { return JSON.parse(localStorage.getItem('globalRubriqueDefaults') || '{}'); } catch (e) { return {}; }
}
function buildExerciseSummary(prefix) {
  // Même priorité qu'au démarrage : un choix propre à cet exercice l'emporte sur le choix
  // général — sinon le badge du bouton ne refléterait jamais ce qui va réellement se lancer.
  // Le quiz n'a pas de préfixe sur ses identifiants (art-peinture, pas quiz-art-peinture).
  const idPrefix = prefix === 'quiz' ? '' : `${prefix}-`;
  let state;
  try { state = JSON.parse(localStorage.getItem(`lastSelection_${EXERCISE_INFO[prefix].panel}`) || '{}'); } catch (e) { state = {}; }
  const ownArts = Object.keys(state).filter((k) => k.startsWith(`${idPrefix}art-`) && state[k]).map((k) => k.replace(`${idPrefix}art-`, ''));
  const ownCenturies = Object.keys(state).filter((k) => k.startsWith(`${idPrefix}century-`) && state[k]).map((k) => k.replace(`${idPrefix}century-`, '').replace('e', ''));
  if (ownArts.length || ownCenturies.length) {
    const artLabel = ownArts.map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join('+');
    return `▶ ${artLabel}${ownCenturies.join('+')}`;
  }
  const gf = readGlobalFieldDefaults();
  const ga = readGlobalArtistDefaults();
  const gr = readGlobalRubriqueDefaults();
  const hasGlobalField = gf.remember && (gf.arts?.length || gf.centuries?.length || gf.zones?.length);
  const hasGlobalArtists = ga.remember && ga.artists?.length;
  const hasGlobalRubrique = gr.remember && (gr.rubriques?.length || gr.levels?.length);
  if (hasGlobalField || hasGlobalArtists || hasGlobalRubrique) {
    // Le choix d'artiste(s) affine le champ plutôt que de le remplacer — les deux s'affichent
    // ensemble s'ils sont actifs tous les deux, pour qu'on voie bien qu'ils se combinent.
    const artLabel = (gf.arts || []).map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join('+');
    const fieldPart = hasGlobalField ? `${artLabel}${(gf.centuries || []).join('+')}` : '';
    let artistPart = '';
    if (hasGlobalArtists) {
      const shown = ga.artists.slice(0, 2).join(', ');
      const extra = ga.artists.length > 2 ? ` +${ga.artists.length - 2}` : '';
      artistPart = `${shown}${extra}`;
    }
    const levelPart = gr.levels?.length ? ' N' + gr.levels.join('+') : '';
    return `🌐 ${[fieldPart, artistPart].filter(Boolean).join(' · ')}${levelPart}`;
  }
  return '';
}
function updateExerciseSummaries() {
  Object.keys(EXERCISE_INFO).forEach((prefix) => {
    const el = $(`${prefix}-hub-summary`);
    if (el) el.textContent = buildExerciseSummary(prefix);
  });
  applyGamesFilterToHub();
  renderSavedGuidedConfigsList();
}
// Configurations enregistrées depuis le parcours guidé : affichées ici, là où le joueur revient
// naturellement, pour répondre simplement à « où est-ce que je les retrouve ? ».
function loadSavedGuidedConfig(name, savedConfigs) {
  const cfg = savedConfigs[name];
  if (!cfg) return;
  localStorage.setItem('globalFieldDefaults', JSON.stringify(cfg.field || {}));
  localStorage.setItem('globalArtistDefaults', JSON.stringify(cfg.artists || {}));
  localStorage.setItem('globalRubriqueDefaults', JSON.stringify(cfg.rubrique || {}));
  if (cfg.allGames) localStorage.removeItem('globalGamesDefaults');
  else localStorage.setItem('globalGamesDefaults', JSON.stringify({ games: cfg.games || [], remember: true }));
  loadedGuidedConfigName = name;
  guidedModeActive = true;
  localStorage.setItem('guidedModeActive', 'true');
  showPanel('training-hub');
  updateExerciseSummaries();
  applyFieldLinkedAmbiance();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
// Petit résumé texte d'une configuration enregistrée, affiché sous son bouton — pour se rappeler
// ce qu'elle contient sans avoir à la relancer pour le savoir.
function summarizeSavedConfig(cfg) {
  const gf = cfg.field || {};
  const ga = cfg.artists || {};
  const gr = cfg.rubrique || {};
  const artLabel = { peinture: 'Peinture', sculpture: 'Sculpture' };
  const parts = [];
  if (gf.arts?.length) parts.push(gf.arts.map((a) => artLabel[a] || a).join('+'));
  if (gf.centuries?.length) parts.push(gf.centuries.join('+'));
  if (gf.zones?.length) parts.push(`${gf.zones.length} zone(s)`);
  if (ga.artists?.length) parts.push(ga.artists.slice(0, 2).join(', ') + (ga.artists.length > 2 ? ` +${ga.artists.length - 2}` : ''));
  if (gr.levels?.length) parts.push('N' + gr.levels.join('+'));
  if (gr.count) parts.push(`${gr.count} questions`);
  parts.push(cfg.allGames ? 'tous les jeux' : `${(cfg.games || []).length} jeu(x)`);
  return parts.join(' · ') || 'Aucun champ particulier';
}
// Page dédiée « Mes configurations enregistrées » (Mon compte) : deux colonnes, la description à
// gauche, le bouton portant le nom choisi par le joueur à droite — plus simple à parcourir qu'un
// bouton qui porterait lui-même tout le résumé.
function renderProfileConfigsTable() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('savedGuidedConfigs') || '{}'); } catch (e) {}
  const names = Object.keys(saved);
  $('profile-configs-empty')?.classList.toggle('hidden', !!names.length);
  const table = $('profile-configs-table');
  if (!table) return;
  table.innerHTML = names.map((name) => `
    <p style="font-family:Arial,sans-serif;font-size:.85rem;color:var(--muted);margin:0;">${escapeHtml(summarizeSavedConfig(saved[name]))}</p>
    <button type="button" class="secondary-button gc-load-config" data-name="${escapeHtml(name)}" style="padding:8px 14px;font-weight:700;white-space:nowrap;">${escapeHtml(name)} →</button>
    <button type="button" class="gc-delete-config" data-name="${escapeHtml(name)}" title="Supprimer cette configuration" aria-label="Supprimer cette configuration" style="border:none;background:none;color:var(--wrong);font-size:1.1rem;cursor:pointer;padding:4px 8px;">🗑</button>
  `).join('');
  table.querySelectorAll('.gc-load-config').forEach((btn) => {
    btn.addEventListener('click', () => loadSavedGuidedConfig(btn.dataset.name, saved));
  });
  table.querySelectorAll('.gc-delete-config').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm(`Supprimer la configuration « ${btn.dataset.name} » ? Cette action est définitive.`)) return;
      let current = {};
      try { current = JSON.parse(localStorage.getItem('savedGuidedConfigs') || '{}'); } catch (e) {}
      delete current[btn.dataset.name];
      localStorage.setItem('savedGuidedConfigs', JSON.stringify(current));
      renderProfileConfigsTable();
    });
  });
}
function renderSavedConfigsInto(wrapId, listId, saved) {
  const wrap = $(wrapId);
  const list = $(listId);
  if (!wrap || !list) return;
  const names = Object.keys(saved);
  wrap.classList.toggle('hidden', !names.length);
  list.innerHTML = names.map((name) => `
    <div style="min-width:180px;">
      <button type="button" class="secondary-button gc-load-config" data-name="${escapeHtml(name)}" style="width:100%;padding:8px 12px;font-size:.9rem;font-weight:700;">${escapeHtml(name)} →</button>
      <p style="font-family:Arial,sans-serif;font-size:.72rem;color:var(--muted);margin:4px 0 0;">${escapeHtml(summarizeSavedConfig(saved[name]))}</p>
    </div>`).join('');
  list.querySelectorAll('.gc-load-config').forEach((btn) => {
    btn.addEventListener('click', () => loadSavedGuidedConfig(btn.dataset.name, saved));
  });
}
function renderSavedGuidedConfigsList() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('savedGuidedConfigs') || '{}'); } catch (e) {}
  // Les configurations enregistrées ne se retrouvent plus que dans Mon compte — plus sur les
  // pages de menus elles-mêmes, pour ne garder qu'un seul endroit où les chercher.
  renderSavedConfigsInto('account-saved-configs-section', 'account-saved-configs-list', saved);
}
// Si le parcours guidé (ou une configuration enregistrée rechargée) a limité la partie à certains
// jeux seulement, on ne montre que ceux-là sur la page d'accueil des exercices — pas la peine de
// laisser deviner que les autres jeux pourraient, eux, avoir une configuration différente : la
// sélection issue du parcours guidé s'applique globalement, un point c'est tout.
const GAME_TO_BUTTON_ID = { impregnation: 'open-impregnation-setup', intrus: 'open-intrus-setup', famille: 'open-famille-setup', recon: 'open-reconstitution-setup', vf: 'open-vraifaux-setup', chrono: 'open-chrono-setup', quiz: 'open-quiz-setup' };
let loadedGuidedConfigName = '';
// Vrai dès qu'on est passé par le parcours guidé (ou qu'on a chargé une configuration
// enregistrée) — reste vrai même après un jeu terminé (le tableau simplifié doit réapparaître à
// l'identique), jusqu'à ce que le joueur sorte vraiment vers le menu par les icônes (accès
// confirmé). Mémorisé pour survivre à un rechargement de page en cours de partie.
let guidedModeActive = localStorage.getItem('guidedModeActive') === 'true';
function applyGamesFilterToHub() {
  let gg = {};
  try { gg = JSON.parse(localStorage.getItem('globalGamesDefaults') || '{}'); } catch (e) {}
  const games = gg.remember && gg.games?.length ? gg.games : null;
  Object.entries(GAME_TO_BUTTON_ID).forEach(([key, id]) => {
    $(id)?.classList.toggle('hidden', !!games && !games.includes(key));
  });
  const nameNote = $('training-hub-config-name');
  if (nameNote) {
    nameNote.textContent = guidedModeActive ? buildTrainingHubConfigSentence() : '';
  }
  // Bouton d'enregistrement direct : utile si le joueur n'a pas déjà enregistré sa configuration
  // à l'étape précédente — inutile en revanche s'il vient de recharger une config déjà nommée.
  $('training-hub-save-box')?.classList.toggle('hidden', !guidedModeActive || !!loadedGuidedConfigName);
  if ($('training-hub-save-feedback')) $('training-hub-save-feedback').textContent = '';
  // Le long texte explicatif ne sert plus à rien une fois qu'on arrive ici avec une sélection
  // déjà faite par le parcours guidé — il ne fait alors que répéter ce qui vient d'être choisi.
  // Les icônes ✏️ de modification par exercice disparaissent aussi dans ce mode : elles
  // compliquent inutilement un parcours pensé pour rester simple pour un débutant.
  $('training-hub-intro-text')?.classList.toggle('hidden', !!games || guidedModeActive);
  // Les icônes ✏️ par exercice ont été retirées (elles créaient des configurations divergentes
  // difficiles à repérer) — tout passe maintenant par Mon compte, un seul endroit à vérifier.
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
  return Object.keys(state).some((k) => state[k] && /(^|-)(art|century|zone)-/.test(k));
}
function hasPerExerciseRubriqueOverride(panelId) {
  let state;
  try { state = JSON.parse(localStorage.getItem(`lastSelection_${panelId}`) || '{}'); } catch (e) { return false; }
  return Object.keys(state).some((k) => state[k] && /(^|-)(field|rubrique|level)-/.test(k));
}
// Le quiz n'utilise pas le même schéma d'identifiants que les 6 jeux (pas de préfixe, « rubrique-
// » au lieu de « field- », « nb-questions » au lieu de « quiz-count »…) — on lui dédie donc sa
// propre application du choix général plutôt que de forcer applyGlobalFieldDefaultsTo à gérer un
// cas particulier de plus.
function applyGlobalDefaultsToQuiz() {
  const gf = readGlobalFieldDefaults();
  const gr = readGlobalRubriqueDefaults();
  if (gf.remember) {
    ['peinture', 'sculpture'].forEach((a) => { const el = $(`art-${a}`); if (el) el.checked = (gf.arts || []).includes(a); });
    ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].forEach((c) => { const el = $(`century-${c}`); if (el) el.checked = (gf.centuries || []).includes(c); });
    ['france', 'italie', 'espagne', 'royaume_uni', 'allemagne', 'europe_centrale_russie', 'europe_nord', 'amerique'].forEach((z) => { const el = $(`zone-${z}`); if (el) el.checked = (gf.zones || []).includes(z); });
  }
  if (gr.remember) {
    ['1', '2', '3'].forEach((lvl) => { const el = $(`level-${lvl}`); if (el) el.checked = (gr.levels || []).includes(lvl); });
    // Applique aussi la rubrique choisie dans Mon compte (le quiz ne gère que 4 des 6 rubriques
    // possibles — matériau et dimensions n'existent pas ici, elles sont simplement ignorées).
    // GROS BUG corrigé : si rien n'était choisi (gr.rubriques vide = « aucune restriction »),
    // cette boucle décochait les 4 cases d'un coup — le quiz démarrait alors sans aucune rubrique
    // active, un tableau de correction vide et une saisie qui ne servait plus à rien. On ne
    // touche donc les cases que si une restriction précise a bien été choisie.
    if (gr.rubriques?.length) {
      ['artist', 'title', 'date', 'location'].forEach((key) => {
        const el = $(`rubrique-${key}`);
        if (el) el.checked = gr.rubriques.includes(key);
      });
    }
    if (gr.count) {
      const radios = [...document.querySelectorAll('input[name="nb-questions"]')];
      const exact = radios.find((r) => r.value === gr.count);
      if (exact) exact.checked = true;
      else if (radios.length) {
        const numeric = radios.filter((r) => !isNaN(Number(r.value)));
        if (numeric.length) {
          if (gr.count === 'max') numeric.sort((a, b) => Number(b.value) - Number(a.value));
          else { const target = Number(gr.count); numeric.sort((a, b) => Math.abs(Number(a.value) - target) - Math.abs(Number(b.value) - target)); }
          numeric[0].checked = true;
        }
      }
    }
  }
}
function applyGlobalFieldDefaultsTo(prefix) {
  const gf = readGlobalFieldDefaults();
  const gr = readGlobalRubriqueDefaults();
  if (gf.remember) {
    ['peinture', 'sculpture'].forEach((a) => { const el = $(`${prefix}-art-${a}`); if (el) el.checked = (gf.arts || []).includes(a); });
    ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].forEach((c) => { const el = $(`${prefix}-century-${c}`); if (el) el.checked = (gf.centuries || []).includes(c); });
    ['france', 'italie', 'espagne', 'royaume_uni', 'allemagne', 'europe_centrale_russie', 'europe_nord', 'amerique'].forEach((z) => { const el = $(`${prefix}-zone-${z}`); if (el) el.checked = (gf.zones || []).includes(z); });
  }
  if (gr.remember) {
    ['1', '2', '3'].forEach((lvl) => { const el = $(`${prefix}-level-${lvl}`); if (el) el.checked = (gr.levels || []).includes(lvl); });
    // Applique aussi la rubrique choisie dans Mon compte aux propres cases de l'exercice, quand il
    // en a (artist/title/date/materiaux/dimensions/location) — bug réel repéré : ce choix global
    // n'avait jusqu'ici aucun effet, chaque exercice gardait sa propre sélection non liée.
    // Même correction critique que pour le quiz : ne toucher les cases que si une restriction
    // précise existe réellement, sinon on les décochait toutes d'un coup (sans restriction voulue,
    // ce qui revient au même visuellement... sauf que ça écrasait aussi une éventuelle sélection
    // locale légitime restée en place).
    if (gr.rubriques?.length) {
      ['artist', 'title', 'date', 'materiaux', 'dimensions', 'location'].forEach((key) => {
        const el = $(`${prefix}-field-${key}`);
        if (el) el.checked = gr.rubriques.includes(key);
      });
    }
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
function showQuizConfig() {
  showPanel('quiz-setup');
  restoreLastSelection('quiz-setup-panel');
  refreshSavedChoiceButton();
}
const EXERCISE_SHOW_CONFIG = { imp: showImpConfig, intrus: showIntrusConfig, recon: showReconConfig, vf: showVfConfig, fam: showFamConfig, chrono: showChronoConfig, quiz: showQuizConfig };
// Ouvre la configuration d'un exercice en petite fenêtre superposée, par-dessus le menu des
// exercices resté visible en fond (assombri) — plutôt que de le remplacer entièrement. Referme
// via la croix, en cliquant à côté, ou en validant/lançant depuis cette fenêtre.
function openConfigAsPopup(prefix) {
  EXERCISE_SHOW_CONFIG[prefix]?.(); // logique habituelle (restaure la sélection, lit l'objectif…)
  const panelId = EXERCISE_INFO[prefix]?.panel;
  if (!panelId) return;
  $('training-hub-panel')?.classList.remove('hidden');
  const panel = $(panelId);
  panel?.classList.add('config-popup-mode');
  // La fenêtre doit être détachée de .app-shell : ce conteneur a son propre contexte d'empilement
  // CSS (position:relative + z-index) qui plafonnerait la fenêtre sous n'importe quel élément
  // ajouté directement au <body>, quel que soit son propre z-index. En la rattachant au <body>,
  // on évite complètement le problème plutôt que d'empiler les correctifs de z-index.
  if (panel) { panel.dataset.originalParent = 'true'; document.body.appendChild(panel); }
}
function closeConfigPopup(prefix) {
  const panelId = EXERCISE_INFO[prefix]?.panel;
  const panel = $(panelId);
  panel?.classList.remove('config-popup-mode');
  panel?.classList.add('hidden');
  // Replace le panneau à sa position d'origine dans la page (juste avant le panneau du menu des
  // exercices), pour que la navigation normale (showPanel) continue de fonctionner ensuite.
  if (panel?.dataset.originalParent) { $('training-hub-panel')?.insertAdjacentElement('beforebegin', panel); delete panel.dataset.originalParent; }
  updateExerciseSummaries();
}
// Les icônes ✏️ qui ouvraient cette fenêtre superposée par exercice ont été retirées du tableau
// des exercices (source de configurations divergentes difficiles à repérer) — openConfigAsPopup
// reste disponible si besoin, mais n'est plus déclenché depuis nulle part pour l'instant.
// Les boutons « ✕ Fermer » referment la fenêtre superposée si elle est ouverte ainsi ; sinon
// (accès direct improbable) ils gardent leur comportement de repli vers le menu des exercices.
Object.entries(EXERCISE_INFO).forEach(([prefix, info]) => {
  const backBtn = document.querySelector(`#${info.panel} [id$="-setup-back-button"]`);
  backBtn?.addEventListener('click', () => {
    if ($(info.panel)?.classList.contains('config-popup-mode')) closeConfigPopup(prefix);
    else { showPanel('training-hub'); updateExerciseSummaries(); }
  });
});
$('open-training')?.addEventListener('click', () => {
  // Accès explicite « par les menus » (joueur confirmé) : on sort du mode simplifié du parcours
  // guidé, et on amène d'abord à Mon compte plutôt que directement au tableau des exercices — le
  // joueur y règle ses choix (technique, esthétique, champ, rubrique, artiste) avant de valider.
  guidedModeActive = false;
  localStorage.removeItem('guidedModeActive');
  localStorage.removeItem('globalGamesDefaults');
  loadedGuidedConfigName = '';
  showPanel('profile');
  initProfilePage();
});
// --- Parcours guidé de configuration (page d'accueil → « pour débuter ») : une question à la
// fois, la suivante apparaît dès qu'on répond — écrit dans les mêmes réglages globaux que Mon
// compte (Mes choix de champ / d'artiste / de rubrique et de niveau), donc tout le reste de
// l'application (jeux, résumés) s'appuie dessus exactement pareil, sans code séparé à maintenir.
function resetGuidedConfig() {
  hasSpokenRienCoche = false;
  // Efface tout, y compris ce qui est déjà enregistré (pas seulement l'état visible des cases) —
  // bug réel repéré : refaire le parcours une 2e fois sans choisir d'artiste laissait l'ancien
  // choix (ex. Poussin) bien réel en mémoire, puisque « Non » démarre déjà coché et ne déclenche
  // alors aucun événement de changement pour l'effacer. Le jeu se lançait ensuite sur une
  // combinaison incohérente (nouveau champ + vieil artiste), d'où le blocage sans image.
  localStorage.removeItem('globalFieldDefaults');
  localStorage.removeItem('globalArtistDefaults');
  localStorage.removeItem('globalRubriqueDefaults');
  localStorage.removeItem('globalGamesDefaults');
  document.querySelectorAll('.gc-step').forEach((el, i) => el.classList.toggle('hidden', i !== 0));
  document.querySelectorAll('.gc-art, .gc-century, .gc-zone, .gc-level, .gc-rubrique').forEach((el) => { el.checked = false; });
  document.querySelector('input[name="gc-want-artists"][value="no"]').checked = true;
  $('gc-artist-list').classList.add('hidden');
  $('gc-artist-status').textContent = '';
  $('gc-artist-patience').classList.add('hidden');
  document.querySelector('input[name="gc-count"][value="10"]').checked = true;
  document.querySelector('input[name="gc-allgames"][value="yes"]').checked = true;
  $('gc-games-list').classList.add('hidden');
  document.querySelectorAll('.gc-game').forEach((el) => { el.checked = true; });
  $('gc-save-feedback').textContent = '';
  $('gc-save-name').value = '';
}
$('open-guided-config')?.addEventListener('click', () => {
  resetGuidedConfig();
  loadedGuidedConfigName = '';
  showPanel('guided-config');
  guidedSpeak($('gc-step-intro')?.querySelector('p')?.textContent || '');
});
$('gc-intro-find-config')?.addEventListener('click', () => {
  showPanel('profile');
  initProfilePage();
  $('profile-menu-saved-configs')?.click();
});
// Lit à voix haute le texte principal d'une étape du parcours guidé, et le petit texte d'aide
// juste en dessous s'il y en a un (ex. « rien coché = tout demandé ») — mais seulement la toute
// première fois qu'un tel rappel apparaît dans le parcours : l'entendre à chaque étape suivante
// (5 fois de suite) devenait lassant, le joueur a compris le principe dès la première fois.
let hasSpokenRienCoche = false;
function speakGuidedStep(stepEl) {
  const mainText = stepEl?.querySelector('p.config-table-col-title, p:not(.gc-note):not(.modal-hint)');
  const hintText = stepEl?.querySelector('.gc-note');
  const parts = [mainText?.textContent];
  if (hintText && !hasSpokenRienCoche) { parts.push(hintText.textContent); hasSpokenRienCoche = true; }
  guidedSpeak(parts.filter(Boolean).join(' '));
}
$('gc-intro-new-config')?.addEventListener('click', () => {
  $('gc-step-intro').classList.add('hidden');
  const seen = localStorage.getItem('hasSeenGuidedPersonalize') === 'true';
  const next = $(seen ? 'gc-step-art' : 'gc-step-personalize');
  next.classList.remove('hidden');
  window.scrollTo({ top: next.offsetTop - 80, behavior: 'smooth' });
  speakGuidedStep(next);
});
$('gc-personalize-continue')?.addEventListener('click', () => {
  localStorage.setItem('hasSeenGuidedPersonalize', 'true');
  setGlobalPref('audioOn', $('gc-personalize-audio').checked);
  const ambiance = document.querySelector('input[name="gc-personalize-ambiance"]:checked')?.value || '';
  localStorage.setItem('ambiance', ambiance);
  applyAmbiance(ambiance);
});
function saveGuidedFieldAndRubrique() {
  const arts = [...document.querySelectorAll('.gc-art:checked')].map((el) => el.value);
  const centuries = [...document.querySelectorAll('.gc-century:checked')].map((el) => el.value);
  const zones = [...document.querySelectorAll('.gc-zone:checked')].map((el) => el.value);
  localStorage.setItem('globalFieldDefaults', JSON.stringify({ arts, centuries, zones, remember: true }));
  const levels = [...document.querySelectorAll('.gc-level:checked')].map((el) => el.value);
  const rubriques = [...document.querySelectorAll('.gc-rubrique:checked')].map((el) => el.value);
  let count = document.querySelector('input[name="gc-count"]:checked')?.value || '10';
  const prevRubrique = readGlobalRubriqueDefaults();
  localStorage.setItem('globalRubriqueDefaults', JSON.stringify({ rubriques: rubriques.length ? rubriques : (prevRubrique.rubriques || []), levels, count, remember: true }));
}
document.querySelectorAll('.gc-continue').forEach((btn) => {
  btn.addEventListener('click', () => {
    saveGuidedFieldAndRubrique();
    $(btn.closest('.gc-step').id).classList.add('hidden');
    const next = $(btn.dataset.next);
    next.classList.remove('hidden');
    if (next.id === 'gc-step-artists') populateGuidedArtistList();
    if (next.id === 'gc-step-summary') buildGuidedSummary();
    window.scrollTo({ top: next.offsetTop - 80, behavior: 'smooth' });
    // Lit à voix haute la question de la nouvelle étape, et son petit texte d'aide s'il y en a un.
    // Exception : « gc-step-artists » se sonorise lui-même une fois sa liste chargée (le texte
    // utile — le nombre d'artistes compatibles — n'existe pas encore à cet instant précis).
    if (next.id !== 'gc-step-artists') speakGuidedStep(next);
  });
});
async function populateGuidedArtistList() {
  const list = $('gc-artist-list');
  const status = $('gc-artist-status');
  const patience = $('gc-artist-patience');
  patience.classList.remove('hidden');
  status.textContent = 'Chargement de la liste des artistes…';
  const ok = await loadArtistListIfNeeded();
  if (!ok) { patience.classList.add('hidden'); status.textContent = "La liste des artistes n'a pas pu être chargée (connexion internet ?)."; list.innerHTML = ''; return; }
  let matchingRows = artistListRows.filter(artistMatchesCurrentField);
  const levels = readGlobalRubriqueDefaults().levels || [];
  if (levels.length && matchingRows.length <= 80) {
    status.textContent = 'Vérification du niveau des artistes…';
    const kept = [];
    for (const row of matchingRows) {
      const works = await fetchWorksForArtistRow(row);
      if (!works.length || works.some((w) => levels.includes(String(w.niveau || 1)))) kept.push(row);
    }
    matchingRows = kept;
  }
  patience.classList.add('hidden');
  // Tri alphabétique par nom de famille (ou surnom s'il existe), particules ignorées — le même
  // critère que la liste complète du menu hamburger, pour rester cohérent dans toute l'appli.
  matchingRows.sort((a, b) => particleStrippedSortKey(a['Surnom'] || a['Patronyme']).localeCompare(particleStrippedSortKey(b['Surnom'] || b['Patronyme']), 'fr'));
  const selected = readGlobalArtistDefaults().artists || [];
  list.classList.remove('hidden');
  list.innerHTML = matchingRows.map((r) => {
    const name = [r['Prénom'], r['Patronyme']].filter(Boolean).join(' ').trim();
    const isSel = selected.includes(name);
    const flag = artistFlag(r['Nationalité']) || '';
    return `<label class="rubrique-option" style="display:flex;align-items:center;gap:6px;"><input type="checkbox" class="gc-artist-pick" value="${escapeHtml(name)}" ${isSel ? 'checked' : ''} /><span>${flag} ${escapeHtml(name)}</span></label>`;
  }).join('');
  list.querySelectorAll('.gc-artist-pick').forEach((cb) => {
    cb.addEventListener('change', () => {
      const current = readGlobalArtistDefaults().artists || [];
      const next = cb.checked ? [...current, cb.value] : current.filter((n) => n !== cb.value);
      localStorage.setItem('globalArtistDefaults', JSON.stringify({ artists: next, remember: true }));
    });
  });
  status.textContent = `${matchingRows.length} artiste${matchingRows.length > 1 ? 's' : ''} compatible${matchingRows.length > 1 ? 's' : ''} avec vos choix de niveau et de champ actuels. Cochez des noms si vous voulez réduire le jeu aux artistes cochés. Attention, les artistes les plus célèbres (de niveau 1) ont au moins 12 œuvres dans la base, ceux de niveau 2, 8 œuvres et ceux de niveau 3, 4 œuvres. Si vous voulez jouer avec peu d'artistes, sélectionnez-en tout de même plusieurs pour que les jeux offrent de vrais choix de réponse.`;
  // Sonorise la question de l'étape ET ce texte, seulement disponible une fois la liste chargée.
  // Ce texte n'arrive qu'après un chargement réseau : si le joueur a déjà avancé plus loin dans
  // le parcours pendant ce temps, on ne parle plus par-dessus l'étape où il se trouve vraiment.
  if (!$('gc-step-artists').classList.contains('hidden')) {
    guidedSpeak(`Voulez-vous restreindre encore la sélection à certains artistes précis\u00a0? ${status.textContent}`);
  }
}
document.querySelectorAll('input[name="gc-want-artists"]').forEach((el) => {
  el.addEventListener('change', () => {
    if (el.value === 'yes' && el.checked) {
      populateGuidedArtistList();
    } else if (el.value === 'no' && el.checked) {
      $('gc-artist-list').classList.add('hidden');
      $('gc-artist-status').textContent = '';
      $('gc-artist-patience').classList.add('hidden');
      localStorage.removeItem('globalArtistDefaults');
    }
  });
});
document.querySelectorAll('input[name="gc-allgames"]').forEach((el) => {
  el.addEventListener('change', () => { $('gc-games-list').classList.toggle('hidden', el.value !== 'no' || !el.checked); });
});
// Phrase affichée en haut du tableau des exercices quand on y arrive via « Valider » (parcours
// guidé ou Mon compte) — texte détaillé demandé, avec un préfixe différent selon qu'il s'agit
// d'une configuration enregistrée retrouvée ou d'un choix du jour fait sur le moment.
function buildTrainingHubConfigSentence() {
  const gf = readGlobalFieldDefaults();
  const gr = readGlobalRubriqueDefaults();
  const ga = readGlobalArtistDefaults();
  const artLabel = { peinture: 'la peinture', sculpture: 'la sculpture' };
  const artsPart = (gf.arts || []).map((a) => artLabel[a] || a).join(' et ') || 'la peinture et la sculpture';
  const centPart = gf.centuries?.length ? ` du ${gf.centuries.join(', du ')} siècle` : '';
  const zoneLabels = { france: 'France', italie: 'Italie', espagne: 'Espagne', royaume_uni: 'Royaume-Uni', allemagne: 'Allemagne', europe_centrale_russie: 'Europe centrale et Russie', europe_nord: 'Europe du Nord', amerique: 'Amérique' };
  const zonePart = gf.zones?.length ? ` en ${gf.zones.map((z) => zoneLabels[z] || z).join(', ')}` : '';
  const rubriqueLabels = { artist: "les noms d'artistes", title: 'les titres', date: 'les dates', materiaux: 'les matériaux', dimensions: 'les dimensions', location: 'les lieux de conservation' };
  const rubriquePart = gr.rubriques?.length
    ? `, en donnant pour chaque image ${gr.rubriques.map((r) => rubriqueLabels[r] || r).join(', ')}`
    : '';
  const levelLabels = { '1': 'les plus célèbres', '2': 'connus', '3': 'moins connus' };
  const levelPart = gr.levels?.length
    ? ` de niveau ${gr.levels.join('/')} (artistes ${gr.levels.map((l) => levelLabels[l]).join('/')})`
    : '';
  const artistsPart = ga.artists?.length ? `, en particulier ${ga.artists.join(', ')}` : '';
  const countPart = gr.count ? ` et en répondant à des questionnaires de ${gr.count === 'max' ? 'un maximum de' : gr.count} questions` : '';
  const middle = `vous exercer sur ${artsPart}${centPart}${zonePart}${rubriquePart}${levelPart}${artistsPart}${countPart}`;
  if (loadedGuidedConfigName) {
    return `Pour cette session vous avez repris votre configuration ${loadedGuidedConfigName} : ${middle}.`;
  }
  return `Pour cette session vous avez choisi de ${middle}. Si vous ne l'avez pas fait à la page précédente, vous pouvez encore l'enregistrer ci-dessous pour la retrouver à des sessions ultérieures.`;
}
function buildGuidedSummary() {
  const gf = readGlobalFieldDefaults();
  const gr = readGlobalRubriqueDefaults();
  const ga = readGlobalArtistDefaults();
  const artLabel = { peinture: 'la peinture', sculpture: 'la sculpture' };
  const artsPart = (gf.arts || []).map((a) => artLabel[a] || a).join(' et ') || 'la peinture et la sculpture';
  const centPart = gf.centuries?.length ? ` du ${gf.centuries.join(', du ')} siècle` : '';
  const zonePart = gf.zones?.length ? ` en zone ${gf.zones.join(', ')}` : '';
  const levelLabels = { '1': 'très célèbres', '2': 'connus', '3': 'moins connus' };
  const levelPart = gr.levels?.length ? `, avec des artistes ${gr.levels.map((l) => levelLabels[l]).join('/')}` : '';
  const artistsPart = ga.artists?.length ? `, en particulier ${ga.artists.join(', ')}` : '';
  const rubriqueLabels = { artist: "le nom de l'artiste", title: 'le titre', date: 'la date', materiaux: 'le matériau', dimensions: 'les dimensions', location: 'le lieu' };
  const rubriquePart = gr.rubriques?.length ? gr.rubriques.map((r) => rubriqueLabels[r] || r).join(', ') : 'plusieurs informations';
  const countLabel = gr.count === 'max' ? 'un maximum de' : gr.count;
  const allGames = document.querySelector('input[name="gc-allgames"]:checked')?.value === 'yes';
  const gamesPart = allGames ? 'tous les jeux' : [...document.querySelectorAll('.gc-game:checked')].map((el) => el.parentElement.textContent.trim()).join(', ');
  $('gc-summary-sentence').textContent = `Aujourd'hui nous allons jouer avec ${artsPart}${centPart}${zonePart}${levelPart}${artistsPart}, à travers des questionnaires de ${countLabel} questions chacun portant sur ${rubriquePart}, pour ${gamesPart}.`;
}
$('gc-start-button')?.addEventListener('click', () => {
  if (document.querySelector('input[name="gc-allgames"]:checked')?.value === 'no') {
    const games = [...document.querySelectorAll('.gc-game:checked')].map((el) => el.value);
    localStorage.setItem('globalGamesDefaults', JSON.stringify({ games, remember: true }));
  } else {
    localStorage.removeItem('globalGamesDefaults');
  }
  // On revient au tableau des exercices (filtré à la sélection faite), sans les icônes ✏️ de
  // modification — trop de choses à la fois pour un parcours pensé pour débuter simplement. Le
  // joueur choisit lui-même, dans ce tableau réduit, par lequel commencer.
  guidedModeActive = true;
  localStorage.setItem('guidedModeActive', 'true');
  showPanel('training-hub');
  updateExerciseSummaries();
  applyFieldLinkedAmbiance();
});
$('gc-save-button')?.addEventListener('click', () => {
  const name = $('gc-save-name').value.trim();
  if (!name) { $('gc-save-feedback').style.color = 'var(--wrong)'; $('gc-save-feedback').textContent = 'Donnez un nom à cette configuration.'; return; }
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('savedGuidedConfigs') || '{}'); } catch (e) {}
  saved[name] = {
    field: readGlobalFieldDefaults(), artists: readGlobalArtistDefaults(), rubrique: readGlobalRubriqueDefaults(),
    allGames: document.querySelector('input[name="gc-allgames"]:checked')?.value === 'yes',
    games: [...document.querySelectorAll('.gc-game:checked')].map((el) => el.value),
  };
  localStorage.setItem('savedGuidedConfigs', JSON.stringify(saved));
  $('gc-save-feedback').style.color = 'var(--ok)';
  $('gc-save-feedback').textContent = `Configuration « ${name} » enregistrée — retrouvez-la dans Mon compte.`;
});
$('training-hub-save-button')?.addEventListener('click', () => {
  const name = $('training-hub-save-name').value.trim();
  if (!name) { $('training-hub-save-feedback').style.color = 'var(--wrong)'; $('training-hub-save-feedback').textContent = 'Donnez un nom à cette configuration.'; return; }
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('savedGuidedConfigs') || '{}'); } catch (e) {}
  let gg = {};
  try { gg = JSON.parse(localStorage.getItem('globalGamesDefaults') || '{}'); } catch (e) {}
  saved[name] = {
    field: readGlobalFieldDefaults(), artists: readGlobalArtistDefaults(), rubrique: readGlobalRubriqueDefaults(),
    allGames: !gg.remember || !gg.games?.length,
    games: gg.games || [],
  };
  localStorage.setItem('savedGuidedConfigs', JSON.stringify(saved));
  loadedGuidedConfigName = name;
  $('training-hub-save-feedback').style.color = 'var(--ok)';
  $('training-hub-save-feedback').textContent = `Configuration « ${name} » enregistrée — retrouvez-la dans Mon compte.`;
  $('training-hub-save-box').classList.add('hidden');
});
document.querySelectorAll('.training-soon').forEach((btn) => {
  btn.addEventListener('click', (event) => event.currentTarget.classList.toggle('show-tooltip'));
});

// ============================================================
// MODULE IMPRÉGNATION — réutilise fetchQuizRows/ART_LABELS/CENTURY_LABELS/zoneOfNationality déjà
// définis pour le quiz ; sélection propre (préfixe imp-), mécanique d'écriture progressive
// synchronisée à la voix de synthèse, sans notation.
// ============================================================
function showImpConfig() {
  showPanel('impregnation-setup'); populateImpVoices(); speakObjective('imp'); restoreLastSelection('impregnation-setup-panel');
}
$('open-impregnation-setup')?.addEventListener('click', () => {
  applyGlobalFieldDefaultsTo('imp');
  suppressSaveLastSelection = true;
  showExerciseRules('imp', () => { speakObjective('imp'); $('imp-start-button')?.click(); });
});
$('imp-exit-link')?.addEventListener('click', () => { impClearTimers(); speechSynthesis.cancel(); showPanel('impregnation-setup'); });
['imp', 'intrus', 'recon', 'vf', 'fam'].forEach((p) => {
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
function impSelectedZones() { return ['france', 'italie', 'espagne', 'royaume_uni', 'allemagne', 'europe_centrale_russie', 'europe_nord', 'amerique'].filter((z) => $(`imp-zone-${z}`)?.checked); }
function impSelectedLevels() { return ['1', '2', '3'].filter((lvl) => $(`imp-level-${lvl}`)?.checked); }

let IMP_SESSION = [], impIndex = 0, impPaused = false, impTimers = [], impAudioOn = true, impDelayMs = 3000, impSelectedVoice = null, impFieldLabel = '';
const impTimer = createTimer('topbar-timer');

function impClearTimers() { impTimers.forEach(clearTimeout); impTimers = []; }
function impSpeak(text) {
  if (!impAudioOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(fixSpeechPronunciation(text));
  u.lang = 'fr-FR'; u.rate = 0.72;
  if (impSelectedVoice) u.voice = impSelectedVoice;
  speechSynthesis.speak(u);
}

$('imp-start-button')?.addEventListener('click', async () => {
  handleExtendAndRemember('imp', 'impregnation-setup-panel');
  saveLastSelection('impregnation-setup-panel');
  // Avancement toujours manuel désormais (flèche → ou touche Entrée) — plus de défilement
  // automatique, qui posait des problèmes de synchronisation difficiles à diagnostiquer.
  let arts = impSelectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = impSelectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  impFieldLabel = buildFieldLabel(arts, centuries);
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
    // Si un ou plusieurs artistes précis ont été choisis dans « Mes choix de champ »
    // (Art/Siècle/Zone effacés automatiquement dans ce cas), on ne garde que leurs œuvres —
    // en dehors du bloc ci-dessus, qui ne s'exécute jamais quand les zones sont vides (ce
    // qui est justement le cas quand des artistes sont choisis : bug réel repéré, le filtre
    // ne s'appliquait alors jamais).
    pool = filterPoolByGlobalArtists(pool, allRows);
    // Mélange, sans limitation de nombre : tout l'échantillon correspondant au choix.
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    IMP_SESSION = pool;
    impAudioOn = getGlobalPrefs().audioOn;
    impSelectedVoice = getGlobalVoice();
    impIndex = 0;
    showPanel('impregnation');
    $('imp-ready-screen').classList.remove('hidden');
    $('imp-quiz-grid').classList.add('hidden');
    $('bg-mosaic').classList.remove('hidden');
    populateSessionMosaic(IMP_SESSION.map((w) => w.image));
  } catch (error) {
    feedback.textContent = `Erreur : ${error.message}`;
  }
});

$('imp-launch-first-button')?.addEventListener('click', () => {
  $('imp-ready-screen').classList.add('hidden');
  $('imp-quiz-grid').classList.remove('hidden');
  $('bg-mosaic').classList.add('hidden');
  document.body.classList.add('in-exercise');
  impTimer.start();
  impShowCurrent();
});

function impShowCurrent() {
  impClearTimers();
  speechSynthesis.cancel();
  impPaused = false;
  $('imp-pause-button').textContent = '⏸';
  const work = IMP_SESSION[impIndex];
  $('imp-progress-label').textContent = `Œuvre ${impIndex + 1} / ${IMP_SESSION.length}`;
  updateTopBanner('Imprégnation', `Œuvre ${impIndex + 1}/${IMP_SESSION.length}`, impFieldLabel);
  $('imp-progress-bar').style.width = `${(impIndex / Math.max(IMP_SESSION.length - 1, 1)) * 100}%`;
  $('imp-stage-img').src = imageSourceSized(work.image, 900);
  preloadImage(IMP_SESSION[impIndex + 1]?.image, 900);

  const dims = formatDimensionsDisplay(work);
  const anyFieldChecked = ['artist', 'title', 'date', 'materiaux', 'dimensions', 'location'].some((k) => $(`imp-field-${k}`)?.checked);
  // showFullCorrection (icône 🔎) court-circuite la restriction de rubrique choisie — tout
  // s'affiche, sans avoir à revenir modifier la configuration de l'exercice pour le voir.
  const fieldOn = (key) => showFullCorrection || (anyFieldChecked ? $(`imp-field-${key}`).checked : true);
  const fields = [
    { key: 'artist', label: 'Auteur', value: formatArtistDisplayName(work), spoken: work.surnomFr ? `${work.artist}, dit ${work.surnomFr}` : work.artist, on: fieldOn('artist') },
    { key: 'title', label: 'Titre de l\u2019œuvre', value: `<em>« ${escapeHtml(work.title)} »</em>`, spoken: `« ${work.title} »`, on: fieldOn('title') },
    { key: 'date', label: 'Date', value: work.date, on: fieldOn('date') },
    { key: 'materiaux', label: 'Matériau', value: work.materialsPhrase || work.materials, on: fieldOn('materiaux') && work.materials },
    { key: 'dimensions', label: 'Dimensions', value: dims, spoken: spokenDimensionsPhrase(work), on: fieldOn('dimensions') && dims },
    { key: 'location', label: 'Lieu', value: cityFlag(work.ville) ? `${escapeHtml(work.location)} <span title="${escapeHtml(countryNameFromFlag(work.ville))}">${cityFlag(work.ville)}</span>` : escapeHtml(work.location), spoken: work.location, on: fieldOn('location') },
  ].filter((f) => f.on);

  $('imp-correction-details').innerHTML = fields.map((f) =>
    `<span class="correction-label">${f.label}</span><span class="correction-value" id="imp-val-${f.key}"></span>`
  ).join('');

  const refText = fields.map((f) => f.spoken || f.value).join(' — ') || work.artist;
  currentSpeechNationality = work.nationality || '';
  impSpeak(refText);

  const STAGGER = impDelayMs * 0.5;
  fields.forEach((f, i) => {
    impTimers.push(setTimeout(() => {
      const el = $(`imp-val-${f.key}`);
      if (el) {
        if (f.key === 'dimensions' || f.key === 'title' || f.key === 'artist' || f.key === 'location') el.innerHTML = f.value; else el.textContent = f.value;
        el.classList.add('written');
      }
    }, 400 + i * STAGGER));
  });

}

// Bouton texte partagé (bandeau du haut, à côté de « Retour au menu des exercices ») plutôt que
// des icônes 🔎 séparées — plus clair et directement à côté du bouton retour propre à chaque jeu.
// Le texte lui-même indique l'état : « Voir » quand elle est éteinte, « Arrêter » une fois activée.
function updateFullCorrectionButtonsText() {
  ['imp', 'vf', 'intrus', 'recon'].forEach((p) => {
    const btn = $(`${p}-full-correction-button`);
    if (btn) btn.textContent = showFullCorrection ? 'Arrêter la correction complète' : 'Voir la correction complète';
  });
}
$('imp-full-correction-button')?.addEventListener('click', () => { toggleFullCorrection(FULL_CORRECTION_PANELS.impregnation); updateFullCorrectionButtonsText(); });
$('vf-full-correction-button')?.addEventListener('click', () => { toggleFullCorrection(FULL_CORRECTION_PANELS.vraifaux); updateFullCorrectionButtonsText(); });
$('intrus-full-correction-button')?.addEventListener('click', () => { toggleFullCorrection(FULL_CORRECTION_PANELS.intrus); updateFullCorrectionButtonsText(); });
$('recon-full-correction-button')?.addEventListener('click', () => { toggleFullCorrection(FULL_CORRECTION_PANELS.reconstitution); updateFullCorrectionButtonsText(); });
$('imp-pause-button')?.addEventListener('click', () => {
  impPaused = !impPaused;
  $('imp-pause-button').textContent = impPaused ? '▶' : '⏸';
  if (impPaused) { impClearTimers(); speechSynthesis.cancel(); } else impShowCurrent();
});
$('imp-prev-button')?.addEventListener('click', () => { if (impIndex > 0) { impIndex--; impShowCurrent(); } });
$('imp-next-button')?.addEventListener('click', () => { if (impIndex < IMP_SESSION.length - 1) { impIndex++; impShowCurrent(); } });
// Touche Entrée : avance aussi à l'œuvre suivante quand on est sur Imprégnation, en plus du
// clic sur la flèche → (le raccourci Entrée générique ne cible que les boutons .primary-button,
// que la flèche n'est volontairement pas pour garder son style rond).
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (!getGlobalPrefs().enterValidate) return;
  if (event.target.tagName === 'TEXTAREA') return;
  if ($('impregnation-panel')?.classList.contains('hidden')) return;
  event.preventDefault();
  $('imp-next-button')?.click();
});

// ============================================================
// MODULE INTRUS — retrouver la bonne image parmi 3 (mode « image »), ou la bonne référence
// parmi 3 (mode « reference »). Noté, comptabilisé à part dans les scores (type: 'entrainement').
// ============================================================
function showIntrusConfig() {
  showPanel('intrus-setup'); populateIntrusVoices(); speakObjective('intrus'); restoreLastSelection('intrus-setup-panel'); applyDefaultAdvance('intrus-opt-autoadvance', 'intrus-opt-delay', 'intrus-delay-row');
}
$('open-intrus-setup')?.addEventListener('click', () => {
  applyGlobalFieldDefaultsTo('intrus');
  suppressSaveLastSelection = true;
  applyDefaultAdvance('intrus-opt-autoadvance', 'intrus-opt-delay', 'intrus-delay-row');
  showExerciseRules('intrus', () => { speakObjective('intrus'); $('intrus-start-button')?.click(); });
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
function intrusSelectedZones() { return ['france', 'italie', 'espagne', 'royaume_uni', 'allemagne', 'europe_centrale_russie', 'europe_nord', 'amerique'].filter((z) => $(`intrus-zone-${z}`)?.checked); }
function intrusSelectedLevels() { return ['1', '2', '3'].filter((lvl) => $(`intrus-level-${lvl}`)?.checked); }

let INTRUS_SESSION = [], intrusIndex = 0, intrusCorrectCount = 0, intrusAnswered = false, intrusAudioOn = true, intrusSelectedVoice = null, intrusAutoAdvance = false, intrusAutoAdvanceDelay = 5000, intrusExtraFields = [], intrusTimers = [], intrusFieldLabel = '';
const intrusTimer = createTimer('topbar-timer');
$('intrus-opt-autoadvance')?.addEventListener('change', () => { $('intrus-delay-row').style.display = $('intrus-opt-autoadvance').checked ? 'flex' : 'none'; });
function intrusSpeak(text) {
  if (!intrusAudioOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(fixSpeechPronunciation(text));
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
  intrusFieldLabel = buildFieldLabel(arts, centuries);
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
    // Si un ou plusieurs artistes précis ont été choisis dans « Mes choix de champ »
    // (Art/Siècle/Zone effacés automatiquement dans ce cas), on ne garde que leurs œuvres —
    // en dehors du bloc ci-dessus, qui ne s'exécute jamais quand les zones sont vides (ce
    // qui est justement le cas quand des artistes sont choisis : bug réel repéré, le filtre
    // ne s'appliquait alors jamais).
    pool = filterPoolByGlobalArtists(pool, allRows);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const countChoice = document.querySelector('input[name="intrus-count"]:checked').value;
    const count = countChoice === 'max' ? pool.length : Math.min(Number(countChoice), pool.length);
    intrusAudioOn = getGlobalPrefs().audioOn;
    intrusSelectedVoice = getGlobalVoice();
    intrusAutoAdvance = $('intrus-opt-autoadvance')?.checked || false;
    intrusAutoAdvanceDelay = Number($('intrus-opt-delay')?.value || 5000);
    intrusExtraFields = ['date', 'materiaux', 'dimensions', 'location'].filter((k) => $(`intrus-field-${k}`)?.checked);
    // Vrai bug corrigé : si la rubrique globale choisie est « artiste » (qui n'a pas de case chez
    // Intrus, artiste/titre étant toujours montrés ici) aucune des 4 cases n'est cochée — ce n'est
    // PAS « rien choisi », c'est un choix réel qui exclut justement ces 4 rubriques. Le repli sur
    // tout n'a de sens que si AUCUNE restriction globale n'existe du tout.
    if (!intrusExtraFields.length && !readGlobalRubriqueDefaults().rubriques?.length) {
      intrusExtraFields = ['date', 'materiaux', 'dimensions', 'location'];
    }
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
    $('intrus-ready-screen').classList.remove('hidden');
    $('intrus-quiz-grid').classList.add('hidden');
    $('bg-mosaic').classList.remove('hidden');
    populateSessionMosaic(INTRUS_SESSION.map((q) => q.correct.image));
  } catch (error) {
    feedback.textContent = `Erreur : ${error.message}`;
  }
});

$('intrus-launch-first-button')?.addEventListener('click', () => {
  $('intrus-ready-screen').classList.add('hidden');
  $('intrus-quiz-grid').classList.remove('hidden');
  $('bg-mosaic').classList.add('hidden');
  document.body.classList.add('in-exercise');
  intrusTimer.start();
  intrusShowQuestion();
});
function intrusShowQuestion() {
  speechSynthesis.cancel();
  intrusTimers.forEach(clearTimeout); intrusTimers = [];
  // Bref délai de sécurité avant que les images ne deviennent cliquables : sur un tap rapide
  // (bouton « Suivant » puis nouvelle image au même endroit à l'écran), le second tap pouvait
  // atterrir par accident sur la nouvelle question et y répondre sans le vouloir. Le temps que
  // les images apparaissent visuellement mais restent inactives coupe court à ce faux départ.
  intrusAnswered = true;
  intrusTimers.push(setTimeout(() => { intrusAnswered = false; }, 400));
  const q = INTRUS_SESSION[intrusIndex];
  // Précharge les 3 images de la question suivante (toutes affichées en même temps ici, pas une
  // seule comme ailleurs) pendant que le joueur répond encore à celle-ci.
  INTRUS_SESSION[intrusIndex + 1]?.choices?.forEach((c) => preloadImage(c.image, 300));
  $('intrus-progress-label').textContent = `Question ${intrusIndex + 1} / ${INTRUS_SESSION.length}`;
  updateTopBanner('Intrus', `Question ${intrusIndex + 1}/${INTRUS_SESSION.length}`, intrusFieldLabel);
  $('intrus-score-label').textContent = `${intrusCorrectCount} / ${intrusIndex} réponse${intrusCorrectCount > 1 ? 's' : ''} correcte${intrusCorrectCount > 1 ? 's' : ''}`;
  updateTopBannerScore(`${intrusCorrectCount}/${intrusIndex}`);
  $('intrus-progress-bar').style.width = `${(intrusIndex / INTRUS_SESSION.length) * 100}%`;
  $('intrus-correction').classList.add('hidden');
  $('intrus-choices').classList.remove('hidden');

  const promptCard = $('intrus-prompt-card');
  if (intrusMode === 'image') {
    // Les 3 images (choix) occupent la grande zone de gauche, en plus grand ; la référence à
    // retrouver s'affiche à droite, avec le même espacement de rubrique que la correction.
    // Tailles relatives (racine carrée de la hauteur réelle, compressée entre un minimum et un
    // maximum) plutôt que 3 vignettes uniformes — on retrouve un peu le sens des proportions
    // réelles entre les œuvres comparées, sans rendre la plus petite illisible.
    const sizes = relativeImageSizes(q.choices);
    promptCard.innerHTML = `<div class="intrus-image-choices">${q.choices.map((c, i) =>
      `<button type="button" class="intrus-image-choice" data-index="${i}"><img src="${escapeHtml(imageSourceSized(c.image, 300))}" alt="" style="max-width:${sizes[i]}px;max-height:${sizes[i]}px;" /></button>`
    ).join('')}</div>`;
    promptCard.querySelectorAll('.intrus-image-choice').forEach((btn) => {
      btn.addEventListener('click', () => intrusAnswer(Number(btn.dataset.index)));
    });
    $('intrus-choices').innerHTML = `<div class="correction-details">
      <span class="correction-label">Auteur</span><span class="correction-value">${formatArtistDisplayName(q.correct)}</span>
      <span class="correction-label">Titre de l'œuvre</span><span class="correction-value"><em>« ${escapeHtml(q.correct.title)} »</em></span>
    </div>`;
    intrusSpeak(`${q.correct.artist} — « ${q.correct.title} »`);
  } else {
    // Image en haut à gauche. Choix à droite : le plus souvent le nom du peintre seul (le cas
    // le plus exigeant), parfois artiste + titre pour varier (q.titleMode).
    promptCard.innerHTML = `<img src="${escapeHtml(imageSourceSized(q.correct.image, 700))}" alt="" style="max-width:100%;max-height:min(820px,74vh);display:block;" />`;
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

// Reconstruit la correction affichée à partir de l'état courant (rubriques choisies + bascule
// « correction complète ») — fonction isolée, sans effet de bord sur le score ou la voix, pour
// pouvoir la rappeler en toute sécurité dès qu'on active/désactive la correction complète.
function intrusRefreshCorrectionDetails() {
  const q = INTRUS_SESSION[intrusIndex];
  if (!q) return;
  const dims = formatDimensionsDisplay(q.correct);
  const detailsParts = [];
  detailsParts.push(`<span class="correction-label">Auteur</span><span class="correction-value">${formatArtistDisplayName(q.correct)}</span>`);
  detailsParts.push(`<span class="correction-label">Titre de l'œuvre</span><span class="correction-value"><em>«\u00a0${escapeHtml(q.correct.title)}\u00a0»</em></span>`);
  if (showFullCorrection || intrusExtraFields.includes('date')) detailsParts.push(`<span class="correction-label">Date</span><span class="correction-value">${escapeHtml(q.correct.date || '—')}</span>`);
  if ((showFullCorrection || intrusExtraFields.includes('materiaux')) && q.correct.materials) detailsParts.push(`<span class="correction-label">Matériau</span><span class="correction-value">${escapeHtml(q.correct.materialsPhrase || q.correct.materials)}</span>`);
  if ((showFullCorrection || intrusExtraFields.includes('dimensions')) && dims) detailsParts.push(`<span class="correction-label">Dimensions</span><span class="correction-value">${dims}</span>`);
  if (showFullCorrection || intrusExtraFields.includes('location')) detailsParts.push(`<span class="correction-label">Lieu</span><span class="correction-value">${locationWithFlag(q.correct) || '—'}</span>`);
  $('intrus-correction-details').innerHTML = detailsParts.join('');
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
    if (kept) {
      kept.classList.add('intrus-image-choice-solo');
      // Bug réel repéré : la taille relative (max-width/max-height posée en direct sur l'image
      // pendant la comparaison) restait accrochée à l'image une fois la correction affichée,
      // empêchant la règle CSS "-solo" (plein écran) de reprendre la main — l'inline gagne
      // toujours sur la classe pour une même propriété. On l'efface explicitement ici.
      const img = kept.querySelector('img');
      if (img) { img.style.maxWidth = ''; img.style.maxHeight = ''; }
    }
    // On ne garde plus la référence initiale (Auteur/Titre) affichée à droite : juste le verdict.
    $('intrus-choices').innerHTML = `<p style="text-align:center;font-family:Arial,sans-serif;font-weight:700;font-size:1.1rem;color:${isCorrect ? 'var(--ok)' : 'var(--wrong)'}">${isCorrect ? 'Exact' : 'À réviser'}</p>`;
  }

  intrusSpeak(spokenFullReference(q.correct, showFullCorrection ? null : intrusExtraFields));
  intrusRefreshCorrectionDetails();
  $('intrus-correction').classList.remove('hidden');
  $('intrus-score-label').textContent = `${intrusCorrectCount} / ${intrusIndex + 1} réponse${intrusCorrectCount > 1 ? 's' : ''} correcte${intrusCorrectCount > 1 ? 's' : ''}`;
  updateTopBannerScore(`${intrusCorrectCount}/${intrusIndex + 1}`);
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
    showExerciseResultsModal('Intrus', intrusCorrectCount, INTRUS_SESSION.length, 'training-hub');
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
function selectedZones() { return ['france', 'italie', 'espagne', 'royaume_uni', 'allemagne', 'europe_centrale_russie', 'europe_nord', 'amerique'].filter((zone) => $(`zone-${zone}`)?.checked); }
const ZONE_LABELS = { france: 'France', italie: 'Italie', espagne: 'Espagne', royaume_uni: 'Royaume-Uni', allemagne: 'Allemagne', europe_centrale_russie: 'Europe centrale et Russie', europe_nord: 'Europe du Nord', amerique: 'Amérique' };
// Zone géographique déduite de la nationalité (colonne I, texte libre) : rattachement par
// sous-chaîne, dans le même esprit que NATIONALITY_FLAGS. Recentrage sur l'art occidental : plus
// de zone "Asie", et l'Europe est désormais détaillée par grande zone plutôt qu'un seul bloc.
const ZONE_BY_NATIONALITY_KEYWORD = {
  france: ['francaise', 'francais'],
  italie: ['italienne', 'italien'],
  espagne: ['espagnole', 'espagnol', 'catalane', 'catalan', 'portugaise', 'portugais'],
  royaume_uni: ['anglaise', 'anglais', 'britannique', 'ecossaise', 'ecossais', 'irlandaise', 'irlandais'],
  allemagne: ['allemande', 'allemand'],
  europe_centrale_russie: [
    'autrichienne', 'autrichien', 'suisse', 'russe', 'polonaise', 'polonais', 'tcheque', 'boheme',
    'hongroise', 'hongrois', 'ukrainienne', 'ukrainien', 'bulgare', 'bielorusse', 'croate',
    'grecque', 'grec', 'byzantine', 'byzantin', 'maltaise',
  ],
  europe_nord: [
    'danoise', 'danois', 'norvegienne', 'norvegien', 'suedoise', 'suedois', 'finlandaise', 'finlandais',
    'hollandaise', 'hollandais', 'neerlandaise', 'neerlandais', 'flamande', 'flamand', 'belge',
  ],
  amerique: ['americaine', 'americain', 'mexicaine', 'mexicain', 'canadienne', 'canadien', 'bresilienne', 'bresilien', 'argentine'],
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

// Cache des fichiers déjà téléchargés (clé = URL), avec déduplication des requêtes en vol : un
// fichier n'est jamais téléchargé deux fois, et si plusieurs appels arrivent PENDANT qu'un
// téléchargement est encore en cours (ex. le joueur clique plusieurs fois sur « Lancer » de suite
// avant que le premier chargement ait fini), ils partagent tous la même requête au lieu d'en
// déclencher chacun une nouvelle en parallèle — c'est ce qui rendait les boutons lents et
// capricieux : plusieurs téléchargements complets du même gros fichier se disputaient la bande
// passante en même temps.
const quizRowsCache = new Map();
async function fetchQuizRows(art, century) {
  // Un seul fichier par (art, siècle) désormais : le filtrage par niveau se fait côté appli via
  // la colonne "Niveau" de chaque ligne (voir plus bas), plus de suffixe "-niveauX" dans l'URL.
  const url = `quizzes/${art}-${century}.xlsx`;
  if (quizRowsCache.has(url)) return quizRowsCache.get(url);
  const promise = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('fichier introuvable');
    const buffer = await response.arrayBuffer();
    const book = XLSX.read(buffer, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
    return normaliseRows(rows).map((q) => ({ ...q, art }));
  })();
  quizRowsCache.set(url, promise);
  try {
    const cached = await promise;
    return [...cached]; // copie superficielle : chaque appelant peut trier/modifier son propre
    // tableau (ex. mélanger l'ordre des questions) sans jamais altérer le cache partagé par les
    // autres appels — seul le contenu (déjà téléchargé et lu) est réutilisé, pas la structure.
  } catch (error) {
    quizRowsCache.delete(url); // un échec ne doit pas rester en cache : on retentera la prochaine fois
    throw error;
  }
}

let quizFieldLabel = '';
$('launch-quiz-button')?.addEventListener('click', async () => {
  let arts = selectedArts(); if (!arts.length) arts = ['peinture', 'sculpture'];
  let centuries = selectedCenturies(); if (!centuries.length) centuries = ['14e','15e','16e','17e','18e','19e','20e'];
  quizFieldLabel = buildFieldLabel(arts, centuries);
  let levels = selectedLevels(); if (!levels.length) levels = ['1','2','3'];
  let chosenKeys = allFields.filter((field) => $(field.checkbox).checked).map((field) => field.key);
  if (!chosenKeys.length) chosenKeys = allFields.map((field) => field.key);
  const feedback = $('launch-feedback');
  feedback.classList.remove('hidden');
  saveLastSelection('quiz-setup-panel');
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
    // Si un ou plusieurs artistes précis ont été choisis dans « Mes choix de champ » (à la place
    // d'art/siècle/zone, effacés automatiquement dans ce cas), on ne garde que leurs œuvres.
    levelFilteredRows = filterPoolByGlobalArtists(levelFilteredRows, allRows);
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
    $('quiz-ready-screen').classList.remove('hidden');
    $('quiz-quiz-grid').classList.add('hidden');
    $('bg-mosaic').classList.remove('hidden');
    populateSessionMosaic(state.questions.map((q) => q.image));
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
$('lightbox-close-button')?.addEventListener('click', () => { $('image-lightbox').classList.add('hidden'); setLightboxScaleData(null); });
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
