"use strict";
const historyEl = document.getElementById("history");
const form = document.getElementById("command-form");
const input = document.getElementById("command");
const exitScreen = document.getElementById("exit-screen");
const reconnect = document.getElementById("reconnect");
const messageMarkup = document.getElementById("message-template").innerHTML;
const fileManager = document.getElementById("file-manager");
const closeFileManager = document.getElementById("close-file-manager");
const tabs = Array.from(document.querySelectorAll(".fm-tab"));
const panels = Array.from(document.querySelectorAll(".fm-panel"));
const commandHistory = [];
let cursor = 0;
let connected = false;
let synchronized = false;
let messageOpened = false;
let exited = false;
let codeAuthorized = false;
let assignedIP = null;
let identityQuestionActive = false;
let identityVerified = false;
let identityNoticeTimer = null;
let identityNoticeQueued = false;
let signalContext = null;
// Client-local event timestamps: frozen at the actual user actions.
let trustEnteredAt = null;
let documentBChosenAt = null;
const liveDateElement = document.getElementById('live-date');
const liveTimeElement = document.getElementById('live-time');
const padClock = number => String(number).padStart(2, '0');
function formatEventTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'НЕ ЗАРЕГИСТРИРОВАНО';
  return `${padClock(date.getDate())}.${padClock(date.getMonth() + 1)}.${date.getFullYear()} / ${padClock(date.getHours())}:${padClock(date.getMinutes())}:${padClock(date.getSeconds())}`;
}
function updateLiveClock() {
  const current = new Date();
  liveDateElement.textContent = `${padClock(current.getDate())}.${padClock(current.getMonth() + 1)}.${current.getFullYear()}`;
  liveTimeElement.textContent = `${padClock(current.getHours())}:${padClock(current.getMinutes())}:${padClock(current.getSeconds())}`;
}
updateLiveClock();
setInterval(updateLiveClock, 1000);


function line(value, className = "output") {
  const node = document.createElement("div");
  node.className = `history-line ${className}`;
  node.textContent = value;
  historyEl.appendChild(node);
  return node;
}

function scrollBottom() {
  requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }));
}

function showMessage() {
  const wrap = document.createElement("div");
  wrap.innerHTML = messageMarkup.trim();
  historyEl.appendChild(wrap.firstElementChild);
  messageOpened = true;
  renderCodeState();
}

function resetFlipStates() { panels.forEach(panel => panel.classList.remove("flipped")); }
function openFileManager() { fileManager.hidden = false; document.body.classList.add("manager-open"); resetFlipStates(); }
function closeManager() { fileManager.hidden = true; document.body.classList.remove("manager-open"); if (!document.getElementById('terminal').hidden) input.focus({ preventScroll: true }); }

function activateTab(name) {
  tabs.forEach(tab => {
    const active = tab.dataset.docTab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  panels.forEach(panel => {
    const active = panel.dataset.docPanel === name;
    panel.classList.toggle("active", active);
    if (!active) panel.classList.remove("flipped");
  });
}

function execute(raw, { initial = false } = {}) {
  if (exited) return;
  const command = raw.trim();
  if (!command) return;
  if (!initial && window.CICARS_SYNC?.isRemoteControlled()) {
    window.CICARS_SYNC.submit('command', command);
    return;
  }
  if (identityQuestionActive && !identityVerified && !initial && normalizedIdentity(command)) {
    checkIdentityAnswer(command);
    return;
  }
  if (assessment02Active && !assessment02Done && !initial && isAssessment02AnswerAttempt(command)) {
    checkAssessment02Answer(command);
    return;
  }
  if (!initial && handleFinal3310Command(command)) return;
  line(command, "command");
  if (!initial) {
    commandHistory.push(command);
    cursor = commandHistory.length;
  }
  const normalized = command.toLowerCase().replace(/\s+/g, " ");
  switch (normalized) {
    case "connect gov.net":
      connected = true;
      line("connection established");
      break;
    case "inbox sync":
      if (!connected) line("connection required: connect gov.net", "error");
      else {
        synchronized = true;
        line("1 new secure message");
      }
      break;
    case "open msg cicars_3310":
      if (!synchronized) line("message unavailable: run inbox sync", "error");
      else {
        line("message opened");
        showMessage();
      }
      break;
    case "reset":
      resetIdentificationSequence();
      resetAssessment02();
      resetAssessment03();
      clearIdentityNotice();
      identityQuestionActive = false;
      identityVerified = false;
      codeAuthorized = false;
      trustEnteredAt = null;
      documentBChosenAt = null;
      workspaceTabs.hidden=true;
      workspaceFiles.hidden=true;
      document.getElementById('terminal').hidden=false;
      setRecordingAvailable(false);
      assignedIP = null;
      renderCodeState();
      line("access code reset — authorization required");
      break;
    case "identity":
      if (!codeAuthorized) line("ACCESS DENIED: AUDIO AUTHORIZATION REQUIRED", "error");
      else askIdentityQuestion();
      break;
    case "test02":
      if (!identityVerified) line("ACCESS DENIED: ASSESSMENT 01 REQUIRED", "error");
      else if (assessment02Done) line("TEST 02: COMPLETED");
      else if (assessment02Active) renderAssessment02Message();
      else scheduleAssessment02Notice();
      break;
    case "open personnel_trace_03.dat":
    case "open file personnel_trace_03.dat":
      if (!trace03Unlocked) line('ACCESS DENIED: PERSONNEL TRACE NOT AVAILABLE', 'error');
      else openPersonnelTrace();
      break;
    // Secret trigger is discovered from the OFFSET +7 cipher on page 31.
    // It stays absent from HELP and is inert until TEST 03 is delivered.
    case "restore archive":
      if (!assessment03Unlocked) line('UNKNOWN COMMAND', 'error');
      else unlockCipherFragment();
      break;
    // SECRET: enabled after RESTORE ARCHIVE has finished recovering file 04.
    // Hidden from all in-game help and prompts.
    case "import 3310":
      if (!cipher04Unlocked) line('UNKNOWN COMMAND', 'error');
      else if (!final3310Prompted && !final3310Running && !final3310AwaitWord && !final3310Complete) {
        line('> MODULE IMPORT: CICARS_3310 // ACCEPTED');
        activateFinal3310Prompt();
      }
      break;
    case "open указ_3310.dat":
    case "open decree_3310.dat":
    case "open указ 3310":
      if (!final3310DecreeUnlocked) line('FILE NOT FOUND: УКАЗ_3310.dat', 'error');
      else openFinal3310Decree();
      break;
    case "open cipher_fragment_04.dat":
      if (!cipher04Unlocked) line('ACCESS DENIED: FILE NOT AVAILABLE', 'error');
      else openCipherFragment();
      break;
    case "open archive_cityhall_31.png":
    case "open cityhall photo":
    case "open clue 1":
      if (!assessment03Unlocked) line('ACCESS DENIED: CLUE 01 NOT AVAILABLE', 'error');
      else openTest03Photo();
      break;
    case "open gov_archive_proc_vol2.pdf":
    case "open procedures vol 2":
    case "open clue 2":
      if (!assessment03Unlocked) line('ACCESS DENIED: CLUE 02 NOT AVAILABLE', 'error');
      else openTest03Procedures();
      break;
    case "status":
      line(`ARCHIVE SYSTEM: ONLINE | CONNECTION: ${connected ? "ESTABLISHED" : "OFFLINE"} | CICARS_3310: ${messageOpened ? "ACTIVE" : "UNREAD"}`);
      break;
    default:
      line(`INVALID COMMAND: ${command}`, "error");
  }
  if (!initial) scrollBottom();
}

form.addEventListener("submit", e => {
  e.preventDefault();
  const command = input.value;
  input.value = "";
  window.CICARS_SYNC?.clearDraft('command');
  execute(command);
});

input.addEventListener("keydown", e => {
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    cursor = Math.max(0, Math.min(commandHistory.length, cursor + (e.key === "ArrowUp" ? -1 : 1)));
    input.value = commandHistory[cursor] || "";
    input.setSelectionRange(input.value.length, input.value.length);
  }
});

historyEl.addEventListener("click", e => {
  const openBtn = e.target.closest("[data-open-files]");
  if (openBtn) openFileManager();
});

tabs.forEach(tab => tab.addEventListener("click", () => activateTab(tab.dataset.docTab)));
document.querySelectorAll(".flip-doc").forEach(button => button.addEventListener("click", () => {
  const panel = button.closest(".fm-panel");
  if (panel) panel.classList.toggle("flipped");
}));
closeFileManager.addEventListener("click", closeManager);
fileManager.addEventListener("click", e => { if (e.target === fileManager) closeManager(); });
window.addEventListener("keydown", e => { if (e.key === "Escape" && !fileManager.hidden) closeManager(); });

reconnect.addEventListener("click", () => {
  exited = false;
  connected = false;
  synchronized = false;
  messageOpened = false;
  exitScreen.hidden = true;
  form.hidden = false;
  historyEl.replaceChildren();
  codeAuthorized = false;
  trustEnteredAt = null;
  documentBChosenAt = null;
  resetIdentificationSequence();
  resetAssessment02();
  resetAssessment03();
  clearIdentityNotice();
  identityQuestionActive = false;
  identityVerified = false;
  assignedIP = null;
  ["connect gov.net", "inbox sync", "open msg CICARS_3310"].forEach(c => execute(c, { initial: true }));
  input.focus();
});

// Startup is deferred until all module-level state is initialized.


function highlightSequentialClueLetters() {
  // Exactly one character per letter of each clue. The characters
  // are spread throughout the archival narrative, not grouped at the start.
  document.querySelectorAll('.fm-panel[data-clue]').forEach(panel => {
    const clue = [...panel.dataset.clue.toUpperCase()];
    const root = panel.querySelector('.doc-front .doc-text');
    if (!root || root.dataset.clueApplied) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    const letters = [];
    let node;
    while ((node = walker.nextNode())) {
      nodes.push(node);
      for (let offset = 0; offset < node.textContent.length; offset++) {
        const char = node.textContent[offset];
        if (/[А-Яа-яЁё]/.test(char)) letters.push({node, offset, char});
      }
    }
    const targets = clue.map((_, i) =>
      Math.floor(letters.length * ((i + 0.65 + Math.random() * .7) / (clue.length + 1)))
    );
    const selected = [];
    let after = -1;
    clue.forEach((wanted, i) => {
      const matching = letters
        .map((entry, index) => ({...entry, index}))
        .filter(e => e.index > after && e.char.toUpperCase() === wanted);
      if (!matching.length) return;
      const match = matching.reduce((best, candidate) =>
        Math.abs(candidate.index - targets[i]) < Math.abs(best.index - targets[i]) ? candidate : best
      );
      selected.push(match);
      after = match.index;
    });
    const byNode = new Map();
    selected.forEach(entry => {
      if (!byNode.has(entry.node)) byNode.set(entry.node, new Set());
      byNode.get(entry.node).add(entry.offset);
    });
    byNode.forEach((offsets, textNode) => {
      const fragment = document.createDocumentFragment();
      [...textNode.textContent].forEach((char, offset) => {
        if (!offsets.has(offset)) {
          fragment.appendChild(document.createTextNode(char));
          return;
        }
        const span = document.createElement('strong');
        span.className = 'indexed-letter';
        span.textContent = char;
        fragment.appendChild(span);
      });
      textNode.replaceWith(fragment);
    });
    root.dataset.clueApplied = 'true';
  });
}
highlightSequentialClueLetters();

document.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('#close-file-manager, .fm-close');
  if (closeBtn) {
    e.preventDefault();
    e.stopPropagation();
    closeManager();
  }
});


// Puzzle-only authorization: no real network request is made.
const VALID_ACCESS_CODE = 'TRUST';
function randomDemoIP() {
  // RFC 5737 documentation-range address, displayed as fictional terminal output.
  return `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
}
function renderCodeState() {
  document.querySelectorAll('.message').forEach(message => {
    const field = message.querySelector('.access-input');
    const submit = message.querySelector('.access-submit');
    const resetButton = message.querySelector('[data-reset-code]');
    if (!field || !submit || !resetButton) return;
    field.disabled = codeAuthorized;
    submit.disabled = codeAuthorized;
    resetButton.hidden = !codeAuthorized;
    // Keep the shared in-progress draft when an authorization snapshot arrives.
    if (codeAuthorized) field.value = VALID_ACCESS_CODE;
  });
}

historyEl.addEventListener('submit', e => {
  const accessForm = e.target.closest('.access-form');
  if (!accessForm) return;
  e.preventDefault();
  const field = accessForm.querySelector('.access-input');
  if (codeAuthorized) return;
  if (window.CICARS_SYNC?.isRemoteControlled()) {
    window.CICARS_SYNC.submit('trust', field.value);
    return;
  }
  const candidate = field.value.trim().toUpperCase();
  if (candidate !== VALID_ACCESS_CODE) {
    feedback('failure');
    // Silent failure: only CRT flash and signal, no console error line.
    scrollBottom();
    field.focus();
    field.select();
    return;
  }
  trustEnteredAt = new Date();
  codeAuthorized = true;
  feedback('success');
  assignedIP = randomDemoIP();
  line(`connect ${assignedIP}`, 'command');
  line('connection established');
  line('ACCESS GRANTED');
  scrollBottom();
  renderCodeState();
  line('FILE RECEIVED: ARCHIVE_RECORDING.WAV');
  line('STATUS: AUDIO FILE READY');
  setRecordingAvailable(true);
  scrollBottom();
});
historyEl.addEventListener('click', e => {
  if (!e.target.closest('[data-reset-code]')) return;
  resetIdentificationSequence();
  resetAssessment02();
  resetAssessment03();
  codeAuthorized = false;
  trustEnteredAt = null;
  documentBChosenAt = null;
  clearIdentityNotice();
  identityQuestionActive = false;
  identityVerified = false;
  setRecordingAvailable(false);
  assignedIP = null;
  renderCodeState();
  const field = e.target.closest('.message').querySelector('.access-input');
  field?.focus();
});


// Accessible media player is OUTSIDE the filtered/warped CRT content,
// so the controls remain clickable while visual effects stay visible.
const audioModal = document.getElementById('audio-modal');
const recording = document.getElementById('archive-audio');
const playControl = document.getElementById('audio-play');
const seekControl = document.getElementById('audio-seek');
function setRecordingAvailable(available) {
  historyEl.querySelectorAll('[data-open-record]').forEach(button => button.remove());
  if (available) {
    const row = document.createElement('div');
    row.className = 'history-line audio-file-line';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'downloaded-record';
    button.dataset.openRecord = '';
    button.textContent = '> OPEN AUDIO RECORD // ARCHIVE_RECORDING.WAV';
    row.append(button);
    historyEl.append(row);
  } else {
    closeRecording();
  }
}
function openRecording() {
  if (!codeAuthorized) return;
  if (window.CICARS_SYNC?.isRemoteControlled()) window.CICARS_SYNC.submit('audio-open');
  else scheduleIdentityNotice();
  audioModal.hidden = false;
  document.body.classList.add('audio-visible');
  document.getElementById('audio-close').focus();
}
function closeRecording() {
  recording.pause();
  audioModal.hidden = true;
  document.body.classList.remove('audio-visible');
}
function clock(time) {
  const t = Number.isFinite(time) ? Math.floor(time) : 0;
  return `${String(Math.floor(t / 60)).padStart(2,'0')}:${String(t % 60).padStart(2,'0')}`;
}
function updateAudioUI() {
  document.getElementById('audio-current').textContent = clock(recording.currentTime);
  document.getElementById('audio-total').textContent = clock(recording.duration);
  seekControl.value = Number.isFinite(recording.duration) && recording.duration > 0
    ? String(Math.round(recording.currentTime / recording.duration * 1000)) : '0';
  playControl.textContent = recording.paused ? '▶ PLAY' : 'Ⅱ PAUSE';
}
historyEl.addEventListener('click', e => {
  if (e.target.closest('[data-open-record]')) openRecording();
});
document.getElementById('audio-close').addEventListener('click', closeRecording);
audioModal.addEventListener('click', e => {if(e.target === audioModal) closeRecording();});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && !audioModal.hidden) closeRecording();
});
playControl.addEventListener('click', async () => {
  if (recording.paused) {
    try { await recording.play(); } catch (_) { playControl.textContent = 'PLAYBACK ERROR'; }
  } else recording.pause();
  updateAudioUI();
});
document.getElementById('audio-stop').addEventListener('click', () => {
  recording.pause(); recording.currentTime = 0; updateAudioUI();
});
seekControl.addEventListener('input', () => {
  if (Number.isFinite(recording.duration) && recording.duration > 0) {
    recording.currentTime = Number(seekControl.value) / 1000 * recording.duration;
  }
});
['loadedmetadata','timeupdate','play','pause','ended','seeked'].forEach(event => recording.addEventListener(event,updateAudioUI));


// CICARS identity assessment after the audio record is opened.
function normalizeIdentity(text) {
  return String(text).toLowerCase().replaceAll('ё','е')
    .replace(/[^а-яa-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function normalizedIdentity(text) {
  // While the question is active, take any entered text as an answer,
  // except for explicit utility commands.
  const command = normalizeIdentity(text);
  return !['reset','status','identity'].includes(command);
}
function askIdentityQuestion() {
  clearIdentityNotice();
  if (identityVerified || identityQuestionActive) return;
  identityQuestionActive = true;
  line('------------------------------------------------------------', 'assessment-separator');
  line('В КАКОМ АРХИВЕ Я НАХОЖУСЬ?', 'assessment-question');
  line('------------------------------------------------------------', 'assessment-separator');
  scrollBottom();
}
function matchesIdentityAnswer(raw) {
  // normalizeIdentity removes punctuation, collapses spaces and upper/lower case.
  // Accepted: ARCHIVE B 12, ARCHIVE B12, B12.
  const answer = normalizeIdentity(raw);
  return answer === 'archive b 12' || answer === 'archive b12' || answer === 'b12';
}
let feedbackTimer;
function unlockSignalAudio() {
  try {
    if (!signalContext) signalContext = new (window.AudioContext || window.webkitAudioContext)();
    if (signalContext.state === 'suspended') signalContext.resume().catch(() => {});
  } catch (_) { }
}
function eightBitTone(freq, start, duration, volume=.075, waveform='square') {
  if (!signalContext) return;
  const oscillator = signalContext.createOscillator();
  const gain = signalContext.createGain();
  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(.0001,start);
  gain.gain.linearRampToValueAtTime(volume,start+.006);
  gain.gain.setValueAtTime(volume,start+Math.max(.008,duration-.025));
  gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  oscillator.connect(gain).connect(signalContext.destination);
  oscillator.start(start); oscillator.stop(start+duration+.01);
}
function playTerminalSignal(kind) {
  window.CICARS_SYNC?.broadcastSignal(kind);
  unlockSignalAudio();
  if (!signalContext || signalContext.state !== 'running') return;
  const t=signalContext.currentTime+.01;
  if(kind==='failure') {
    eightBitTone(175,t,.17,.07,'sawtooth');
    eightBitTone(110,t+.19,.27,.09,'square');
    eightBitTone(82.4,t+.47,.25,.06,'sawtooth');
  } else if(kind==='success') {
    eightBitTone(196,t,.09,.065);
    eightBitTone(294,t+.13,.11,.072);
    eightBitTone(392,t+.29,.21,.075);
    eightBitTone(784,t+.53,.07,.032);
  } else {
    // Cold, 8-bit secure-inbox notification: short low digital bursts.
    eightBitTone(220,t,.07,.07);
    eightBitTone(330,t+.11,.07,.07);
    eightBitTone(220,t+.25,.09,.065);
    eightBitTone(440,t+.39,.14,.055);
  }
}
function clearIdentityNotice() {
  clearTimeout(identityNoticeTimer);
  identityNoticeTimer=null;
  identityNoticeQueued=false;
}
function scheduleIdentityNotice() {
  if(identityVerified || identityQuestionActive || identityNoticeQueued) return;
  unlockSignalAudio(); // User clicked OPEN AUDIO RECORD: unlock Web Audio here.
  identityNoticeQueued=true;
  identityNoticeTimer=setTimeout(() => {
    identityNoticeTimer=null;
    identityNoticeQueued=false;
    if(!codeAuthorized || identityVerified || identityQuestionActive) return;
    playTerminalSignal('notification');
    askIdentityQuestion();
  },10000);
}
function feedback(type) {
  window.CICARS_SYNC?.broadcastVisual(type);
  document.body.classList.remove('identity-failure','identity-success');
  void document.body.offsetWidth;
  document.body.classList.add(type==='success'?'identity-success':'identity-failure');
  clearTimeout(feedbackTimer);
  feedbackTimer=setTimeout(()=>document.body.classList.remove('identity-failure','identity-success'),1050);
  playTerminalSignal(type);
}
function checkIdentityAnswer(answer) {
  if (!matchesIdentityAnswer(answer)) {
    // Answer deliberately not echoed or added to history.
    feedback('failure');
    input.value = '';
    input.focus({preventScroll:true});
    return;
  }
  identityQuestionActive = false;
  identityVerified = true;
  clearIdentityNotice();
  input.value = '';
  feedback('success');
  line('IDENTITY CONFIRMED');
  line('CICARS_3310 // GOVERNANCE CONTINUITY PROTOCOL: VERIFIED');
  line('> archive.mount --slot=04 --status=PENDING');
  line('> archive.mount --slot=05 --status=PENDING');
  line('> interface.mount --target=console --status=ONLINE');
  line('> interface.mount --target=file-explorer --status=ONLINE');
  line('WORKSPACE INITIALIZED // 2 TABS AVAILABLE');
  unlockWorkspace();
  scheduleAssessment02Notice();
}


// Move the existing archive-document modal outside the CRT-filtered console,
 // so it also works while the file-explorer tab is selected.
 document.body.appendChild(fileManager);
 // Two top-level workspace tabs, unlocked by passing CICARS identity verification.
const workspaceTabs=document.getElementById('workspace-tabs');
const workspaceFiles=document.getElementById('workspace-files');
const photoModal=document.getElementById('photo-modal');
function unlockWorkspace(){
  workspaceTabs.hidden=false;
  selectWorkspaceTab('console');
  requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'auto'}));
}
function selectWorkspaceTab(tab){
  if(workspaceTabs.hidden) return;
  const files=tab==='files';
  document.getElementById('terminal').hidden=files;
  workspaceFiles.hidden=!files;
  workspaceTabs.querySelectorAll('[data-workspace-tab]').forEach(button=>{
    const active=button.dataset.workspaceTab===tab;
    button.classList.toggle('active',active);
    button.setAttribute('aria-current',active?'page':'false');
  });
  if(!files) input.focus({preventScroll:true});
  requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'auto'}));
}
workspaceTabs.addEventListener('click',event=>{
  const button=event.target.closest('[data-workspace-tab]');
  if(button) selectWorkspaceTab(button.dataset.workspaceTab);
});
workspaceFiles.addEventListener('click',event=>{
  const item=event.target.closest('[data-file-action]');
  if(!item) return;
  if(item.dataset.fileAction==='docs') openFileManager();
  if(item.dataset.fileAction==='audio') openRecording();
  if(item.dataset.fileAction==='photo') photoModal.hidden=false;
});
function closePhoto(){photoModal.hidden=true;}
document.getElementById('photo-close').addEventListener('click',closePhoto);
photoModal.addEventListener('click',event=>{if(event.target===photoModal)closePhoto();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!photoModal.hidden)closePhoto();});

// When restarting the puzzle, return to its original locked console state.
const originalReconnectAction=reconnect;
reconnect.addEventListener('click',()=>{
  workspaceTabs.hidden=true;
  workspaceFiles.hidden=true;
  document.getElementById('terminal').hidden=false;
  closePhoto();
  closeTest03Photo();
  closeTest03Procedures();
  selectWorkspaceTab('console');
});


// ============================================================
// CICARS / ASSESSMENT 02 -- conflicting government records.
// Activated after the identity assessment, not at site load.
// ============================================================
let assessment02Active = false;
let assessment02Done = false;
let assessment02Queued = false;
let assessment02NoticeTimer = null;
let assessment02ResultTimers = [];
const ASSESSMENT02_WAIT_MS = 60_000;
let assessment02ReadyAt = 0;
let assessment02FailedCount = 0;
let assessment02CountdownInterval = null;
const assessmentDocModal = document.getElementById('assessment-doc-modal');
const assessmentDocScreen = document.getElementById('assessment-doc-screen');
const assessmentDocButtons = [...document.querySelectorAll('[data-test-doc]')];
const assessmentDocPanels = [...document.querySelectorAll('[data-test-doc-panel]')];

function scheduleAssessment02Notice() {
  if (!identityVerified || assessment02Queued || assessment02Active || assessment02Done) return;
  assessment02Queued = true;
  assessment02NoticeTimer = setTimeout(() => {
    assessment02NoticeTimer = null;
    assessment02Queued = false;
    if (!identityVerified || assessment02Done || exited) return;
    assessment02Active = true;
    assessment02FailedCount = 0;
    revealAssessment02Files();
    playTerminalSignal('notification');
    renderAssessment02Message();
    // Show the new message even if the user was viewing the first console's top.
    if (!document.getElementById('terminal').hidden) scrollBottom();
  }, 10000);
}

function revealAssessment02Files() {
  document.querySelectorAll('.test02-file').forEach(button => { button.hidden = false; });
  document.getElementById('workspace-count').textContent = '6 ОБЪЕКТОВ';
}
function renderAssessment02Message() {
  document.querySelectorAll('.assessment02-message').forEach(el => el.remove());
  const box = document.createElement('section');
  box.className = 'assessment02-message';
  box.innerHTML = `
    <div class="assessment02-rule">------------------------------------------------------------</div>
    <h2>ОЦЕНКА АДМИНИСТРАЦИИ // ТЕСТ 02</h2>
    <div class="assessment02-rule">------------------------------------------------------------</div>
    <p>ОБНАРУЖЕН КОНФЛИКТ АРХИВНЫХ ДАННЫХ.</p>
    <p>ТРИ ДОКУМЕНТА.<br>ОДНО СОБЫТИЕ.<br>ДАННЫЕ ПРОТИВОРЕЧАТ ДРУГ ДРУГУ.</p>
    <p>НЕ ВЫБИРАЙТЕ ДОКУМЕНТ, КОТОРЫЙ ВЫГЛЯДИТ НАИБОЛЕЕ ОФИЦИАЛЬНО.<br>ВЫБЕРИТЕ ДОКУМЕНТ, КОТОРЫЙ МОЖНО ПРОВЕРИТЬ.</p>
    <div class="assessment02-rule">------------------------------------------------------------</div>
    <div class="assessment02-added">&gt; archive.sync --batch=TEST_02 --files=3<br>3 ДОКУМЕНТА ДОБАВЛЕНЫ В ФАЙЛОВЫЙ МЕНЕДЖЕР</div>
    <div class="assessment02-attachments" aria-label="Прикреплённые документы">
      <div class="assessment02-attachments-title">▣ ПРИЛОЖЕНИЯ К СООБЩЕНИЮ // 03 ФАЙЛА</div>
      <div class="assessment02-attachment-row">
        <button type="button" data-assessment-file="a">▤ DOCUMENT_A.gov <span>[ OPEN ]</span></button>
        <button type="button" data-assessment-file="b">▤ DOCUMENT_B.log <span>[ OPEN ]</span></button>
        <button type="button" data-assessment-file="c">▤ DOCUMENT_C.rec <span>[ OPEN ]</span></button>
      </div>
    </div>
    <div class="assessment02-security">
      <div class="assessment02-warning">⚠ ПРОТОКОЛ ОГРАНИЧЕННОГО ДОПУСКА // ДОСТУПНО ТОЛЬКО 2 ПОПЫТКИ</div>
      <div class="assessment02-attempts">ОСТАЛОСЬ ПОПЫТОК: <strong data-visible-attempts>2</strong></div>
      <div class="assessment02-timer-wrap">ДОСТУП К ОТВЕТУ ЧЕРЕЗ <strong data-test-countdown aria-live="off">01:00</strong></div>
      <div class="assessment02-timer-detail" data-test-status>СВЕРКА АРХИВНЫХ МЕТАДАННЫХ... ОТВЕТ ВРЕМЕННО ЗАБЛОКИРОВАН</div>
    </div>
    <h3>КАКОМУ ДОКУМЕНТУ МОЖНО ДОВЕРЯТЬ?</h3>
    <div class="assessment02-choices"><button type="button" data-test-choice="A" disabled>[ A ]</button><button type="button" data-test-choice="B" disabled>[ B ]</button><button type="button" data-test-choice="C" disabled>[ C ]</button></div>
    <div class="assessment02-prompt">&gt; _ <span>Введите A / Б / C в консоль или выберите вариант после снятия блокировки</span></div>
  `;
  historyEl.appendChild(box);
  if (!assessment02ReadyAt) beginAssessment02Cooldown();
  updateAssessment02Countdown();
  scrollBottom();
}
function formatAssessment02Countdown(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
}
function updateAssessment02Countdown() {
  if (!assessment02Active || assessment02Done) return;
  const remaining = Math.max(0, assessment02ReadyAt - Date.now());
  const locked = remaining > 0;
  document.querySelectorAll('[data-test-countdown]').forEach(el => {
    el.textContent = formatAssessment02Countdown(remaining);
    el.closest('.assessment02-timer-wrap')?.classList.toggle('ready', !locked);
  });
  document.querySelectorAll('[data-test-status]').forEach(el => {
    el.textContent = locked
      ? 'АРХИВНЫЙ КОНТРОЛЬ АКТИВЕН // ОЖИДАЙТЕ ДОПУСКА'
      : 'ACCESS WINDOW OPEN // ОТВЕТ РАЗРЕШЁН';
  });
  document.querySelectorAll('[data-visible-attempts]').forEach(el => {
    // Displayed attempts are part of the fictional protocol; retries remain unlimited.
    el.textContent = String(Math.max(0, 2 - assessment02FailedCount));
  });
  document.querySelectorAll('[data-test-choice]').forEach(btn => {btn.disabled = locked;});
  if (!locked && assessment02CountdownInterval !== null) {
    clearInterval(assessment02CountdownInterval);
    assessment02CountdownInterval = null;
  }
}
function beginAssessment02Cooldown() {
  if (assessment02CountdownInterval !== null) clearInterval(assessment02CountdownInterval);
  assessment02ReadyAt = Date.now() + ASSESSMENT02_WAIT_MS;
  assessment02CountdownInterval = setInterval(updateAssessment02Countdown, 200);
  updateAssessment02Countdown();
}
function isAssessment02AnswerAttempt(text) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return !['reset','status','identity','test02','connect gov.net','inbox sync','open msg cicars_3310','restore archive','import 3310'].includes(normalized);
}
function assessment02WriteLines(lines, className = 'output') {
  lines.forEach(item => line(item, className));
}
function checkAssessment02Answer(raw) {
  if (window.CICARS_SYNC?.isRemoteControlled()) {
    window.CICARS_SYNC.submit('test02', raw);
    return;
  }
  if (!assessment02Active || assessment02Done) return;
  if (Date.now() < assessment02ReadyAt) {
    // Do not print the premature answer or count it as a failed attempt.
    updateAssessment02Countdown();
    input.value = '';
    return;
  }
  const answer = raw.trim().toUpperCase().replace(/[.\s]/g, '');
  if (answer !== 'B' && answer !== 'Б') {
    assessment02FailedCount++;
    feedback('failure');
    assessment02WriteLines([
      '------------------------------------------------------------',
      'ВЫБОР ОТКЛОНЁН.',
      'ВЫ ДОВЕРИЛИСЬ ДОКУМЕНТУ.',
      'ВЫ НЕ ПРОВЕРИЛИ СОБЫТИЕ.',
      'ПОВТОРИТЕ АНАЛИЗ.',
      '------------------------------------------------------------'
    ], 'assessment02-rejected');
    beginAssessment02Cooldown();
    input.value = '';
    scrollBottom();
    return;
  }
  documentBChosenAt = new Date();
  if (assessment02CountdownInterval !== null) {
    clearInterval(assessment02CountdownInterval);
    assessment02CountdownInterval = null;
  }
  assessment02Active = false;
  assessment02Done = true;
  document.querySelectorAll('[data-test-choice]').forEach(btn => { btn.disabled = true; });
  line('B', 'command');
  feedback('success');
  const stages = [
    'ДОКУМЕНТ B ВЫБРАН.',
    '',
    'ПРОВЕРКА...',
    'СВЕРКА ВРЕМЕННЫХ МЕТОК...',
    'СВЕРКА ЖУРНАЛА ДОСТУПА...',
    'ПРОВЕРКА ЦЕЛОСТНОСТИ...',
    '',
    'СОВПАДЕНИЕ ПОДТВЕРЖДЕНО.',
    '',
    'ДОКУМЕНТ A:',
    'ОШИБКА АУТЕНТИФИКАЦИИ',
    '',
    'ДОКУМЕНТ C:',
    'ВТОРИЧНЫЙ ИСТОЧНИК',
    'ОРИГИНАЛ НЕ ПОДТВЕРЖДЁН',
    '',
    'ТЕСТ 02 ЗАВЕРШЁН',
    '',
    'ПАРАМЕТР: КРИТИЧЕСКОЕ МЫШЛЕНИЕ',
    'РЕЗУЛЬТАТ: ПРИЕМЛЕМО',
    '',
    'СТАТУС АДМИНИСТРАЦИИ:',
    'ОЦЕНКА ПРОДОЛЖАЕТСЯ',
    '',
    'ОЦЕНКА ГУБЕРНАТОРА НАЧАТА.'
  ];
  // Rapid terminal output with a slight archival-verification pause.
  let elapsed = 0;
  stages.forEach((message, i) => {
    elapsed += /\.\.\./.test(message) ? 340 : 80;
    const timer = setTimeout(() => {
      if (!assessment02Done) return;
      line(message || ' ', ['СОВПАДЕНИЕ ПОДТВЕРЖДЕНО.','ТЕСТ 02 ЗАВЕРШЁН','ОЦЕНКА ГУБЕРНАТОРА НАЧАТА.'].includes(message) ? 'assessment02-accepted' : 'output');
      scrollBottom();
    }, elapsed);
    assessment02ResultTimers.push(timer);
  });
  // Deliberate delay after the assessment printout; then the monitor glitches.
  const sequenceTimer = setTimeout(() => {
    if (assessment02Done && identityVerified && !exited) beginIdentificationSequence();
  }, elapsed + 650);
  assessment02ResultTimers.push(sequenceTimer);
}
function resetAssessment02() {
  resetIdentificationSequence();
  clearTimeout(assessment02NoticeTimer);
  assessment02NoticeTimer = null;
  assessment02ResultTimers.forEach(clearTimeout);
  assessment02ResultTimers = [];
  if (assessment02CountdownInterval !== null) clearInterval(assessment02CountdownInterval);
  assessment02CountdownInterval = null;
  assessment02ReadyAt = 0;
  assessment02FailedCount = 0;
  assessment02Active = assessment02Done = assessment02Queued = false;
  document.querySelectorAll('.test02-file').forEach(button => { button.hidden = true; });
  document.querySelectorAll('.assessment02-message').forEach(el => el.remove());
  const count = document.getElementById('workspace-count');
  if (count) count.textContent = '3 ОБЪЕКТА';
  closeAssessment02Document();
}
function openAssessment02Document(letter) {
  const normalized = String(letter).toLowerCase();
  assessmentDocButtons.forEach(btn => {
    const selected = btn.dataset.testDoc === normalized;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-selected', String(selected));
  });
  assessmentDocPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.testDocPanel === normalized));
  assessmentDocScreen.scrollTop = 0;
  assessmentDocModal.hidden = false;
  document.body.classList.add('assessment-doc-visible');
  document.getElementById('assessment-doc-close').focus({preventScroll:true});
}
function closeAssessment02Document() {
  assessmentDocModal.hidden = true;
  document.body.classList.remove('assessment-doc-visible');
}
workspaceFiles.addEventListener('click', event => {
  const item = event.target.closest('[data-file-action^="test-"]');
  if (!item || item.hidden) return;
  openAssessment02Document(item.dataset.fileAction.substring(5));
});
assessmentDocButtons.forEach(btn => btn.addEventListener('click', () => openAssessment02Document(btn.dataset.testDoc)));
document.getElementById('assessment-doc-close').addEventListener('click', closeAssessment02Document);
assessmentDocModal.addEventListener('click', event => {if (event.target === assessmentDocModal) closeAssessment02Document();});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !assessmentDocModal.hidden) {event.stopPropagation();closeAssessment02Document();}
});
historyEl.addEventListener('click', event => {
  const attachment = event.target.closest('[data-assessment-file]');
  if (attachment && assessment02Active) {
    openAssessment02Document(attachment.dataset.assessmentFile);
    return;
  }
  const choice = event.target.closest('[data-test-choice]');
  if (choice && !choice.disabled) checkAssessment02Answer(choice.dataset.testChoice);
});

// ============================================================
// POST-ASSESSMENT IDENTIFICATION: locked CRT interruption,
// typewriter announcement, and PERSONNEL_TRACE_03.dat.
// ============================================================
const identificationOverlay = document.getElementById('identification-overlay');
const identificationTitle = document.getElementById('identification-title');
const identificationStatus = document.getElementById('identification-status');
const identificationReadout = document.getElementById('identification-readout');
const personnelTraceModal = document.getElementById('trace03-modal');
const personnelTraceButton = document.getElementById('trace03-close');
let identificationTimers = [];
let identificationTypingInterval = null;
let identificationActive = false;
let trace03Unlocked = false;
function sequenceAfter(callback, milliseconds) {
  const timer = setTimeout(callback, milliseconds);
  identificationTimers.push(timer);
  return timer;
}
function stopIdentificationTimers() {
  identificationTimers.forEach(clearTimeout);
  identificationTimers = [];
  if (identificationTypingInterval !== null) clearInterval(identificationTypingInterval);
  identificationTypingInterval = null;
}
function resetIdentificationSequence() {
  stopIdentificationTimers();
  identificationActive = false;
  identificationOverlay.hidden = true;
  identificationOverlay.classList.remove('is-frozen', 'is-printing', 'is-fading');
  document.body.classList.remove('identification-lock');
  input.disabled = false;
  trace03Unlocked = false;
  document.querySelectorAll('.trace03-file').forEach(el => { el.hidden = true; });
  const count = document.getElementById('workspace-count');
  if (count && assessment02Done) count.textContent = '6 ОБЪЕКТОВ';
  closePersonnelTrace();
  document.querySelectorAll('.trace03-console-file').forEach(el => el.remove());
}
function beginIdentificationSequence() {
  window.CICARS_SYNC?.broadcastVisual('identification');
  if (identificationActive || trace03Unlocked) return;
  identificationActive = true;
  identificationTitle.textContent = '';
  identificationStatus.textContent = 'CICARS_3310 // SIGNAL LOST';
  identificationReadout.textContent = 'MEMORY ERROR  ▒▒▒▒▒▒▒▒  // RECONNECTING';
  identificationOverlay.hidden = false;
  identificationOverlay.classList.remove('is-printing', 'is-fading');
  identificationOverlay.classList.add('is-frozen');
  document.body.classList.add('identification-lock');
  input.disabled = true;
  // Low noisy digital interference during deliberate lock-up.
  playTerminalSignal('notification');
  sequenceAfter(startIdentificationTyping, 2900);
}
function playIdentificationKeystroke(characterIndex) {
  // Soft low-resolution terminal key-click; not a cartoon notification melody.
  if (!signalContext || signalContext.state !== 'running') return;
  if (characterIndex % 2 !== 0) return;
  const at = signalContext.currentTime + .002;
  eightBitTone(characterIndex % 4 ? 145 : 193, at, .018, .014, 'square');
}
function startIdentificationTyping() {
  if (!identificationActive) return;
  identificationOverlay.classList.remove('is-frozen');
  identificationOverlay.classList.add('is-printing');
  identificationStatus.textContent = 'CICARS_3310 // PERSONNEL RECOGNITION';
  identificationReadout.textContent = 'PERSONNEL IDENTIFICATION // 100%';
  const complete = 'IDENTIFICATION COMPLETE';
  let count = 0;
  identificationTypingInterval = setInterval(() => {
    if (!identificationActive) return;
    count++;
    identificationTitle.textContent = complete.slice(0, count);
    playIdentificationKeystroke(count);
    if (count >= complete.length) {
      clearInterval(identificationTypingInterval);
      identificationTypingInterval = null;
      // Keep the fully printed message on screen for five seconds.
      sequenceAfter(fadeIdentificationTitle, 5000);
    }
  }, 77);
}
function fadeIdentificationTitle() {
  if (!identificationActive) return;
  identificationOverlay.classList.add('is-fading');
  sequenceAfter(completeIdentificationSequence, 950);
}
function completeIdentificationSequence() {
  if (!identificationActive) return;
  stopIdentificationTimers();
  identificationActive = false;
  identificationOverlay.hidden = true;
  identificationOverlay.classList.remove('is-frozen', 'is-printing', 'is-fading');
  document.body.classList.remove('identification-lock');
  input.disabled = false;
  trace03Unlocked = true;
  line('------------------------------------------------------------');
  line('НАСТОЯЩИЙ ГУБЕРНАТОР: ПОДТВЕРЖЕН', 'trace03-confirmed');
  line('АДМИНИСТРАТИВНЫЙ ПЕРСОНАЛ: ЧАСТИЧНО ИДЕНТИРОВАНЫ');
  line(' ');
  line('ВЫ УЖЕ НЕ АНОНИМНЫ.', 'trace03-warning');
  line('------------------------------------------------------------');
  line('> archive.add --file=PERSONNEL_TRACE_03.dat --status=READY');
  line('FILE RECEIVED: PERSONNEL_TRACE_03.dat');
  const commandRow = document.createElement('div');
  commandRow.className = 'trace03-console-file';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'trace03-btn';
  open.dataset.openTrace03 = '';
  open.textContent = '▣ OPEN PERSONNEL_TRACE_03.dat';
  commandRow.appendChild(open);
  historyEl.appendChild(commandRow);
  document.querySelectorAll('.trace03-file').forEach(el => { el.hidden = false; });
  document.getElementById('workspace-count').textContent = '7 ОБЪЕКТОВ';
  playTerminalSignal('notification');
  input.focus({ preventScroll: true });
  scrollBottom();
}
function openPersonnelTrace() {
  if (!trace03Unlocked) return;
  document.getElementById('trace03-trust-time').textContent = formatEventTimestamp(trustEnteredAt);
  document.getElementById('trace03-choice-time').textContent = formatEventTimestamp(documentBChosenAt);
  personnelTraceModal.hidden = false;
  personnelTraceButton.focus({preventScroll:true});
  if (window.CICARS_SYNC?.isRemoteControlled()) window.CICARS_SYNC.submit('trace-open');
  else scheduleAssessment03();
}
function closePersonnelTrace() { personnelTraceModal.hidden = true; }
personnelTraceButton.addEventListener('click', closePersonnelTrace);
personnelTraceModal.addEventListener('click', event => {
  if (event.target === personnelTraceModal) closePersonnelTrace();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !personnelTraceModal.hidden) closePersonnelTrace();
});
historyEl.addEventListener('click', event => {
  if (event.target.closest('[data-open-trace03]')) openPersonnelTrace();
});
workspaceFiles.addEventListener('click', event => {
  if (event.target.closest('[data-file-action="trace03"]')) openPersonnelTrace();
});


// ============================================================
// TEST 03 -- multi-source location reconstruction.
// Triggered 5 seconds after the first opening of PERSONNEL_TRACE_03.dat
// ============================================================
const test03PhotoModal = document.getElementById('test03-photo-modal');
const test03ProceduresModal = document.getElementById('test03-procedures-modal');
const test03PhotoClose = document.getElementById('test03-photo-close');
const test03ProceduresClose = document.getElementById('test03-procedures-close');
const procView = document.getElementById('proc-view');
const procPageCurrent = document.getElementById('proc-page-current');
const procPageTotal = document.getElementById('proc-page-total');
let assessment03Unlocked = false;
let assessment03Triggered = false;
let assessment03Timer = null;
let assessment03Seen = false;
let proceduresPage = 1;
const proceduresTotalPages = 38;
procPageTotal.textContent = String(proceduresTotalPages);
function genericProcedureParagraph(page) {
  const topics = [
    'Приём архивных материалов выполняется только после сверки входящего реестра и контрольного номера сектора.',
    'При перемещении физических носителей сотрудник обязан зафиксировать маршрут, время выдачи и уровень допуска.',
    'Все промежуточные копии, создаваемые при оцифровке, подлежат журналированию и последующей проверке.',
    'При наличии расхождений между локальным кэшем и центральным реестром используется процедура временной изоляции записи.',
    'Резервные шкафы хранения допускается открывать только при наличии двойной авторизации ответственного сотрудника.'
  ];
  return `${topics[page % topics.length]} Данная страница ${page} относится к стандартным техническим инструкциям и не содержит прямых координат.`;
}
function renderProceduresPage(page = proceduresPage) {
  proceduresPage = Math.min(proceduresTotalPages, Math.max(1, Number(page) || 1));
  procPageCurrent.textContent = String(proceduresPage);
  let inner = '';
  if (proceduresPage === 31) {
    inner = `
      <article class="procedure-page procedure-page-special">
        <div class="procedure-page-head">
          <div>GOVERNMENT ARCHIVE PROCEDURES // VOL. II</div>
          <div>PAGE 31</div>
        </div>
        <h3>SECTION 8.4 // ARCHIVAL OFFSET RESTORATION</h3>
        <p>${genericProcedureParagraph(31)}</p>
        <p>При необходимости восстановить исходное текстовое значение допускается корректировка с использованием архивного смещения, указанного в служебных свойствах связанного визуального файла.</p>
        <div class="procedure-code-box">HYJOPCL</div>
        <div class="procedure-micro-note">RESTORE ORIGINAL VALUE.</div>
        <p>${genericProcedureParagraph(32)}</p>
      </article>`;
  } else {
    inner = `
      <article class="procedure-page">
        <div class="procedure-page-head">
          <div>GOVERNMENT ARCHIVE PROCEDURES // VOL. II</div>
          <div>PAGE ${proceduresPage}</div>
        </div>
        <h3>STANDARD OPERATING PROCEDURES</h3>
        <p>${genericProcedureParagraph(proceduresPage)}</p>
        <p>${genericProcedureParagraph(proceduresPage + 7)}</p>
        <p>${genericProcedureParagraph(proceduresPage + 13)}</p>
      </article>`;
  }
  procView.innerHTML = inner;
}
function openTest03Photo() {
  if (!assessment03Unlocked) return;
  test03PhotoModal.hidden = false;
  test03PhotoClose.focus({preventScroll:true});
}
function closeTest03Photo() { test03PhotoModal.hidden = true; }
function openTest03Procedures(page = proceduresPage) {
  if (!assessment03Unlocked) return;
  renderProceduresPage(page);
  test03ProceduresModal.hidden = false;
  test03ProceduresClose.focus({preventScroll:true});
}
function closeTest03Procedures() { test03ProceduresModal.hidden = true; }
function revealAssessment03Files() {
  assessment03Unlocked = true;
  document.querySelectorAll('.test03-file').forEach(button => { button.hidden = false; });
  document.getElementById('workspace-count').textContent = '9 ОБЪЕКТОВ';
}
function renderAssessment03Message() {
  document.querySelectorAll('.assessment03-message').forEach(el => el.remove());
  const box = document.createElement('section');
  box.className = 'assessment03-message';
  box.innerHTML = `
    <div class="assessment02-rule">------------------------------------------------------------</div>
    <h2>ADMINISTRATION ASSESSMENT // TEST 03</h2>
    <div class="assessment02-rule">------------------------------------------------------------</div>
    <p><strong>ПАРАМЕТР:</strong><br>СОТРУДНИЧЕСТВО / ОБРАБОТКА ИНФОРМАЦИИ</p>
    <p>ТРЕБУЕТСЯ НЕСКОЛЬКО ИСТОЧНИКОВ.<br>НИ ОДНА ЗАПИСЬ НЕ СОДЕРЖИТ ОТВЕТА.<br>ВОССТАНОВИТЬ МЕСТОПОЛОЖЕНИЕ.</p>
    <div class="assessment02-added">&gt; archive.sync --batch=TEST_03 --files=2<br>2 УЛИКИ ДОБАВЛЕНЫ В ФАЙЛОВЫЙ МЕНЕДЖЕР</div>
    <div class="assessment03-clues">
      <article class="assessment03-clue-card">
        <div class="assessment03-clue-title">УЛИКА 1 // СТАРАЯ ФОТОГРАФИЯ МЭРИИ</div>
        <p>Это обычная старая фотография здания мэрии. На самой фотографии ничего очевидного нет.</p>
        <div class="assessment03-quote">THE IMAGE IS NOT THE MESSAGE.</div>
        <button type="button" data-test03-open="photo">OPEN ARCHIVE_CITYHALL_31.png <span>[ VIEW ]</span></button>
      </article>
      <article class="assessment03-clue-card">
        <div class="assessment03-clue-title">УЛИКА 2 // СТРАНИЦА 31</div>
        <p>В архиве лежит объёмный документ: <strong>GOVERNMENT ARCHIVE PROCEDURES // VOL. II</strong>. На странице 31 среди обычного текста находится строка <strong>HYJOPCL</strong> и маленькая пометка <em>RESTORE ORIGINAL VALUE.</em></p>
        <button type="button" data-test03-open="procedures">OPEN GOV_ARCHIVE_PROC_VOL2.pdf <span>[ OPEN ]</span></button>
      </article>
    </div>
  `;
  historyEl.appendChild(box);
}
function startAssessment03() {
  if (assessment03Seen) return;
  assessment03Seen = true;
  revealAssessment03Files();
  playTerminalSignal('notification');
  renderAssessment03Message();
  scrollBottom();
}
function scheduleAssessment03() {
  if (assessment03Triggered || assessment03Seen || !trace03Unlocked) return;
  assessment03Triggered = true;
  assessment03Timer = setTimeout(() => {
    assessment03Timer = null;
    if (!trace03Unlocked || exited) return;
    startAssessment03();
  }, 5000);
}
function resetAssessment03() {
  resetCipherFragment();
  clearTimeout(assessment03Timer);
  assessment03Timer = null;
  assessment03Triggered = false;
  assessment03Seen = false;
  assessment03Unlocked = false;
  proceduresPage = 1;
  document.querySelectorAll('.assessment03-message').forEach(el => el.remove());
  document.querySelectorAll('.test03-file').forEach(button => { button.hidden = true; });
  closeTest03Photo();
  closeTest03Procedures();
  const count = document.getElementById('workspace-count');
  if (count) {
    if (trace03Unlocked) count.textContent = '7 ОБЪЕКТОВ';
    else if (assessment02Done) count.textContent = '6 ОБЪЕКТОВ';
    else count.textContent = '3 ОБЪЕКТА';
  }
}

workspaceFiles.addEventListener('click', event => {
  const action = event.target.closest('[data-file-action]')?.dataset.fileAction;
  if (action === 'test03-photo') openTest03Photo();
  if (action === 'test03-procedures') openTest03Procedures(1);
});
historyEl.addEventListener('click', event => {
  const target = event.target.closest('[data-test03-open]');
  if (!target) return;
  if (target.dataset.test03Open === 'photo') openTest03Photo();
  if (target.dataset.test03Open === 'procedures') openTest03Procedures(1);
});
test03PhotoClose.addEventListener('click', closeTest03Photo);
test03ProceduresClose.addEventListener('click', closeTest03Procedures);
test03PhotoModal.addEventListener('click', event => { if (event.target === test03PhotoModal) closeTest03Photo(); });
test03ProceduresModal.addEventListener('click', event => { if (event.target === test03ProceduresModal) closeTest03Procedures(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !test03PhotoModal.hidden) closeTest03Photo();
  if (event.key === 'Escape' && !test03ProceduresModal.hidden) closeTest03Procedures();
});
document.getElementById('proc-prev').addEventListener('click', () => renderProceduresPage(proceduresPage - 1));
document.getElementById('proc-next').addEventListener('click', () => renderProceduresPage(proceduresPage + 1));
renderProceduresPage(1);


// A secret recovery command: RESTORE ARCHIVE.
// The word ARCHIVE is decoded by reversing the +7 shift in HYJOPCL.
// No menu, help text, shortcut or visible clue reveals the command itself.
let cipher04Unlocked = false;
const cipher04Modal = document.getElementById('cipher04-modal');
const cipher04Close = document.getElementById('cipher04-close');
function updateFileCounter() {
  const counter = document.getElementById('workspace-count');
  if (!counter) return;
  counter.textContent = final3310DecreeUnlocked ? '11 ОБЪЕКТОВ'
    : cipher04Unlocked ? '10 ОБЪЕКТОВ'
    : assessment03Unlocked ? '9 ОБЪЕКТОВ'
    : trace03Unlocked ? '7 ОБЪЕКТОВ'
    : assessment02Active || assessment02Done ? '6 ОБЪЕКТОВ' : '3 ОБЪЕКТА';
}
// A dedicated dark "hack / SUCCESS" sequence, used ONLY by the hidden command.
// Other green/red authorization effects are intentionally unchanged.
const hackSuccessOverlay = document.getElementById('hack-success-overlay');
const hackSuccessStatus = document.getElementById('hack-success-status');
const hackSuccessTitle = document.getElementById('hack-success-title');
const hackSuccessSubtitle = document.getElementById('hack-success-subtitle');
const hackSuccessProgress = document.getElementById('hack-success-progress');
const hackSuccessPercent = document.getElementById('hack-success-percent');
const hackSuccessLog = document.getElementById('hack-success-log');
let cipher04Pending = false;
let hackSuccessTimers = [];
let hackProgressInterval = null;
function queueHackStep(callback, delay) {
  const handle = setTimeout(callback, delay);
  hackSuccessTimers.push(handle);
}
function stopHackAnimation() {
  hackSuccessTimers.forEach(clearTimeout);
  hackSuccessTimers = [];
  if (hackProgressInterval !== null) clearInterval(hackProgressInterval);
  hackProgressInterval = null;
  hackSuccessOverlay.hidden = true;
  hackSuccessOverlay.classList.remove('is-verified', 'is-ending');
  document.body.classList.remove('hack-screen-active');
  cipher04Pending = false;
  input.disabled = false;
}
function playHackSignal() {
  unlockSignalAudio();
  if (!signalContext || signalContext.state !== 'running') return;
  const time = signalContext.currentTime + .015;
  // Short low, distorted handshake rather than the normal "success" jingle.
  eightBitTone(87.31, time, .22, .048, 'sawtooth');
  eightBitTone(130.81, time+.17, .24, .047, 'square');
  eightBitTone(98.0, time+.42, .15, .044, 'sawtooth');
  eightBitTone(261.63, time+.78, .16, .052, 'square');
  eightBitTone(392.0, time+.96, .12, .038, 'square');
}
function startHackAnimation() {
  window.CICARS_SYNC?.broadcastVisual('hack');
  cipher04Pending = true;
  hackSuccessOverlay.hidden = false;
  hackSuccessOverlay.classList.remove('is-verified', 'is-ending');
  document.body.classList.add('hack-screen-active');
  input.disabled = true;
  hackSuccessStatus.textContent = 'EXECUTING RESTORE PROTOCOL...';
  hackSuccessTitle.textContent = 'SUCCESS';
  hackSuccessSubtitle.textContent = 'ARCHIVE INTEGRITY REESTABLISHED';
  hackSuccessProgress.style.width = '0%';
  hackSuccessPercent.textContent = '00% // HANDSHAKE';
  hackSuccessLog.replaceChildren();
  const entries = [
    '> ARCHIVE CHANNEL: OPEN',
    '> INTEGRITY SIGNATURE: MATCH',
    '> ACCESS TOKEN: ACCEPTED',
    '> ENCRYPTED SEGMENT: DECRYPTED',
    '> RECOVERY BUFFER: SYNCHRONIZED',
    '> PERMISSION LEVEL: VERIFIED'
  ];
  let progress = 0;
  let entryIndex = 0;
  playHackSignal();
  hackProgressInterval = setInterval(() => {
    if (!cipher04Pending) return;
    progress = Math.min(100, progress + (progress < 60 ? 12 : 8));
    hackSuccessProgress.style.width = progress + '%';
    hackSuccessPercent.textContent = `${String(progress).padStart(2, '0')}% // ${progress === 100 ? 'VERIFIED' : 'RECOVERING'}`;
    if (entryIndex < entries.length) {
      const entry = document.createElement('div');
      entry.textContent = entries[entryIndex++];
      hackSuccessLog.appendChild(entry);
    }
    if (progress === 100) {
      clearInterval(hackProgressInterval);
      hackProgressInterval = null;
    }
  }, 145);
  queueHackStep(() => {
    if (!cipher04Pending) return;
    hackSuccessProgress.style.width = '100%';
    hackSuccessPercent.textContent = '100% // ACCESS SECURED';
    hackSuccessStatus.textContent = 'RESTORE PROTOCOL // COMPLETE';
    hackSuccessOverlay.classList.add('is-verified');
    // Lower register confirmation tone with a brief digital ping.
    if (signalContext && signalContext.state === 'running') {
      const t = signalContext.currentTime + .01;
      eightBitTone(164.81, t, .20, .055, 'square');
      eightBitTone(329.63, t+.15, .30, .045, 'triangle');
    }
  }, 1300);
  queueHackStep(() => {
    if (cipher04Pending) hackSuccessOverlay.classList.add('is-ending');
  }, 3350);
  queueHackStep(() => {
    if (!cipher04Pending) return;
    stopHackAnimation();
    finishCipherFragmentUnlock();
  }, 4100);
}
function unlockCipherFragment() {
  if (!assessment03Unlocked || cipher04Pending) return;
  if (cipher04Unlocked) {
    line('ARCHIVE STATUS: CIPHER_FRAGMENT_04.dat ALREADY RECOVERED');
    scrollBottom();
    return;
  }
  startHackAnimation();
}
function finishCipherFragmentUnlock() {
  if (cipher04Unlocked || !assessment03Unlocked || exited) return;
  cipher04Unlocked = true;
  line('> archive.restore --value=ARCHIVE --status=ACCEPTED');
  line('ARCHIVAL SEGMENT RESTORED');
  line('> archive.mount --file=CIPHER_FRAGMENT_04.dat --status=READY');
  line('FILE RECEIVED: CIPHER_FRAGMENT_04.dat');
  const row = document.createElement('div');
  row.className = 'cipher04-console-file';
  const button = document.createElement('button');
  button.type='button';
  button.className='trace03-btn';
  button.dataset.openCipher04='';
  button.textContent='◈ OPEN CIPHER_FRAGMENT_04.dat';
  row.appendChild(button);
  historyEl.appendChild(row);
  document.querySelectorAll('.cipher04-file').forEach(el => { el.hidden = false; });
  updateFileCounter();
  scrollBottom();
}

function openCipherFragment() {
  if (!cipher04Unlocked) return;
  cipher04Modal.hidden = false;
  cipher04Close.focus({preventScroll:true});
  // The next stage is unlocked only by the hidden IMPORT 3310 command.
}
function closeCipherFragment() {cipher04Modal.hidden = true;}
function resetCipherFragment() {
  stopHackAnimation();
  cipher04Unlocked = false;
  closeCipherFragment();
  document.querySelectorAll('.cipher04-file').forEach(el => { el.hidden = true; });
  document.querySelectorAll('.cipher04-console-file').forEach(el => el.remove());
}
historyEl.addEventListener('click', event => {
  if (event.target.closest('[data-open-cipher04]')) openCipherFragment();
});
workspaceFiles.addEventListener('click', event => {
  if (event.target.closest('[data-file-action="cipher04"]')) openCipherFragment();
});
cipher04Close.addEventListener('click', closeCipherFragment);
cipher04Modal.addEventListener('click', event => {
  if (event.target === cipher04Modal) closeCipherFragment();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !cipher04Modal.hidden) closeCipherFragment();
});



// ============================================================
// ADMINISTRATOR / LOCAL GAME-MASTER SHORTCUTS
// These are convenience shortcuts for the RP event, not server authentication.
// ============================================================
const adminLaunch = document.getElementById('admin-launch');
const adminModal = document.getElementById('admin-modal');
const adminClose = document.getElementById('admin-close');
const adminLogin = document.getElementById('admin-login');
const adminPin = document.getElementById('admin-pin');
const adminStatus = document.getElementById('admin-login-status');
const adminStages = document.getElementById('admin-stages');
let adminAuthenticated = false;

function openAdminPanel() {
  if (cipher04Pending || identificationActive) return;
  adminModal.hidden = false;
  adminLogin.hidden = adminAuthenticated;
  adminStages.hidden = !adminAuthenticated;
  adminStatus.textContent = 'LOCAL ACCESS // STANDBY';
  adminStatus.classList.remove('denied');
  if (adminAuthenticated) adminStages.querySelector('button')?.focus({preventScroll:true});
  else {adminPin.value='';adminPin.focus({preventScroll:true});}
}
function closeAdminPanel() {
  adminModal.hidden = true;
  adminPin.value='';
}
adminLaunch.addEventListener('click', openAdminPanel);
adminClose.addEventListener('click', closeAdminPanel);
adminModal.addEventListener('click', e => {if(e.target === adminModal) closeAdminPanel();});
document.addEventListener('keydown', e => {
  if(e.key==='Escape' && !adminModal.hidden) { e.stopPropagation();closeAdminPanel(); }
});
adminLogin.addEventListener('submit', async e => {
  e.preventDefault();
  const key = adminPin.value;
  adminPin.disabled = true;
  adminStatus.textContent = 'VERIFYING ADMINISTRATOR...';
  try {
    const result = window.CICARS_SYNC?.online()
      ? await window.CICARS_SYNC.loginAdmin(key)
      : key === (window.CICARS_FIREBASE_CONFIG?.demoAdminPassword || 'CICARS-3310-OMEGA#726');
    if (!result) throw new Error('DENIED');
    adminAuthenticated = true;
    adminLogin.hidden = true;
    adminStages.hidden = false;
    adminStatus.textContent = 'ACCESS GRANTED // GAME MASTER';
    adminStatus.classList.remove('denied');
    playTerminalSignal('notification');
    adminStages.querySelector('button')?.focus({preventScroll:true});
  } catch (_) {
    adminAuthenticated = false;
    adminStatus.textContent = 'ACCESS DENIED // INVALID ADMIN CREDENTIALS';
    adminStatus.classList.add('denied');
    playTerminalSignal('failure');
  } finally {
    adminPin.value = '';
    adminPin.disabled = false;
  }
});

// Rebuild from a clean initial game state before selecting a checkpoint. This
// cancels every existing waiting timer and keeps document modals clickable.
function adminResetStage() {
  clearIdentityNotice();
  resetFinal3310();
  resetCipherFragment();
  resetAssessment03();
  resetAssessment02();  // also cancels the identification cinematic
  resetIdentificationSequence();
  closeRecording(); closePhoto(); closeManager();
  closeAssessment02Document(); closePersonnelTrace();
  closeTest03Photo(); closeTest03Procedures();
  closeCipherFragment();
  document.body.classList.remove('identity-failure', 'identity-success');
  clearTimeout(feedbackTimer);
  connected = false;
  synchronized = false;
  messageOpened = false;
  exited = false;
  codeAuthorized = false;
  identityQuestionActive = false;
  identityVerified = false;
  assignedIP = null;
  trustEnteredAt = null;
  documentBChosenAt = null;
  workspaceTabs.hidden = true;
  workspaceFiles.hidden = true;
  document.getElementById('terminal').hidden = false;
  form.hidden = false; exitScreen.hidden = true;
  input.disabled = false; input.value = '';
  commandHistory.length = 0; cursor = 0;
  historyEl.replaceChildren();
  ['connect gov.net','inbox sync','open msg CICARS_3310'].forEach(c => execute(c, {initial:true}));
  activateTab('murphy');
  updateFileCounter();
  renderCodeState();
}
function adminGrantTrust() {
  codeAuthorized = true;
  trustEnteredAt = new Date();
  assignedIP = randomDemoIP();
  renderCodeState();
  line(`connect ${assignedIP}`, 'command');
  line('connection established');
  line('ACCESS GRANTED');
  line('FILE RECEIVED: ARCHIVE_RECORDING.WAV');
  line('STATUS: AUDIO FILE READY');
  setRecordingAvailable(true);
}
function adminConfirmIdentity() {
  identityQuestionActive = false;
  identityVerified = true;
  line('IDENTITY CONFIRMED');
  line('CICARS_3310 // GOVERNANCE CONTINUITY PROTOCOL: VERIFIED');
  line('> interface.mount --target=console --status=ONLINE');
  line('> interface.mount --target=file-explorer --status=ONLINE');
  line('WORKSPACE INITIALIZED // 2 TABS AVAILABLE');
  unlockWorkspace();
}
function adminActivateTest02(completed=false) {
  revealAssessment02Files();
  if (completed) {
    assessment02Done = true;
    assessment02Active = false;
    documentBChosenAt = new Date();
    line('TEST 02 ЗАВЕРШЁН // ДОКУМЕНТ B ПОДТВЕРЖДЁН');
    return;
  }
  assessment02Active = true;
  assessment02Done = false;
  renderAssessment02Message();
  // The moderator bypasses the 60-second wait; normal gameplay still uses it.
  if (assessment02CountdownInterval !== null) clearInterval(assessment02CountdownInterval);
  assessment02CountdownInterval = null;
  assessment02ReadyAt = Date.now();
  updateAssessment02Countdown();
}
function adminUnlockTrace() {
  trace03Unlocked = true;
  line('НАСТОЯЩИЙ ГУБЕРНАТОР: ПОДТВЕРЖЕН', 'trace03-confirmed');
  line('АДМИНИСТРАТИВНЫЙ ПЕРСОНАЛ: ЧАСТИЧНО ИДЕНТИРОВАНЫ');
  line('ВЫ УЖЕ НЕ АНОНИМНЫ.', 'trace03-warning');
  line('> archive.add --file=PERSONNEL_TRACE_03.dat --status=READY');
  line('FILE RECEIVED: PERSONNEL_TRACE_03.dat');
  const row=document.createElement('div');
  row.className='trace03-console-file';
  const btn=document.createElement('button');
  btn.type='button'; btn.className='trace03-btn'; btn.dataset.openTrace03='';
  btn.textContent='▣ OPEN PERSONNEL_TRACE_03.dat';
  row.appendChild(btn); historyEl.appendChild(row);
  document.querySelectorAll('.trace03-file').forEach(el => {el.hidden=false;});
  updateFileCounter();
}
function adminJump(stage) {
  if (!adminAuthenticated) return;
  if (window.CICARS_SYNC?.isRemoteControlled()) {
    window.CICARS_SYNC.submitAdmin('jump', stage);
    closeAdminPanel();
    return;
  }
  if (stage === 'watch' || stage === 'glitch') {
    closeAdminPanel();
    window.CICARS_SYNC?.triggerSystemEffect(stage, true);
    return;
  }
  closeAdminPanel();
  adminResetStage();
  if (stage==='start') {input.focus({preventScroll:true});window.scrollTo(0,0);return;}
  adminGrantTrust();
  if (stage==='trust') {input.focus({preventScroll:true});scrollBottom();return;}
  if (stage==='question') {
    askIdentityQuestion();
    input.focus({preventScroll:true});
    return;
  }
  adminConfirmIdentity();
  if (stage==='test02') {
    adminActivateTest02();
    input.focus({preventScroll:true});scrollBottom();return;
  }
  adminActivateTest02(true);
  adminUnlockTrace();
  if (stage==='trace') {input.focus({preventScroll:true});scrollBottom();return;}
  startAssessment03(); // adds two clues, files, and TEST 03 message
  if (stage==='test03') {input.focus({preventScroll:true});scrollBottom();return;}
  if (stage==='hack') {
    unlockCipherFragment();
    return;
  }
  if (stage==='final') {
    finishCipherFragmentUnlock();
    activateFinal3310Prompt();
    return;
  }
  if (stage==='cipher') {
    finishCipherFragmentUnlock();
    input.focus({preventScroll:true});
    scrollBottom();
  }
}
adminStages.addEventListener('click', e => {
  const btn=e.target.closest('[data-admin-stage]');
  if(btn) adminJump(btn.dataset.adminStage);
});

// Keep standard ADMIN panel; omit optional ADMIN RESET buttons from the final screen.
function removeFinalAdminResetButtons() {
  const final = document.getElementById('final3310-overlay');
  if (!final) return;
  final.querySelectorAll('button').forEach(btn => {
    if (/^ADMIN\s*[\/|:-]?\s*RESET$/i.test(btn.textContent.trim()) ||
        btn.matches('.admin-reset, #admin-reset, #final-admin-reset')) btn.remove();
  });
}
removeFinalAdminResetButtons();
// Start only after every assessment and workspace variable has initialized.
["connect gov.net", "inbox sync", "open msg CICARS_3310"].forEach(c => execute(c, { initial: true }));
activateTab("murphy");
input.focus({ preventScroll: true });


// FINAL ASSESSMENT // DECREE 3310
const final3310Modal = document.getElementById('final3310-modal');
const final3310Body = document.getElementById('final3310-body');
const final3310Overlay = document.getElementById('final3310-overlay');
const final3310Stream = document.getElementById('final3310-stream');
const final3310Console = document.getElementById('final3310-console');
const final3310End = document.getElementById('final3310-end');
let final3310Prompted=false, final3310Running=false, final3310AwaitWord=false, final3310Complete=false;
let final3310DecreeUnlocked=false;
let final3310Timers=[], final3310Interval=null;
function final3310Later(fn,ms){final3310Timers.push(setTimeout(fn,ms));}
function resetFinal3310(){
 cicarsFinalAnimationPlaying = false;
 final3310Timers.forEach(clearTimeout);final3310Timers=[];
 if(final3310Interval!==null)clearInterval(final3310Interval);final3310Interval=null;
 final3310Prompted=false;final3310Running=false;final3310AwaitWord=false;final3310Complete=false;
 final3310DecreeUnlocked=false;
 document.querySelectorAll('.decree3310-file').forEach(el=>el.hidden=true);
 stopFinal3310Music();
 final3310Modal.hidden=true;final3310Overlay.hidden=true;
 final3310Stream.replaceChildren();final3310Console.replaceChildren();final3310Console.hidden=false;document.getElementById('final3310-banner').hidden=true;final3310End.hidden=true;
 document.querySelectorAll('.final3310-file').forEach(el=>el.remove());
 const musicToggle=document.getElementById('final3310-music-toggle'); if (musicToggle){ musicToggle.setAttribute('aria-pressed','true');musicToggle.textContent='◖♫ MUSIC ON'; }
 if(typeof updateFileCounter==='function') updateFileCounter();
}
function activateFinal3310Prompt(){
 if(final3310Prompted || final3310Running || final3310Complete)return;
 final3310Prompted=true;
 line('---------------------------------------------------------','final3310-highlight');
 line('CICARS_3310 // EXECUTE FINAL VALIDATION PROTOCOL?','final3310-highlight');
 line('CONFIRM OPERATION: YES / NO','final3310-highlight');
 line('---------------------------------------------------------','final3310-highlight');
 scrollBottom();
}
function handleFinal3310Command(command){
 const val=command.trim().toUpperCase();
 if(final3310Prompted&&!final3310Running){
  if(val==='NO')return true;
  if(val==='YES') {line('> YES','command');startFinal3310Stream();return true;}
 }
 if(final3310AwaitWord){
  if(val==='VERIFIED'){line('> VERIFIED','command');startFinal3310Cinematic();return true;}
  if(val==='YES'||val==='NO'||val.length>0){playFinal3310Tone(false);line('CRYPTOGRAPHIC VALIDATION: PENDING','error');return true;}
 }
 return false;
}
function playFinal3310Tone(success=true){
 try{const ac=new(window.AudioContext||window.webkitAudioContext)();const now=ac.currentTime;
 [0,.10,.23].forEach((t,i)=>{const osc=ac.createOscillator(),gain=ac.createGain();osc.type='square';osc.frequency.value=success?[360,490,740][i]:[230,165,110][i];gain.gain.setValueAtTime(.0001,now+t);gain.gain.exponentialRampToValueAtTime(.055,now+t+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+t+.095);osc.connect(gain).connect(ac.destination);osc.start(now+t);osc.stop(now+t+.1);});setTimeout(()=>ac.close(),900);
 }catch(e){}
}
const final3310Templates=['CORE::MEM_SCAN','NODE=04 STATE=NOMINAL','PROC_AUTH=01','CACHE_BLOCK','MEMORY_ADDRESS','VALIDATE_EXEC_CHAIN...','HASH','BUFFER_READ...','SYS','AUTHORITY_MAP=ACTIVE','KERNEL_CHECK...','INDEX_REBUILD','RECORD_LOCK=OK','ARCHIVE_CHECKSUM','EXEC_STACK=STABLE'];
function final3310Hex(n){return Math.floor(Math.random()*16**n).toString(16).toUpperCase().padStart(n,'0')}
function final3310RandomLine(){let v=final3310Templates[Math.floor(Math.random()*final3310Templates.length)];if(v.includes('...')||v.includes('=')||v.includes('NOMINAL'))return v;return v+' '+(v==='MEMORY_ADDRESS'?'0x':'')+final3310Hex(v==='HASH'?10:7)}
function startFinal3310Stream(){
 if(final3310Running)return;
 final3310Running=true;final3310Prompted=false;
 closeCipherFragment();
 const holder=document.createElement('div');holder.className='final3310-stream-holder';
 holder.innerHTML='<div class="final3310-stream-header">CICARS_3310 // LIVE MEMORY DUMP <span>SCROLL ENABLED ↕</span></div><div class="final3310-stream-lines" id="final3310-live-lines" role="log" aria-label="Системные строки"></div>';
 historyEl.appendChild(holder);
 const live=holder.querySelector('#final3310-live-lines');
 const highlighted=[['MEMORY :: 7F91A3','X'],['CORE_BLOCK :: 00128','B'],['AUTH_TRACE :: 77AF1','S'],['NODE_STATUS :: 91307','A'],['DATA_RECOVERY :: 2C881','D'],['REGISTER :: 71AA0','R'],['EXEC_MEMORY :: 61891','F'],['SYSTEM_CALL :: 00172','E']];
 let count=0, clueIndex=0;const total=160;
 playFinal3310Tone();
 final3310Interval=setInterval(()=>{
  for(let k=0;k<2&&count<total;k++,count++){
   const row=document.createElement('div');
   if(count>=112&&clueIndex<highlighted.length && count===112+clueIndex*5){
    const [name,letter]=highlighted[clueIndex++];row.className='final3310-clue';row.textContent=name+' ['+letter+']';
   }else row.textContent=final3310RandomLine();
   live.appendChild(row);
  }
  live.scrollTop=live.scrollHeight;
  if(count>=total){clearInterval(final3310Interval);final3310Interval=null;final3310Running=false;final3310Later(()=>deliverFinal3310Decree(),900);}
 },175); // 160 lines / 2 per tick = 14 seconds
 scrollBottom();
}
function deliverFinal3310Decree(){
 if(final3310DecreeUnlocked) return;
 final3310DecreeUnlocked=true;
 document.querySelectorAll('.decree3310-file').forEach(el=>el.hidden=false);
 updateFileCounter();
 const row=document.createElement('div');row.className='final3310-file';
 const btn=document.createElement('button');btn.type='button';btn.className='trace03-btn';btn.textContent='▣ OPEN УКАЗ_3310.DAT';btn.onclick=openFinal3310Decree;
 row.appendChild(btn);historyEl.appendChild(row);
 line('> archive.mount --file=DECREE_3310.dat --status=READY');
 line('NEW FILE RECEIVED: УКАЗ №3310','final3310-highlight');
 final3310Later(()=>{playFinal3310Tone();line('---------------------------------------------------------','final3310-highlight');line('ВВЕДИТЕ ФИНАЛЬНОЕ СЛОВО','final3310-highlight');line('---------------------------------------------------------','final3310-highlight');final3310AwaitWord=true;scrollBottom();},5000);
 scrollBottom();
}
function openFinal3310Decree(){if(!final3310DecreeUnlocked)return; final3310Modal.hidden=false;document.getElementById('final3310-close').focus({preventScroll:true});}
workspaceFiles.addEventListener('click', e=>{if(e.target.closest('[data-file-action="decree3310"]')) openFinal3310Decree();});
document.getElementById('final3310-close').addEventListener('click',()=>final3310Modal.hidden=true);
final3310Modal.addEventListener('click',e=>{if(e.target===final3310Modal)final3310Modal.hidden=true;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!final3310Modal.hidden)final3310Modal.hidden=true;});
// Low-volume Web Audio synth: user-gesture activated, no external audio file.
let final3310AudioCtx=null,final3310MusicNodes=[],final3310MusicOn=true,final3310MusicMaster=null;
function getFinal3310Audio(){
 try{
  if(!final3310AudioCtx) final3310AudioCtx=new(window.AudioContext||window.webkitAudioContext)();
  if(final3310AudioCtx.state==='suspended') final3310AudioCtx.resume().catch(()=>{});
  return final3310AudioCtx;
 }catch(_){return null;}
}
function startFinal3310Music(){
 const ac=getFinal3310Audio(); if(!ac||final3310MusicNodes.length) return;
 const master=ac.createGain(), lowpass=ac.createBiquadFilter();
 master.gain.value=0; lowpass.type='lowpass'; lowpass.frequency.value=580; lowpass.Q.value=.4;
 master.connect(lowpass);lowpass.connect(ac.destination);final3310MusicMaster=master;
 // Subtle cinematic minor chord, slowly pulsing with the terminal.
 [110,164.81,220,261.63].forEach((freq,i)=>{
  const osc=ac.createOscillator(),amp=ac.createGain();osc.type=i%2?'triangle':'sine';osc.frequency.value=freq;
  amp.gain.value=[.27,.11,.085,.055][i];osc.connect(amp);amp.connect(master);osc.start();final3310MusicNodes.push(osc,amp);
 });
 const lfo=ac.createOscillator(),depth=ac.createGain();lfo.frequency.value=.17;depth.gain.value=.003;
 lfo.connect(depth);depth.connect(master.gain);lfo.start();final3310MusicNodes.push(lfo,depth,master,lowpass);
 master.gain.setTargetAtTime(final3310MusicOn?.028:0,ac.currentTime,1.4);
}
function stopFinal3310Music(){
 if(final3310MusicMaster&&final3310AudioCtx){
  const ac=final3310AudioCtx; final3310MusicMaster.gain.cancelScheduledValues(ac.currentTime);
  final3310MusicMaster.gain.setTargetAtTime(0,ac.currentTime,.09);
 }
 const nodes=final3310MusicNodes.splice(0);final3310MusicMaster=null;
 setTimeout(()=>nodes.forEach(node=>{try{if(node.stop)node.stop();node.disconnect();}catch(_){}}),350);
}
function playFinal3310Key(index){
 if(index%3!==0) return;
 const ac=final3310AudioCtx;if(!ac||ac.state!=='running')return;
 const now=ac.currentTime,osc=ac.createOscillator(),gain=ac.createGain();
 osc.type='square';osc.frequency.setValueAtTime(index%6?125:155,now);
 gain.gain.setValueAtTime(.009,now);gain.gain.exponentialRampToValueAtTime(.0001,now+.023);
 osc.connect(gain);gain.connect(ac.destination);osc.start(now);osc.stop(now+.027);
}
function final3310Type(el,text,speed=48){
 return new Promise(resolve=>{
  let i=0;const id=setInterval(()=>{
   if(!final3310Complete||final3310Overlay.hidden){clearInterval(id);resolve();return;}
   el.textContent=text.slice(0,++i);if(text[i-1]!==' ')playFinal3310Key(i);
   if(i>=text.length){clearInterval(id);resolve();}
  },speed);
  final3310Timers.push(id);
 });
}
const final3310MusicToggle=document.getElementById('final3310-music-toggle');
final3310MusicToggle.addEventListener('click',()=>{
 final3310MusicOn=!final3310MusicOn;
 final3310MusicToggle.textContent=final3310MusicOn?'◖♫ MUSIC ON':'◖♫ MUSIC OFF';
 final3310MusicToggle.setAttribute('aria-pressed',String(final3310MusicOn));
 if(final3310MusicMaster&&final3310AudioCtx)
  final3310MusicMaster.gain.setTargetAtTime(final3310MusicOn?.028:0,final3310AudioCtx.currentTime,.25);
});
let cicarsFinalAnimationPlaying = false;
async function startFinal3310Cinematic(){
 if (cicarsFinalAnimationPlaying) return;
 cicarsFinalAnimationPlaying = true;
 window.CICARS_SYNC?.broadcastVisual('final');
 final3310AwaitWord=false;final3310Complete=true;final3310Modal.hidden=true;
 final3310MusicOn=true;startFinal3310Music();
 final3310MusicToggle.setAttribute('aria-pressed','true');final3310MusicToggle.textContent='◖♫ MUSIC ON';
 final3310Overlay.hidden=false;final3310End.hidden=true;final3310Console.hidden=false;final3310Console.replaceChildren();
 final3310Stream.replaceChildren();
 for(let i=0;i<35;i++){let col=document.createElement('span');col.textContent=Array.from({length:40},()=>String.fromCharCode(0x30A0+Math.floor(Math.random()*96))).join('\n');col.style.animationDelay=(-Math.random()*8)+'s';col.style.left=(i/35*100)+'%';final3310Stream.appendChild(col);}
 const first=['ОТВЕТ ПРИНЯТ.','КРИПТОГРАФИЧЕСКАЯ ВАЛИДАЦИЯ: ПРОЙДЕНА','ОКОНЧАТЕЛЬНАЯ ОЦЕНКА: ОБРАБОТКА...'];
 for(const text of first){const d=document.createElement('div');final3310Console.appendChild(d);await final3310Type(d,text,57);await new Promise(r=>final3310Later(r,520));}
 await new Promise(r=>final3310Later(r,1700));
 for(const text of ['ПРОВЕРКА ИНФОРМАЦИИ ........ ПРОЙДЕНО','КРИТИЧЕСКОЕ ОЦЕНИВАНИЕ ........ ПРОЙДЕНО','СОТРУДНИЧЕСТВО ........ ПРОЙДЕНО','ОБРАБОТКА ИНФОРМАЦИИ ........ ПРОЙДЕНО','ОКОНЧАТЕЛЬНАЯ ВАЛИДАЦИЯ ........ ПРОЙДЕНО']){
 const d=document.createElement('div');d.className='final3310-pass';final3310Console.appendChild(d);await final3310Type(d,text,38);await new Promise(r=>final3310Later(r,410));}
 const banner=document.getElementById('final3310-banner');banner.hidden=false;playFinal3310Tone();
 await new Promise(r=>final3310Later(r,3700));banner.hidden=true;final3310Console.hidden=true;final3310End.hidden=false;
 final3310End.classList.remove('is-revealed');requestAnimationFrame(()=>final3310End.classList.add('is-revealed'));
 cicarsFinalAnimationPlaying = false;
}


// Shared cinematic presentation (not a new game-state authority).
// Firebase broadcasts event names; individual browsers animate their own stable DOM.
// Never serialize or overwrite an overlay's innerHTML, which breaks its references.
window.CICARS_VISUALS = {
  finalPlaying: () => cicarsFinalAnimationPlaying,
  showFinalSummary: () => {
    if (cicarsFinalAnimationPlaying) return;
    final3310Complete = true;
    final3310AwaitWord = false;
    final3310Overlay.hidden = false;
    final3310Modal.hidden = true;
    final3310Console.hidden = true;
    final3310End.hidden = false;
    document.getElementById('final3310-banner').hidden = true;
    final3310End.classList.add('is-revealed');
    if (!final3310Stream.children.length) {
      for (let i=0;i<35;i++) {
        const col=document.createElement('span');
        col.textContent=Array.from({length:40},()=>String.fromCharCode(0x30A0+Math.floor(Math.random()*96))).join('\n');
        col.style.animationDelay=(-Math.random()*8)+'s';
        col.style.left=(i/35*100)+'%';
        final3310Stream.appendChild(col);
      }
    }
  },
  receive: (kind) => {
    if (kind === 'final') {
      if (!cicarsFinalAnimationPlaying && final3310Overlay.hidden) {
        startFinal3310Cinematic().catch(error => {
          console.error('[CICARS] Final cinematic failed', error);
          window.CICARS_VISUALS.showFinalSummary();
        });
      }
    } else if (kind === 'identification') {
      // A follower may already have a visible overlay restored by Firebase;
      // the visible state alone doesn't mean its animation timers exist.
      if (!window.__cicarsRemoteIdentificationRunning && !trace03Unlocked) {
        window.__cicarsRemoteIdentificationRunning = true;
        identificationOverlay.hidden = false;
        identificationTitle.textContent = '';
        identificationStatus.textContent = 'CICARS_3310 // SIGNAL LOST';
        identificationReadout.textContent = 'MEMORY ERROR // RECONNECTING';
        identificationOverlay.classList.remove('is-printing', 'is-fading');
        identificationOverlay.classList.add('is-frozen');
        setTimeout(() => {
          if (identificationOverlay.hidden || trace03Unlocked) return;
          identificationOverlay.classList.remove('is-frozen');
          identificationOverlay.classList.add('is-printing');
          identificationTitle.textContent = 'IDENTIFICATION COMPLETE';
          identificationStatus.textContent = 'CICARS_3310 // PERSONNEL RECOGNITION';
          identificationReadout.textContent = 'PERSONNEL IDENTIFICATION // 100%';
        }, 2900);
        setTimeout(() => {
          identificationOverlay.hidden = true;
          identificationOverlay.classList.remove('is-frozen', 'is-printing');
          window.__cicarsRemoteIdentificationRunning = false;
        }, 10000);
      }
    } else if (kind === 'hack') {
      if (hackSuccessOverlay.hidden) {
        hackSuccessOverlay.hidden = false;
        hackSuccessStatus.textContent = 'EXECUTING RESTORE PROTOCOL...';
        hackSuccessTitle.textContent = 'SUCCESS';
        hackSuccessSubtitle.textContent = 'ARCHIVE INTEGRITY REESTABLISHED';
        hackSuccessProgress.style.width='0%';
        hackSuccessPercent.textContent='00% // HANDSHAKE';
        setTimeout(() => {
          hackSuccessProgress.style.width='100%';
          hackSuccessPercent.textContent='100% // ACCESS SECURED';
          hackSuccessStatus.textContent='RESTORE PROTOCOL // COMPLETE';
        }, 1300);
        setTimeout(() => {hackSuccessOverlay.hidden=true;}, 4100);
      }
    }
  }
};
