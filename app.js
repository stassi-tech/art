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

function updateAccountBar() {
  const statusEl = $('account-status');
  const loginBtn = $('account-login-button');
  const logoutBtn = $('account-logout-button');
  const pageBtn = $('account-page-button');
  if (!statusEl) return;
  if (!firebaseReady) {
    statusEl.textContent = "Comptes non configurés pour l'instant";
    loginBtn.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    pageBtn.classList.add('hidden');
    return;
  }
  if (currentUser) {
    statusEl.textContent = `Connecté : ${currentUser.email}`;
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    pageBtn.classList.remove('hidden');
  } else {
    statusEl.textContent = 'Non connecté';
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    pageBtn.classList.add('hidden');
    if (!$('account-panel')?.classList.contains('hidden')) showPanel('welcome'); // déconnecté pendant qu'on consultait « Mon compte »
  }
  // La page de résultats affiche « Voir mes résultats » / « Télécharger mon bilan » selon la connexion.
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
      errorEl.textContent = "Indiquez d'abord votre adresse e-mail dans le champ ci-dessus, puis recliquez sur « Mot de passe oublié ? ».";
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
      correct, possible, percent,
      questionCount: state.questions.length,
      quizLabel: config.label || 'Quiz',
      quizLevel: config.level || '',
      quizSignature: config.signature || config.label || 'quiz',
      quizArts: config.arts || [],
      quizCenturies: config.centuries || [],
      quizRubriques: config.rubriques || [],
      perField,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    if (statusEl) { statusEl.textContent = 'Score enregistré automatiquement sur votre compte.'; statusEl.classList.remove('hidden'); }
  } catch (error) {
    if (statusEl) { statusEl.textContent = "Le score n'a pas pu être enregistré automatiquement."; statusEl.classList.remove('hidden'); }
  }
}

// --- Page « Mon compte » : historique complet, groupé par type de quiz, avec évolution ---
async function fetchScoreLevelGroups() {
  if (!firebaseReady || !currentUser) return null;
  const snapshot = await db.collection('users').doc(currentUser.uid).collection('scores')
    .orderBy('createdAt', 'asc').get(); // ordre chronologique croissant : pratique pour calculer l'évolution
  if (snapshot.empty) return new Map();
  const levelGroups = new Map(); // niveau -> liste des scores (docs Firestore)
  snapshot.docs.forEach((doc) => {
    const d = { id: doc.id, ...doc.data() };
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
      return `<tr>
        <td>${escapeHtml(dateLabel)}</td>
        <td class="col-contenu">${escapeHtml(contentLabel)}</td>
        <td>${levelNum ? `Niveau ${levelNum}` : '—'}</td>
        <td class="rubriques-tested">${escapeHtml(rubriquesText)}</td>
        <td><strong>${entry.correct} / ${entry.possible} (${entry.percent} %)</strong></td>
        <td>${evolutionHtml}</td>
        <td><button type="button" class="delete-score-button" data-doc-id="${entry.id}" title="Éliminer ce résultat" aria-label="Éliminer ce résultat">✕</button></td>
      </tr>`;
    });
    // Le plus récent en premier, plus naturel à lire.
    groupsBox.innerHTML = `<div class="account-table-scroll"><table class="account-table">
      <thead><tr><th>Date</th><th class="col-contenu">Contenu</th><th>Niveau</th><th>Rubriques</th><th>Score</th><th>Évolution</th><th></th></tr></thead>
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
  if (!confirm('Supprimer définitivement ce résultat de quiz ?')) return;
  try {
    await db.collection('users').doc(currentUser.uid).collection('scores').doc(docId).delete();
    loadAccountPage();
  } catch (error) {
    alert('Impossible de supprimer ce résultat pour le moment.');
  }
}
$('account-page-button')?.addEventListener('click', () => { showPanel('account'); loadAccountPage(); });
$('account-page-back-button')?.addEventListener('click', () => showPanel('welcome'));

const allFields = [
  { key: 'artist', label: 'Artiste', input: 'artist-input', checkbox: 'rubrique-artist' },
  { key: 'title', label: "Titre de l'œuvre", input: 'title-input', checkbox: 'rubrique-title' },
  { key: 'date', label: 'Date de création', input: 'date-input', checkbox: 'rubrique-date' },
  { key: 'location', label: 'Lieu de conservation', input: 'location-input', checkbox: 'rubrique-location' }
];
function activeFields() { return allFields.filter((field) => state.selectedFieldKeys.includes(field.key)); }

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceSupported = Boolean(SpeechRecognitionImpl);
if (voiceSupported) {
  $('mic-global').classList.remove('hidden');
  $('mic-hint').classList.remove('hidden');
}
// Un seul bouton micro sert les 4 rubriques : il dicte dans le champ actuellement sélectionné
// (touché/cliqué), et suit automatiquement le focus si on passe à un autre champ pendant l'écoute.
// La dictée reste active en continu, d'une question à l'autre, tant qu'on ne tape rien manuellement.
let activeRecognition = null;
let micIsListening = false;
let manualStopRequested = false;
let focusedFieldKey = null;
function updateFieldHighlight() {
  allFields.forEach(({ key, input }) => {
    $(input)?.closest('label')?.classList.toggle('field-target', key === focusedFieldKey);
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
  button.textContent = '🎤 Appuyez pour dicter';
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
  button.classList.add('listening'); button.textContent = 'Parlez'; micIsListening = true;
  activeRecognition = recognition;
  const forget = () => { resetMicButton(); if (activeRecognition === recognition) activeRecognition = null; };
  recognition.addEventListener('result', (event) => {
    // Pas de focus() ici : sur smartphone, focus() ouvre le clavier virtuel automatiquement.
    const target = currentDictationTarget();
    if (!target) return;
    const last = event.results[event.results.length - 1];
    $(target.input).value = last[0].transcript.trim();
    scheduleAutoAdvance(target.key);
  });
  recognition.addEventListener('end', () => {
    if (manualStopRequested || activeRecognition !== recognition) return;
    // Certains navigateurs referment la session après un silence ou au bout d'un moment :
    // on la relance automatiquement pour que la dictée reste active « sur plusieurs pages ».
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
// Passage automatique au champ suivant : si un texte est inscrit (au clavier ou dicté au micro)
// et qu'il n'est plus modifié pendant 2 secondes, le curseur avance tout seul vers la rubrique suivante.
const advanceTimers = {};
function clearAdvanceTimers() {
  Object.values(advanceTimers).forEach(clearTimeout);
  Object.keys(advanceTimers).forEach((key) => delete advanceTimers[key]);
}
function scheduleAutoAdvance(key) {
  if (advanceTimers[key]) clearTimeout(advanceTimers[key]);
  const field = allFields.find((f) => f.key === key);
  if (!field) return;
  const value = $(field.input).value.trim();
  if (!value) return;
  advanceTimers[key] = setTimeout(() => {
    delete advanceTimers[key];
    const fields = activeFields();
    const currentIndex = fields.findIndex((f) => f.key === key);
    const next = fields[currentIndex + 1];
    if (next) setFocusedField(next.key, { focusInput: !micIsListening }); // le micro suit sans rouvrir le clavier
  }, 2000);
}
allFields.forEach(({ key, input }) => {
  $(input).addEventListener('input', () => {
    if (micIsListening) stopActiveDictation(); // taper manuellement arrête la dictée continue
    scheduleAutoAdvance(key);
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
    if (!imageKey) throw new Error("La colonne « image » est introuvable dans ce fichier.");

    // --- Identité de l'artiste : nouvelle structure (Prénom/Patronyme/Surnom) si présente,
    // sinon on retombe sur l'ancienne colonne unique « Artiste » pour rester compatible avec
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
      if (!legacyArtistKey) throw new Error("Ni « Prénom/Patronyme », ni « Artiste » n'ont été trouvés dans ce fichier.");
      artist = String(row[legacyArtistKey] || '').trim();
    }

    // --- Dates de naissance/mort : nouvelle structure à deux colonnes si présente, sinon ancienne
    // colonne combinée « dates artiste ». Règle : si l'une des deux dates manque, on n'affiche
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
    if (!dateKey) throw new Error("La colonne « date de création » est introuvable dans ce fichier.");

    // --- Lieu : nouvelle structure Ville/Lieu précis/Sous-lieu si présente, sinon ancienne
    // colonne unique « lieu de conservation ». Affichage : Sous-lieu, Lieu précis, Ville.
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
      if (!legacyLocationKey) throw new Error("Ni « Ville/Lieu précis », ni « Lieu de conservation » n'ont été trouvés dans ce fichier.");
      location = String(row[legacyLocationKey] || '').trim();
    }

    // --- Titre : nouvelle structure Titre (français) + Cycle + Titre (langue d'origine), sinon
    // ancienne colonne unique « titre de l'œuvre ». Les guillemets déjà présents dans le fichier
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
      if (!legacyTitleKey) throw new Error("Ni « Titre (français) », ni « Titre de l'œuvre » n'ont été trouvés dans ce fichier.");
      title = stripQuotes(row[legacyTitleKey]);
    }

    const materialsKey = findColumn(row, ['materiaux et technique', 'materiaux', 'technique', 'materials', 'materiau']);
    const materials = materialsKey ? String(row[materialsKey] || '').trim() : '';

    // --- Dimensions : nouvelle structure Hauteur/Longueur/Profondeur si présente, sinon ancienne
    // colonne unique « dimensions » (repliée dans hauteur/longueur via une expression régulière).
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
      artistDates, materials, hauteur, longueur, profondeur, nationality, niveau,
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
  // Dates : uniquement pour le champ « date de création ». Si on appliquait cette règle à tous
  // les champs, un titre contenant une année (« Le 3 mai 1810 », « ... en 1890 ») basculerait à
  // tort en comparaison d'année au lieu d'une comparaison de texte normale.
  if (fieldKey === 'date') {
    const targetYears = yearsOf(target);
    if (targetYears.length) {
      const answerYears = yearsOf(answer);
      if (!answerYears.length) return false;
      return targetYears.some((targetYear) => answerYears.some((answerYear) => withinDateTolerance(targetYear, answerYear)));
    }
  }
  // Accepte un élément significatif de la réponse attendue : « Monet » ou « Orsay ».
  if (answer.length >= 3 && (target.includes(answer) || answer.includes(target))) return true;
  // Tolérance orthographique sur la réponse complète (accents, lettre en trop/en moins, inversion).
  if (isCloseEnough(answer, target)) return true;
  const targetWords = target.split(' ').filter(Boolean);
  const answerWords = answer.split(' ').filter(Boolean);
  // Réponse en un mot avec une faute (ex. « Monnet » pour « Claude Monet »).
  if (answerWords.length === 1 && targetWords.some((word) => word.length >= 4 && isCloseEnough(answer, word))) return true;
  // Réponse partielle en plusieurs mots avec une faute (ex. « Van Googh » pour « Vincent van Gogh »).
  if (answerWords.length > 1 && answerWords.length < targetWords.length) {
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
function showPanel(name) {
  // name: 'welcome' | 'quiz' | 'results' | 'account' — centralise l'affichage des panneaux et de
  // la barre latérale (titre + import), visible uniquement sur la page d'accueil.
  $('welcome-panel').classList.toggle('hidden', name !== 'welcome');
  $('quiz-panel').classList.toggle('hidden', name !== 'quiz');
  $('results-panel').classList.toggle('hidden', name !== 'results');
  $('account-panel')?.classList.toggle('hidden', name !== 'account');
  $('sidebar').classList.toggle('hidden', name !== 'welcome');
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
  clearAdvanceTimers(); // pas d'avance automatique différée qui tomberait sur la mauvaise question
  document.body.classList.remove('has-other-works'); // repart d'un état propre à chaque question
  const question = state.questions[state.index]; const answer = answerFor(state.index);
  const modeLabel = state.mode === 'review' ? 'Révision des erreurs — ' : '';
  $('question-count').textContent = `${modeLabel}Question ${state.index + 1} sur ${state.questions.length}`;
  $('progress-bar').style.width = `${((state.index + 1) / state.questions.length) * 100}%`;
  const possible = checkedQuestions() * activeFields().length;
  $('score-summary').textContent = `${totalCorrect()} / ${possible} point${totalCorrect() > 1 ? 's' : ''}`;
  displayArtworkImage(question, `Œuvre ${state.index + 1}`, answer.checked);
  allFields.forEach(({ key, input }) => {
    const wrapper = $(input).closest('label');
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
    // sur mobile, focus() rouvrirait le clavier à chaque clic sur « Suivante ».
    const first = activeFields()[0];
    if (first) setFocusedField(first.key, { focusInput: false, scroll: false });
    // La nouvelle question repart du haut de la page (l'image d'abord), plutôt que de rester
    // défilée là où on s'était arrêté sur la question précédente.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('previous-button').disabled = state.index === 0;
  $('next-button').textContent = state.index === state.questions.length - 1 ? 'Voir le score' : 'Suivante →';
}
function formatArtistName(name) {
  // Convention des légendes muséales : prénom normal, nom de famille en MAJUSCULES
  // (ex. « Auguste RENOIR »). Heuristique : le dernier mot est considéré comme le nom de famille.
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
  // en italique entre guillemets : « Prénom NOM, dit "Surnom" ». Pour les mononymes sans nom
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
  // manuscrit ou une série de fresques), on ajoute « extrait du "Cycle" », lui aussi en italique.
  const titlePart = `<em>"${escapeHtml(work.title)}"</em>`;
  if (!work.cycle) return titlePart;
  return `${titlePart}, extrait du <em>"${escapeHtml(work.cycle)}"</em>`;
}
function formatDimensionsDisplay(work) {
  // Hauteur/Longueur/Profondeur viennent directement de colonnes séparées : chacune, quand elle
  // est renseignée, est précédée d'un petit "h"/"l"/"p" en grisé. Rien n'est affiché pour une
  // dimension non précisée plutôt que d'inventer une valeur.
  const parts = [];
  if (work.hauteur) parts.push(`<span class="dim-hl">h</span> ${escapeHtml(work.hauteur)}`);
  if (work.longueur) parts.push(`<span class="dim-hl">l</span> ${escapeHtml(work.longueur)}`);
  if (work.profondeur) parts.push(`<span class="dim-hl">p</span> ${escapeHtml(work.profondeur)}`);
  return parts.join(' × ');
}
let correctionMainWork = null; // œuvre actuellement affichée en grand dans la correction (question testée, ou une « autre œuvre » cliquée)
function renderCorrectionDetails(testedQuestion, displayedWork, answer) {
  const isTestedWork = displayedWork === testedQuestion;
  displayArtworkImage(displayedWork, isTestedWork ? `Œuvre ${state.index + 1}` : `Autre œuvre du même peintre : ${displayedWork.title}`, true);
  $('correction-details').innerHTML = allFields.map(({ key, label }) => {
    let value;
    if (key === 'artist') value = formatArtistWithDates(displayedWork);
    else if (key === 'title') value = formatTitleWithCycle(displayedWork);
    else value = formatCorrectionValue(key, displayedWork[key]);
    // Une « autre œuvre » cliquée n'a pas été répondue par l'utilisateur : on l'affiche
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
    // juste après la ligne « date de création ».
    if (key === 'date') {
      if (displayedWork.materials) html += correctionInfoRow('Matériaux et technique', displayedWork.materials);
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
  // autres pour aider à les mémoriser ensemble. Recherche sur l'ensemble du quiz chargé, pas
  // seulement les questions déjà vues.
  const otherWorks = state.fullQuestions
    .filter((otherQuestion) => otherQuestion !== question && keyName(otherQuestion.artist) === keyName(question.artist))
    .sort((a, b) => {
      // Tri chronologique ascendant, à partir de la première année détectable dans la date.
      // Les dates sans année exploitable sont placées à la fin.
      const yearA = yearsOf(a.date)[0]; const yearB = yearsOf(b.date)[0];
      if (yearA == null && yearB == null) return 0;
      if (yearA == null) return 1;
      if (yearB == null) return -1;
      return yearA - yearB;
    });
  const otherWorksBox = $('other-works');
  if (!otherWorks.length) {
    otherWorksBox.classList.add('hidden');
    document.body.classList.remove('has-other-works');
    return;
  }
  $('other-works-list').innerHTML = otherWorks.map((otherQuestion, index) => {
    const source = imageSource(otherQuestion.image);
    const titleValue = formatCorrectionValue('title', otherQuestion.title);
    return `<button type="button" class="other-work-card" data-index="${index}">
      <img src="${escapeHtml(source)}" alt="" loading="lazy" data-original="${escapeHtml(source)}"
           onerror="if(!this.dataset.fallbackTried){this.dataset.fallbackTried='1';this.src='https://images.weserv.nl/?url='+encodeURIComponent(this.dataset.original)+'&w=300';}" />
      <span class="other-work-caption"><strong>${titleValue}</strong><br>${escapeHtml(otherQuestion.date)} — ${escapeHtml(otherQuestion.location)}</span>
    </button>`;
  }).join('');
  otherWorksBox.querySelectorAll('.other-work-card').forEach((button) => {
    button.addEventListener('click', () => {
      const work = otherWorks[Number(button.dataset.index)];
      const showingThisOne = correctionMainWork === work;
      const target = showingThisOne ? question : work; // recliquer sur la même œuvre revient à la question testée
      correctionMainWork = target;
      renderCorrectionDetails(question, target, answer);
      otherWorksBox.querySelectorAll('.other-work-card').forEach((b) => b.classList.remove('active'));
      if (!showingThisOne) button.classList.add('active');
    });
  });
  otherWorksBox.classList.remove('hidden');
  document.body.classList.add('has-other-works');
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
$('back-home-from-quiz')?.addEventListener('click', () => showPanel('welcome'));
$('back-home-from-results')?.addEventListener('click', () => showPanel('welcome'));

// --- Sélecteur de quiz par art / siècle / rubriques / niveau ---
const ART_LABELS = { peinture: 'Peinture', sculpture: 'Sculpture' };
const CENTURY_LABELS = { '14e': '14e siècle', '15e': '15e siècle', '16e': '16e siècle', '17e': '17e siècle', '18e': '18e siècle', '19e': '19e siècle', '20e': '20e siècle' };
const LEVEL_LABELS = { '1': 'Niveau 1', '2': 'Niveau 2', '3': 'Niveau 3' };
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
// Parcours guidé : les 4 fenêtres de choix s'enchaînent automatiquement (Suivant / Précédent),
// pour ne rien oublier. Mais si on arrive dans une fenêtre via "Modifier" depuis le récapitulatif
// final, on ne veut PAS relancer toute la chaîne (art → siècle → rubriques → niveau) : un clic sur
// Suivant/Précédent doit alors revenir directement au récapitulatif. `editingFromSummary` retient
// ce contexte le temps d'une seule fenêtre.
let editingFromSummary = false;
function goToModal(fromId, toId) {
  closeModal(fromId);
  updateSelectorSummaries();
  if (editingFromSummary) { editingFromSummary = false; showQuizSummary(); return; }
  openModal(toId);
}
$('select-choices')?.addEventListener('click', () => openModal('modal-art'));
$('art-next')?.addEventListener('click', () => goToModal('modal-art', 'modal-century'));
$('century-prev')?.addEventListener('click', () => goToModal('modal-century', 'modal-art'));
$('century-next')?.addEventListener('click', () => goToModal('modal-century', 'modal-rubriques'));
$('rubriques-prev')?.addEventListener('click', () => goToModal('modal-rubriques', 'modal-century'));
$('rubriques-next')?.addEventListener('click', () => goToModal('modal-rubriques', 'modal-level'));
$('level-prev')?.addEventListener('click', () => goToModal('modal-level', 'modal-rubriques'));
$('level-finish')?.addEventListener('click', () => { editingFromSummary = false; updateSelectorSummaries(); showQuizSummary(); });
function showQuizSummary() {
  $('quiz-selectors-grid')?.classList.add('hidden');
  $('select-choices')?.classList.add('hidden');
  $('quiz-summary')?.classList.remove('hidden');
  $('recap-art').textContent = `🎨 Art : ${$('summary-art').textContent}`;
  $('recap-century').textContent = `🏛️ Siècle et zone : ${$('summary-century').textContent}`;
  $('recap-rubriques').textContent = `📝 Rubriques : ${$('summary-rubriques').textContent}`;
  $('recap-level').textContent = `⭐ Niveau et questions : ${$('summary-level').textContent}`;
}
// Les liens "Modifier" du récapitulatif ouvrent directement la fenêtre concernée. Peu importe où
// elle se trouve dans la chaîne : le drapeau ci-dessus fait qu'on revient droit au récapitulatif
// ensuite, sans repasser par les autres fenêtres.
document.querySelectorAll('#quiz-summary .link-label').forEach((button) => {
  button.addEventListener('click', () => { editingFromSummary = true; openModal(button.dataset.modal); });
});
document.querySelectorAll('.modal-close').forEach((button) => {
  button.addEventListener('click', () => { closeModal(button.dataset.modal); updateSelectorSummaries(); });
});
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (event) => { if (event.target === overlay) { overlay.classList.add('hidden'); updateSelectorSummaries(); } });
});
$('open-art')?.addEventListener('click', () => openModal('modal-art'));
$('open-century')?.addEventListener('click', () => openModal('modal-century'));
$('open-zone')?.addEventListener('click', () => openModal('modal-century')); // zone fusionnée dans la modale siècle
$('open-rubriques')?.addEventListener('click', () => openModal('modal-rubriques'));
$('open-level')?.addEventListener('click', () => openModal('modal-level'));

// Avertissement affiché une seule fois par session dès que le 20e siècle est coché : les
// artistes morts après 1955 ne sont pas représentés, pour des raisons de droits d'auteur.
let century20eNoticeShown = false;
$('century-20e')?.addEventListener('change', (event) => {
  if (event.target.checked && !century20eNoticeShown) {
    century20eNoticeShown = true;
    openModal('modal-century-20e-notice');
  }
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
function selectedLevel() { const checked = document.querySelector('input[name="niveau"]:checked'); return checked ? checked.value : null; }
function selectedQuestionCount() { const checked = document.querySelector('input[name="nb-questions"]:checked'); return checked ? checked.value : '30'; }
function updateSelectorSummaries() {
  const arts = selectedArts();
  $('summary-art').textContent = arts.length ? arts.map((a) => ART_LABELS[a]).join(', ') : 'Aucun art choisi';
  const centuries = selectedCenturies();
  const zones = selectedZones();
  // Zone désormais choisie dans la même modale que le siècle : les deux s'affichent ensemble
  // dans le résumé du bouton "Choisissez votre siècle".
  const centuryText = centuries.length ? centuries.map((c) => CENTURY_LABELS[c]).join(', ') : 'Aucun siècle choisi';
  const zoneText = zones.length ? ` · ${zones.map((z) => ZONE_LABELS[z]).join(', ')}` : '';
  $('summary-century').textContent = centuryText + zoneText;
  const rubriques = allFields.filter((field) => $(field.checkbox).checked).map((field) => field.label);
  $('summary-rubriques').textContent = rubriques.length ? rubriques.join(', ') : 'Aucune rubrique choisie';
  const level = selectedLevel();
  const count = selectedQuestionCount();
  const countText = count === 'max' ? 'maximum disponible' : `${count} questions`;
  $('summary-level').textContent = level ? `${LEVEL_LABELS[level]} — ${countText}` : 'Aucun niveau choisi';
}
updateSelectorSummaries();

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
  const level = selectedLevel();
  const chosenKeys = allFields.filter((field) => $(field.checkbox).checked).map((field) => field.key);
  const feedback = $('launch-feedback');
  feedback.classList.remove('hidden');
  if (!arts.length) { feedback.textContent = 'Choisissez au moins un art (« Choisissez votre art »).'; return; }
  if (!centuries.length) { feedback.textContent = 'Choisissez au moins un siècle (« Choisissez votre siècle »).'; return; }
  if (!level) { feedback.textContent = 'Choisissez un niveau (« Choisissez votre niveau »).'; return; }
  if (!chosenKeys.length) { feedback.textContent = 'Choisissez au moins une rubrique à réviser (« Choisissez vos rubriques »).'; return; }
  feedback.textContent = 'Chargement du quiz…';
  try {
    if (!window.XLSX) throw new Error('Le module de lecture Excel n’a pas été chargé. Vérifiez votre connexion Internet et rechargez la page.');
    const zones = selectedZones();
    const allRows = [];
    const missing = []; // combinaisons art/siècle sans fichier du tout : signalées, sans bloquer le quiz
    // Un seul fichier par (art, siècle) désormais ; le niveau ne détermine plus quel fichier
    // charger, seulement quelles lignes en garder (colonne "Niveau", filtrage cumulatif juste
    // après). Les niveaux supérieurs incluent déjà les niveaux inférieurs dans le fichier.
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
    // Filtre par niveau (cumulatif) : le niveau 2 inclut les œuvres marquées niveau 1, etc.
    let levelFilteredRows = allRows.filter((r) => (r.niveau || 1) <= parseInt(level, 10));
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
    const effectiveLevelLabel = `${LEVEL_LABELS[level] || 'Niveau'} — ${targetCount} questions`;
    const rubriqueLabels = chosenKeys.map((key) => allFields.find((f) => f.key === key)?.label || key);
    // Repère court affiché en haut de l'écran de quiz et de correction, ex. "30 questions sur la
    // peinture du 18e siècle" — distinct de `label` (utilisé pour l'historique des scores).
    const artsLower = arts.map((a) => ART_LABELS[a].toLowerCase()).join(' + ');
    const centuriesText = centuries.map((c) => CENTURY_LABELS[c]).join(', ');
    const zoneText = zones.length ? ` (${zones.map((z) => ZONE_LABELS[z]).join(', ')})` : '';
    const quizReference = `${targetCount} questions sur la ${artsLower} du ${centuriesText}${zoneText}`;
    state.quizConfig = {
      arts: arts.map((a) => ART_LABELS[a]),
      centuries: centuries.map((c) => CENTURY_LABELS[c]),
      level: effectiveLevelLabel,
      rubriques: rubriqueLabels,
      label: `${arts.map((a) => ART_LABELS[a]).join(' + ')} · ${centuries.map((c) => CENTURY_LABELS[c]).join(', ')} · ${rubriqueLabels.join(', ')}`,
      reference: quizReference,
      signature: `${arts.slice().sort().join(',')}|${centuries.slice().sort().join(',')}|${level}-${targetCount}|${chosenKeys.slice().sort().join(',')}`,
    };
    const refEl = $('quiz-reference');
    if (refEl) refEl.textContent = quizReference;
    showPanel('quiz'); renderQuestion();
  } catch (error) {
    // Le message « site en construction » se suffit à lui-même, sans préfixe « Erreur : ».
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
  finalizeCurrentAnswer(); // note la réponse même si on ne clique jamais sur « Suivante »
  renderQuestion(); // affiche la correction ; on attend le clic sur « Suivante »
});
$('previous-button').addEventListener('click', () => {
  if (!answerFor(state.index).checked) saveInputs(); // ne pas écraser une réponse déjà validée (champs vidés depuis)
  if (state.index > 0) { state.index--; renderQuestion(); }
});
$('next-button').addEventListener('click', goToNextOrResults);
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
