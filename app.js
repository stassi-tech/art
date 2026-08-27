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
  // La page de résultats peut déjà être affichée : on synchronise ses boutons aussi.
  updateScoreSaveUi();
}

function setAccountMode(mode) {
  accountMode = mode;
  $('account-modal-title').textContent = mode === 'login' ? 'Se connecter' : 'Créer un compte';
  $('account-submit-button').textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
  $('account-toggle-mode').textContent = mode === 'login' ? 'Pas encore de compte ? Crée-en un' : 'Déjà un compte ? Connecte-toi';
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
      errorEl.textContent = "Indique d'abord ton adresse e-mail dans le champ ci-dessus, puis reclique sur « Mot de passe oublié ? ».";
      errorEl.classList.remove('hidden');
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      noticeEl.textContent = `Un e-mail de réinitialisation a été envoyé à ${email}. Vérifie ta boîte de réception (et les spams).`;
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

function updateScoreSaveUi() {
  const saveButton = $('save-score-button');
  const loginHint = $('save-score-login-hint');
  if (!saveButton) return;
  if (!firebaseReady) { saveButton.classList.add('hidden'); loginHint.classList.add('hidden'); return; }
  if (currentUser) { saveButton.classList.remove('hidden'); loginHint.classList.add('hidden'); }
  else { saveButton.classList.add('hidden'); loginHint.classList.remove('hidden'); }
}

async function saveCurrentScore() {
  if (!firebaseReady || !currentUser) return;
  const feedback = $('save-score-feedback');
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
      if (isMatch(answer[key], question[key], key)) perField[key].correct += 1;
    });
  });
  feedback.classList.remove('hidden');
  feedback.textContent = 'Enregistrement…';
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
    feedback.textContent = 'Score enregistré !';
    $('save-score-button').classList.add('hidden');
    loadMyScores();
  } catch (error) {
    feedback.textContent = "Impossible d'enregistrer le score pour le moment.";
  }
}
$('save-score-button')?.addEventListener('click', saveCurrentScore);

async function loadMyScores() {
  const box = $('my-scores-box'); const list = $('my-scores-list');
  if (!firebaseReady || !currentUser) { box.classList.add('hidden'); return; }
  try {
    const snapshot = await db.collection('users').doc(currentUser.uid).collection('scores')
      .orderBy('createdAt', 'desc').limit(5).get();
    if (snapshot.empty) { box.classList.add('hidden'); return; }
    list.innerHTML = snapshot.docs.map((doc) => {
      const d = doc.data();
      const date = d.createdAt ? d.createdAt.toDate().toLocaleDateString('fr-FR') : '';
      return `<li>${date} — ${d.quizLabel || 'Quiz'} (${d.quizLevel || ''}) — ${d.correct} / ${d.possible} (${d.percent} %)</li>`;
    }).join('');
    box.classList.remove('hidden');
  } catch (error) {
    box.classList.add('hidden');
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

    groupsBox.innerHTML = Array.from(levelGroups.entries()).map(([level, docs]) => {
      // Colonnes = contenus distincts rencontrés pour ce niveau (identifiés par leur signature
      // exacte art+siècles), dans l'ordre de première apparition.
      const contentOrder = [];
      docs.forEach((d) => { const sig = d.quizSignature || d.quizLabel || 'quiz'; if (!contentOrder.includes(sig)) contentOrder.push(sig); });

      // Une ligne par date calendaire ; s'il y a plusieurs essais le même jour pour un même
      // contenu, seul le dernier de la journée est affiché (simplification raisonnable).
      const cellByDateAndContent = new Map();
      const dateKeys = [];
      docs.forEach((d) => {
        const dateObj = d.createdAt ? d.createdAt.toDate() : new Date();
        const dateKey = dateObj.toISOString().slice(0, 10);
        const sig = d.quizSignature || d.quizLabel || 'quiz';
        if (!dateKeys.includes(dateKey)) dateKeys.push(dateKey);
        cellByDateAndContent.set(`${dateKey}|${sig}`, d);
      });
      dateKeys.sort();

      // Évolution : comparée à la dernière valeur rencontrée pour cette même colonne de contenu,
      // en suivant les dates dans l'ordre chronologique (les lignes vides pour ce contenu sont ignorées).
      const lastPercentByContent = {};
      // Chaque contenu occupe 4 colonnes : Peinture (siècles) / Sculpture (siècles) / Score / Évolution.
      const headerContentRow = contentOrder.map(() => '<th colspan="2">Contenu</th><th rowspan="2">Score</th><th rowspan="2">Évolution</th>').join('');
      const headerSubRow = contentOrder.map(() => '<th>Peinture</th><th>Sculpture</th>').join('');
      const bodyRows = dateKeys.map((dateKey) => {
        const dateLabel = new Date(dateKey + 'T00:00:00').toLocaleDateString('fr-FR');
        const cells = contentOrder.map((sig) => {
          const entry = cellByDateAndContent.get(`${dateKey}|${sig}`);
          if (!entry) return '<td></td><td></td><td></td><td></td>';
          const arts = entry.quizArts || [];
          const centuriesText = (entry.quizCenturies || []).join(', ');
          const peintureText = arts.includes('Peinture') ? centuriesText : '';
          const sculptureText = arts.includes('Sculpture') ? centuriesText : '';
          const rubriquesText = (entry.quizRubriques || []).join(', ');
          const scoreText = `${entry.correct} / ${entry.possible} (${entry.percent} %)${rubriquesText ? `<br><span class="rubriques-tested">${escapeHtml(rubriquesText)}</span>` : ''} <button type="button" class="delete-score-button" data-doc-id="${entry.id}" title="Supprimer ce résultat">✕</button>`;
          let evolutionHtml = '';
          if (lastPercentByContent[sig] !== undefined) {
            const diff = entry.percent - lastPercentByContent[sig];
            evolutionHtml = diff > 0 ? `<span class="evolution-up">▲ +${diff} pts</span>`
              : diff < 0 ? `<span class="evolution-down">▼ ${diff} pts</span>`
              : `<span class="evolution-flat">= stable</span>`;
          }
          lastPercentByContent[sig] = entry.percent;
          return `<td>${escapeHtml(peintureText)}</td><td>${escapeHtml(sculptureText)}</td><td>${scoreText}</td><td>${evolutionHtml}</td>`;
        }).join('');
        return `<tr><td>${dateLabel}</td>${cells}</tr>`;
      }).join('');

      return `<div class="account-group">
        <h3>${escapeHtml(level)}</h3>
        <div class="account-table-scroll">
        <table class="account-table">
          <thead>
            <tr><th rowspan="2">Date</th>${headerContentRow}</tr>
            <tr>${headerSubRow}</tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
        </div>
      </div>`;
    }).join('');
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
    const artistKey = findColumn(row, ['artiste', 'nom artiste', 'artist', 'auteur']);
    const dateKey = findColumn(row, ['date de creation', 'date creation', 'date', 'annee', 'année']);
    const locationKey = findColumn(row, ['lieu de conservation', 'lieu', 'conservation', 'musee', 'musée', 'location']);
    const titleKey = findColumn(row, ["titre de l oeuvre", 'titre oeuvre', 'titre', 'title', 'œuvre', 'oeuvre']);
    if (!imageKey || !artistKey || !dateKey || !locationKey || !titleKey) throw new Error("Les cinq en-têtes requis sont : image, artiste, date de création, lieu de conservation, titre de l'œuvre.");
    return { image: String(row[imageKey] || '').trim(), artist: String(row[artistKey] || '').trim(), date: String(row[dateKey] || '').trim(), location: String(row[locationKey] || '').trim(), title: String(row[titleKey] || '').trim(), row: rowIndex + 2 };
  }).filter((question) => question.image || question.artist || question.date || question.location || question.title);
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
function correctCount(answer, question) { return activeFields().reduce((count, field) => count + Number(isMatch(answer[field.key], question[field.key], field.key)), 0); }
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
let correctionMainWork = null; // œuvre actuellement affichée en grand dans la correction (question testée, ou une « autre œuvre » cliquée)
function renderCorrectionDetails(testedQuestion, displayedWork, answer) {
  const isTestedWork = displayedWork === testedQuestion;
  displayArtworkImage(displayedWork, isTestedWork ? `Œuvre ${state.index + 1}` : `Autre œuvre du même peintre : ${displayedWork.title}`, true);
  $('correction-details').innerHTML = allFields.map(({ key, label }) => {
    const value = formatCorrectionValue(key, displayedWork[key]);
    // Une « autre œuvre » cliquée n'a pas été répondue par l'utilisateur : on l'affiche
    // uniquement à titre d'information, sans notation ✓/✕.
    const tested = isTestedWork && state.selectedFieldKeys.includes(key);
    if (!tested) {
      return `<div class="correction-item correction-extra">
        <span class="correction-label">${label}${isTestedWork ? ' (info)' : ''}</span><span class="answer-result info">info</span>
        <strong class="correction-value">${value}</strong>
      </div>`;
    }
    const correct = isMatch(answer[key], displayedWork[key], key);
    return `<div class="correction-item">
      <span class="correction-label">${label}</span><span class="answer-result ${correct ? 'correct' : 'incorrect'}">${correct ? 'Correct' : 'À réviser'}</span>
      <strong class="correction-value">${value}</strong>
    </div>`;
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
  $('view-all-scores-button')?.classList.toggle('hidden', !firebaseReady || !currentUser);
  $('save-score-feedback').classList.add('hidden');
  updateScoreSaveUi();
  loadMyScores();
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
      const ok = isMatch(answer[key], question[key], key);
      lines.push(`   - ${label} : ${ok ? 'correct' : 'à revoir'} (réponse attendue : ${question[key]})`);
    });
  });
  return lines.join('\n');
}

$('excel-file').addEventListener('change', async (event) => {
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
    state.quizConfig = { label: 'Import manuel', level: 'Autre', rubriques: chosenKeys.map((key) => allFields.find((f) => f.key === key)?.label || key) };
    showPanel('quiz'); renderQuestion();
  } catch (error) { alert(`Import impossible : ${error.message}`); }
  event.target.value = '';
});

// --- Sélecteur de quiz par art / siècle / rubriques / niveau ---
const ART_LABELS = { peinture: 'Peinture', sculpture: 'Sculpture' };
const CENTURY_LABELS = { '14e': '14e siècle', '15e': '15e siècle', '16e': '16e siècle', '17e': '17e siècle', '18e': '18e siècle', '19e': '19e siècle', '20e': '20e siècle' };
const LEVEL_LABELS = { '1': 'Niveau 1 — 30 questions', '2': 'Niveau 2 — 60 questions', '3': 'Niveau 3 — 120 questions' };
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('.modal-close').forEach((button) => {
  button.addEventListener('click', () => { closeModal(button.dataset.modal); updateSelectorSummaries(); });
});
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (event) => { if (event.target === overlay) { overlay.classList.add('hidden'); updateSelectorSummaries(); } });
});
$('open-art')?.addEventListener('click', () => openModal('modal-art'));
$('open-century')?.addEventListener('click', () => openModal('modal-century'));
$('open-rubriques')?.addEventListener('click', () => openModal('modal-rubriques'));
$('open-level')?.addEventListener('click', () => openModal('modal-level'));

function selectedArts() { return ['peinture', 'sculpture'].filter((art) => $(`art-${art}`).checked); }
function selectedCenturies() { return ['14e', '15e', '16e', '17e', '18e', '19e', '20e'].filter((century) => $(`century-${century}`).checked); }
function selectedLevel() { const checked = document.querySelector('input[name="niveau"]:checked'); return checked ? checked.value : null; }
function updateSelectorSummaries() {
  const arts = selectedArts();
  $('summary-art').textContent = arts.length ? arts.map((a) => ART_LABELS[a]).join(', ') : 'Aucun art choisi';
  const centuries = selectedCenturies();
  $('summary-century').textContent = centuries.length ? centuries.map((c) => CENTURY_LABELS[c]).join(', ') : 'Aucun siècle choisi';
  const rubriques = allFields.filter((field) => $(field.checkbox).checked).map((field) => field.label);
  $('summary-rubriques').textContent = rubriques.length ? rubriques.join(', ') : 'Aucune rubrique choisie';
  const level = selectedLevel();
  $('summary-level').textContent = level ? LEVEL_LABELS[level] : 'Aucun niveau choisi';
}
updateSelectorSummaries();

const LEVEL_QUESTION_COUNTS = { '1': 30, '2': 60, '3': 120 };

async function fetchQuizRows(art, century, level) {
  const url = `quizzes/${art}-${century}-niveau${level}.xlsx`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('fichier introuvable');
  const buffer = await response.arrayBuffer();
  const book = XLSX.read(buffer, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
  return normaliseRows(rows);
}

$('launch-quiz-button')?.addEventListener('click', async () => {
  const arts = selectedArts();
  const centuries = selectedCenturies();
  const level = selectedLevel();
  const chosenKeys = allFields.filter((field) => $(field.checkbox).checked).map((field) => field.key);
  const feedback = $('launch-feedback');
  feedback.classList.remove('hidden');
  if (!arts.length) { feedback.textContent = 'Choisis au moins un art (« Choisis ton art »).'; return; }
  if (!centuries.length) { feedback.textContent = 'Choisis au moins un siècle (« Choisis ton siècle »).'; return; }
  if (!level) { feedback.textContent = 'Choisis un niveau (« Choisis ton niveau »).'; return; }
  if (!chosenKeys.length) { feedback.textContent = 'Choisis au moins une rubrique à réviser (« Choisis tes rubriques »).'; return; }
  feedback.textContent = 'Chargement du quiz…';
  try {
    if (!window.XLSX) throw new Error('Le module de lecture Excel n’a pas été chargé. Vérifiez votre connexion Internet et rechargez la page.');
    const allRows = [];
    const missing = []; // combinaisons art/siècle sans aucun fichier (à aucun niveau) : signalées, sans bloquer le quiz
    // Pour un niveau 3 demandé, on se rabat sur le niveau 2 puis le niveau 1 d'un même siècle
    // si le fichier niveau 3 n'existe pas, plutôt que d'écarter ce siècle du quiz.
    const fallbackLevels = level === '3' ? ['3', '2', '1'] : [level];
    for (const art of arts) {
      for (const century of centuries) {
        let found = false;
        for (const tryLevel of fallbackLevels) {
          try {
            allRows.push(...(await fetchQuizRows(art, century, tryLevel)));
            found = true;
            break; // premier niveau disponible pour cette combinaison : on s'arrête là
          } catch (error) { /* on tente le niveau de repli suivant */ }
        }
        if (!found) missing.push(`${ART_LABELS[art]} — ${CENTURY_LABELS[century]}`);
      }
    }
    if (!allRows.length) throw new Error('Ce site est en construction. Le quiz sera bientôt disponible.');
    if (missing.length) {
      alert(`Ce site est en construction pour : ${missing.join(', ')}. Le quiz continue avec les autres choix disponibles.`);
    }
    // Le niveau fixe le nombre de questions du quiz (30/60/120), même si plusieurs arts ou
    // siècles combinés fournissent davantage de questions au total : on mélange puis on limite.
    // Si le total récolté (avec repli inclus) n'atteint pas la cible du niveau demandé, on
    // rétrograde automatiquement vers un niveau que le contenu disponible permet d'honorer.
    let targetCount = LEVEL_QUESTION_COUNTS[level] || allRows.length;
    let effectiveLevel = level;
    if (allRows.length < targetCount) {
      if (level === '3' && allRows.length >= LEVEL_QUESTION_COUNTS['2']) {
        targetCount = LEVEL_QUESTION_COUNTS['2'];
        effectiveLevel = '2';
        alert('Pas assez de questions disponibles pour un niveau 3 complet (120 questions). Un quiz de niveau 2 (60 questions) a été généré automatiquement.');
      } else {
        targetCount = allRows.length;
        alert(`Pas assez de questions disponibles pour le niveau demandé. Le quiz démarre avec les ${allRows.length} questions disponibles.`);
      }
    }
    const shuffled = shuffleQuestions(allRows);
    state.selectedFieldKeys = chosenKeys;
    state.mode = 'normal';
    state.fullQuestions = shuffled.slice(0, targetCount);
    state.questions = state.fullQuestions;
    state.answers = []; state.index = 0;
    // Conserve la configuration du quiz (art, siècle, niveau effectif, rubriques testées) pour
    // l'historique des scores : deux quiz avec des rubriques différentes n'ont pas la même
    // difficulté et ne doivent donc pas partager la même colonne d'évolution.
    const effectiveLevelLabel = LEVEL_LABELS[effectiveLevel] || `${targetCount} questions`;
    const rubriqueLabels = chosenKeys.map((key) => allFields.find((f) => f.key === key)?.label || key);
    state.quizConfig = {
      arts: arts.map((a) => ART_LABELS[a]),
      centuries: centuries.map((c) => CENTURY_LABELS[c]),
      level: effectiveLevelLabel,
      rubriques: rubriqueLabels,
      label: `${arts.map((a) => ART_LABELS[a]).join(' + ')} · ${centuries.map((c) => CENTURY_LABELS[c]).join(', ')} · ${rubriqueLabels.join(', ')}`,
      signature: `${arts.slice().sort().join(',')}|${centuries.slice().sort().join(',')}|${effectiveLevel}|${chosenKeys.slice().sort().join(',')}`,
    };
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
  showPanel('quiz'); renderQuestion();
});
$('restart-full-button').addEventListener('click', () => {
  state.mode = 'normal';
  state.questions = state.fullQuestions;
  state.answers = [];
  state.index = 0;
  showPanel('quiz'); renderQuestion();
});
$('view-all-scores-button')?.addEventListener('click', async () => {
  const button = $('view-all-scores-button');
  const originalText = button.textContent;
  button.disabled = true; button.textContent = 'Préparation du fichier…';
  try {
    if (!lastAccountLevelGroups) await fetchScoreLevelGroups();
    if (!lastAccountLevelGroups || !lastAccountLevelGroups.size) {
      alert('Aucun score enregistré pour le moment. Termine un quiz et enregistre ton score pour commencer ton historique.');
      return;
    }
    downloadAccountTable();
  } finally {
    button.disabled = false; button.textContent = originalText;
  }
});
