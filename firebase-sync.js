/* CICARS 3310 / realtime cooperative shared session
 * Firebase RTDB is the authority: only elected owner mutates game history.
 * Other clients send intents; input drafts and overlays are shared.
 * Locally opened files, tab choice, audio playback and ambient music stay local.
 */
(() => {
  'use strict';
  const cfg = window.CICARS_FIREBASE_CONFIG || {};
  const savedKey = 'cicars_3310_demo_progress_v3';
  const uidKey = 'cicars_browser_id_v1';
  const clientId = sessionStorage.getItem(uidKey) ||
    (self.crypto?.randomUUID?.() || `terminal-${Date.now()}-${Math.random()}`);
  sessionStorage.setItem(uidKey, clientId);
  const sessionParam = new URLSearchParams(location.search).get('room');
  const sessionId = /^[a-zA-Z0-9_-]{1,48}$/.test(sessionParam || '')
    ? sessionParam : (cfg.sessionId || 'cicars-3310-main');
  const stateStatus = document.createElement('div');
  stateStatus.className = 'session-indicator';
  stateStatus.textContent = 'SESSION // STARTING';
  stateStatus.setAttribute('role', 'status');
  document.body.append(stateStatus);
  let db = null, auth = null, base = null, user = null;
  let leader = false, online = false, linkActive = false;
  let dbOffset = 0, lastAppliedRev = 0, savedData = null;
  let applying = false, applyingDraft = false, lastSignature = '';
  let signalGuard = false, visualGuard = false;
  let lastSeenFx = null, lastEffectKind = null;
  let stateWriteBusy=false, pendingState=null;
  let lastUserAction = Date.now(), lastWatch = 0, nextGlitch = Date.now()+150000;
  let draftDebounces = new Map(), timers = [];
  let initReady = false, previousOverlayFinal = false;
  let isLoadingSnapshot = false;

  const status = text => { stateStatus.textContent = `SESSION ${sessionId} // ${text}`; };
  const now = () => Date.now() + dbOffset;
  const onlineMode = () => Boolean(cfg.enabled && db);
  const isRemoteControlled = () => onlineMode() && !leader;
  const isAuthority = () => !onlineMode() || leader;
  const ref = (suffix = '') => base.child(suffix);
  const err = (what, e) => { console.error(`[CICARS/FIREBASE] ${what}`, e); status(`SYNC ERROR · ${what}`); };
  // Never serialize an overlay's innerHTML: restoring it replaces nodes
  // referenced by app.js and turns cinematics into blank, black screens.
  const clone = el => ({shown: !el.hidden, classes: el.className});
  const overlayIds = ['identification-overlay', 'hack-success-overlay', 'final3310-overlay'];
  const flags = () => ({
    connected, synchronized, messageOpened, exited, codeAuthorized,
    assignedIP, identityQuestionActive, identityVerified,
    assessment02Active, assessment02Done, assessment02Queued,
    assessment02ReadyAt, assessment02FailedCount,
    trace03Unlocked, assessment03Unlocked, assessment03Triggered, assessment03Seen,
    cipher04Unlocked, cipher04Pending, final3310Prompted, final3310Running,
    final3310AwaitWord, final3310Complete, final3310DecreeUnlocked,
    identificationActive, trustEnteredAt: trustEnteredAt?.getTime() || null,
    documentBChosenAt: documentBChosenAt?.getTime() || null,
    lastWatch, nextGlitch,
  });

  function collect() {
    return {
      revision: Date.now(),
      history: historyEl.innerHTML,
      flags: flags(),
      overlays: Object.fromEntries(overlayIds.map(id => [id, clone(document.getElementById(id))])),
      fileUnlocks: Object.fromEntries(
        ['test02-file','trace03-file','test03-file','cipher04-file','decree3310-file']
          .map(name => [name, [...document.querySelectorAll('.'+name)].some(el => !el.hidden)])),
      fileCounter: document.getElementById('workspace-count')?.textContent || '',
      assessment02Remaining: Math.max(0,assessment02ReadyAt - Date.now()),
      inputDisabled: input.disabled,
      commandHistory: commandHistory.slice(-100),
      lastAction: lastUserAction,
    };
  }
  function setFlagValues(f) {
    if (!f) return;
    connected = !!f.connected; synchronized = !!f.synchronized;
    messageOpened = !!f.messageOpened; exited = !!f.exited;
    codeAuthorized = !!f.codeAuthorized; assignedIP = f.assignedIP || null;
    identityQuestionActive = !!f.identityQuestionActive;
    identityVerified = !!f.identityVerified;
    assessment02Active = !!f.assessment02Active;
    assessment02Done = !!f.assessment02Done;
    assessment02Queued = !!f.assessment02Queued;
    assessment02ReadyAt = f.assessment02ReadyAt || 0;
    assessment02FailedCount = f.assessment02FailedCount || 0;
    trace03Unlocked = !!f.trace03Unlocked;
    assessment03Unlocked = !!f.assessment03Unlocked;
    assessment03Triggered = !!f.assessment03Triggered;
    assessment03Seen = !!f.assessment03Seen;
    cipher04Unlocked = !!f.cipher04Unlocked;
    cipher04Pending = !!f.cipher04Pending;
    final3310Prompted = !!f.final3310Prompted;
    final3310Running = !!f.final3310Running;
    final3310AwaitWord = !!f.final3310AwaitWord;
    final3310Complete = !!f.final3310Complete;
    final3310DecreeUnlocked = !!f.final3310DecreeUnlocked;
    identificationActive = !!f.identificationActive;
    trustEnteredAt = f.trustEnteredAt ? new Date(f.trustEnteredAt) : null;
    documentBChosenAt = f.documentBChosenAt ? new Date(f.documentBChosenAt) : null;
    lastWatch = f.lastWatch || lastWatch;
    nextGlitch = f.nextGlitch || nextGlitch;
  }
  function patchOverlay(el, snap) {
    if (!el || !snap) return;
    // Do not change user's locally opened file dialogs, only shared cinematics.
    // Preserve original animation DOM and listeners; never replace with snapshot HTML.
    el.className = snap.classes;
    el.hidden = !snap.shown;
  }
  function apply(snapshot, fromNetwork = false) {
    if (!snapshot || applying || (fromNetwork && leader)) return;
    applying = true;
    try {
      if (snapshot.history !== undefined && historyEl.innerHTML !== snapshot.history) {
        const shouldFollow = document.documentElement.scrollHeight-window.scrollY-window.innerHeight < 280;
        historyEl.innerHTML = snapshot.history;
        if (shouldFollow) requestAnimationFrame(() => window.scrollTo(0,document.documentElement.scrollHeight));
      }
      setFlagValues(snapshot.flags);
      for (const [name,show] of Object.entries(snapshot.fileUnlocks || {})) {
        document.querySelectorAll('.'+name).forEach(el => {el.hidden = !show;});
      }
      const counter = document.getElementById('workspace-count');
      if (counter && snapshot.fileCounter) counter.textContent = snapshot.fileCounter;
      (snapshot.commandHistory || []).forEach(()=>{});
      commandHistory.length = 0;
      commandHistory.push(...(snapshot.commandHistory || []));
      cursor = commandHistory.length;
      for (const id of overlayIds) patchOverlay(document.getElementById(id), snapshot.overlays?.[id]);
      // Remote followers and reloaded browsers don't run the leader's timers.
      // Give them an immediately readable final screen instead of an empty
      // full-screen black backdrop. Do not interrupt a cinematic in progress.
      if (snapshot.overlays?.['final3310-overlay']?.shown &&
          !window.CICARS_VISUALS?.finalPlaying()) {
        window.CICARS_VISUALS?.showFinalSummary();
      }
      const finalShown = !document.getElementById('final3310-overlay').hidden;
      if (finalShown !== previousOverlayFinal) {
        previousOverlayFinal = finalShown;
        if (finalShown) startFinal3310Music();
        else stopFinal3310Music();
      }
      // Keep viewer's selected workspace and open document windows untouched.
      workspaceTabs.hidden = !identityVerified;
      // TEST 02 choices and access inputs must reflect shared authorization.
      renderCodeState();
      if (assessment02Active) {
        if (assessment02CountdownInterval !== null) clearInterval(assessment02CountdownInterval);
        assessment02CountdownInterval = null;
        updateAssessment02Countdown();
      }
      input.disabled = Boolean(snapshot.inputDisabled);
      lastAppliedRev = snapshot.revision || 0;
    } finally { applying = false; }
  }
  function recoverAuthority() {
    if (!savedData) return;
    apply(savedData);
    // A new leader resumes a live countdown. Timers operate from timestamp.
    if (assessment02Active && !assessment02Done && assessment02ReadyAt > Date.now()) {
      if (assessment02CountdownInterval !== null) clearInterval(assessment02CountdownInterval);
      assessment02CountdownInterval = setInterval(updateAssessment02Countdown, 200);
    }
    // After failover, resume unfinished stages from their last durable point.
    if (assessment02Queued && !assessment02Active && !assessment02Done) {
      assessment02Queued=false; scheduleAssessment02Notice();
    }
    if (identityQuestionActive || final3310AwaitWord) input.disabled = false;
    if (final3310Running) { final3310Running=false; deliverFinal3310Decree(); }
    if (cipher04Pending) {
      cipher04Pending=false;
      hackSuccessOverlay.hidden=true;
      finishCipherFragmentUnlock();
    }
    if (identificationActive) {
      identificationActive=false;
      identificationOverlay.hidden=true;
      completeIdentificationSequence();
    }
  }
  function saveLocal(snap) {
    try { localStorage.setItem(savedKey, JSON.stringify(snap)); }
    catch (_) { /* quota exceeded: Firebase remains the source of truth */ }
  }
  function setStatusOnline() {
    if (!linkActive) status('RECONNECTING');
    else status(leader?'CONNECTED · PRIMARY':'CONNECTED · SYNCHRONIZED');
  }
  function leaderSet(next) {
    if (next === leader) return;
    leader = next;
    setStatusOnline();
    if (leader) {
      recoverAuthority();
      for (const path of ['requests','adminRequests']) {
        ref(path).once('value', snap => snap.forEach(child => {onRemoteRequest(child,path==='adminRequests');}));
      }
    }
    else if (savedData) apply(savedData);
  }
  async function attemptLeader() {
    if (!db || !linkActive || !user) return;
    try {
      const leaderRef = ref('control/leader');
      const result = await leaderRef.transaction(current => {
        if (!current || (current.uid === user.uid && current.client === clientId) || (current.expiresAt || 0) < now())
          return {uid:user.uid,client:clientId,expiresAt:now()+15000};
        return;
      }, undefined, false);
      const winner = result.snapshot.val();
      leaderSet(Boolean(winner && winner.client===clientId && winner.uid===user.uid));
    } catch (e) { err('LEADER',e); leaderSet(false); }
  }
  function schedulePublish() {
    if (!initReady || applying || !isAuthority()) return;
    const snap = collect();
    snap.revision=0;
    const encoded = JSON.stringify(snap);
    if (encoded === lastSignature) return;
    lastSignature = encoded;
    snap.revision=Date.now();
    saveLocal(snap);
    if (onlineMode() && linkActive && leader) {
      pendingState=snap;
      async function writeNext() {
        if (stateWriteBusy || !pendingState || !leader) return;
        stateWriteBusy=true;
        const next=pendingState;pendingState=null;
        try {await ref('state').set(next);} catch(e){err('STATE WRITE',e);}
        finally{stateWriteBusy=false;if(pendingState)writeNext();}
      }
      writeNext();
    }
  }
  function renderDraft(key, value) {
    applyingDraft=true;
    try {
      const nodes = key === 'command' ? [input] : [...document.querySelectorAll('.access-input')];
      for (const node of nodes) {
        if (node.disabled || node.value === value) continue;
        const a=node.selectionStart,b=node.selectionEnd;
        node.value=value;
        if(document.activeElement===node && Number.isInteger(a)) {
          const caret=Math.min(value.length,a);
          try {node.setSelectionRange(caret,Math.min(value.length,b));}catch(_){ }
        }
      }
    } finally {applyingDraft=false;}
  }
  function setDraft(key,value) {
    if (!onlineMode() || !linkActive) return;
    ref('drafts/'+key).set({value:String(value).slice(0,6000),by:user?.uid || clientId,at:firebase.database.ServerValue.TIMESTAMP})
      .catch(e=>err('DRAFT',e));
  }
  function clearDraft(key) { setDraft(key,''); }
  function debounceDraft(key,value) {
    if (!onlineMode()) return;
    clearTimeout(draftDebounces.get(key));
    draftDebounces.set(key,setTimeout(()=>setDraft(key,value),85));
  }
  function captureInputs(e) {
    const target=e.target;
    if (applyingDraft) return;
    if (target===input) debounceDraft('command',input.value);
    else if (target.matches?.('.access-input')) debounceDraft('access',target.value);
    lastUserAction=Date.now();
  }
  function submit(type,value) {
    lastUserAction=Date.now();
    if (!onlineMode()) return Promise.resolve(false);
    if (!linkActive || !user) {status('WAITING FOR CONNECTION');return Promise.resolve(false);}
    const request = {type,value:String(value || '').slice(0,6000),uid:user.uid,client:clientId,at:firebase.database.ServerValue.TIMESTAMP};
    return ref('requests').push(request).then(()=>true).catch(e=>{err('REQUEST',e);return false;});
  }
  function submitAdmin(type,value) {
    if (!onlineMode()) {if(type==='jump')adminJump(value);return;}
    if (!user || cfg.adminUid !== user.uid) {status('ADMIN AUTH REQUIRED');return;}
    ref('adminRequests').push({type,value,uid:user.uid,at:firebase.database.ServerValue.TIMESTAMP})
      .catch(e=>err('ADMIN ACTION',e));
  }
  function broadcastSignal(kind) {
    if (signalGuard || !onlineMode() || !leader) return;
    emitEffect('sound:'+kind);
  }
  function broadcastVisual(kind) {
    if (visualGuard || !onlineMode() || !leader) return;
    // Avoid two notifications for same visual flash. Signal is sent separately.
    emitEffect('visual:'+kind);
  }
  function emitEffect(kind) {
    if (!onlineMode() || !leader || !linkActive) return;
    ref('effects').push().set({id:`${clientId}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,kind,at:firebase.database.ServerValue.TIMESTAMP})
      .catch(e=>err('EFFECT',e));
  }
  function flashOverlay(kind) {
    document.body.classList.remove('identity-failure','identity-success');
    if (kind==='success'||kind==='failure') {
      void document.body.offsetWidth;
      document.body.classList.add('identity-'+kind);
      setTimeout(()=>document.body.classList.remove('identity-'+kind),1050);
    }
  }
  function receiveEffect(fx) {
    if(!fx || fx.id===lastSeenFx) return;
    lastSeenFx=fx.id;
    // Old historical effects do not re-trigger upon joining a session.
    if (fx.at && now()-fx.at>7000) return;
    if (leader) return;
    if (fx.kind.startsWith('sound:')) {
      signalGuard=true;
      try{playTerminalSignal(fx.kind.slice(6));}finally{signalGuard=false;}
    } else if (fx.kind.startsWith('visual:')) flashOverlay(fx.kind.slice(7));
    else if (fx.kind==='watch'||fx.kind==='glitch') playSharedSystemEffect(fx.kind);
    else if (fx.kind==='hack'||fx.kind==='identification'||fx.kind==='final') {
      signalGuard=true;
      try { playTerminalSignal('notification'); }finally {signalGuard=false;}
      // Shared fullscreen visual events: each client animates its own DOM.
      // Triggering only the audio produced empty overlays on remote browsers.
      window.CICARS_VISUALS?.receive(fx.kind);
    }
  }
  const overlay=document.createElement('section');
  overlay.className='sync-system-overlay';overlay.hidden=true;
  overlay.innerHTML='<div class="sync-system-frame"><div class="sync-system-header">CICARS_3310 // LIVE MONITORING</div><div class="sync-system-message"></div><div class="sync-system-footer">PROCESS: WATCHDOG / SESSION CONTROL</div></div>';
  document.body.append(overlay);
  let systemTimer=null;
  function playSharedSystemEffect(kind) {
    clearTimeout(systemTimer);
    overlay.hidden=false;
    overlay.classList.toggle('is-glitch',kind==='glitch');
    overlay.querySelector('.sync-system-message').textContent=kind==='watch'?'I AM STILL WATCHING.':'UNAUTHORIZED MEMORY ACCESS';
    signalGuard=true;
    try {playTerminalSignal(kind==='watch'?'notification':'failure');}
    finally{signalGuard=false;}
    systemTimer=setTimeout(()=>{overlay.hidden=true;},kind==='watch'?4600:1100);
  }
  function triggerSystemEffect(kind, manual = false) {
    if (!isAuthority()) return;
    if (!['watch','glitch'].includes(kind)) return;
    emitEffect(kind);
    playSharedSystemEffect(kind);
    if (kind==='watch') lastWatch=Date.now();
    if (!manual) nextGlitch=Date.now()+100000+Math.floor(Math.random()*140000);
  }
  function checkSpontaneousEffects() {
    if (!isAuthority()) return;
    if (document.hidden && onlineMode()) return;
    const age=Date.now()-lastUserAction;
    if(age>180000 && Date.now()-lastWatch>200000) triggerSystemEffect('watch');
    if (Date.now()>nextGlitch) triggerSystemEffect('glitch');
  }
  function listenDraft(key) {
    ref('drafts/'+key).on('value', snap => {
      const item=snap.val();
      if(item && typeof item.value==='string') {
        renderDraft(key,item.value);
        if (leader && item.by !== user?.uid) lastUserAction=Date.now();
      }
    });
  }
  function commandFromOtherBrowser(req) {
    const raw = req.value || '';
    lastUserAction=Date.now();
    if(req.type==='command') execute(raw);
    else if(req.type==='trust') {
      const access = document.querySelector('.access-input');
      if(access && !codeAuthorized) {
        access.value=raw;
        access.closest('form')?.requestSubmit();
      }
    } else if(req.type==='audio-open') scheduleIdentityNotice();
    else if(req.type==='trace-open') scheduleAssessment03();
    else if(req.type==='test02') checkAssessment02Answer(raw);
  }
  async function onRemoteRequest(snap, admin = false) {
    if (!leader) return;
    const value=snap.val();
    if(!value) return;
    try {
      if (admin) {
        if (value.uid !== cfg.adminUid) return;
        if(value.type==='jump') {
          const old=adminAuthenticated;
          adminAuthenticated=true;
          try {adminJump(value.value);} finally{adminAuthenticated=old;}
        }
      } else commandFromOtherBrowser(value);
    } catch(e) {console.error('REMOTE COMMAND',e);}
    finally {snap.ref.remove().catch(e=>err('REQUEST DELETE',e));}
  }
  async function loginAdmin(password) {
    if (!onlineMode()) return password === cfg.demoAdminPassword;
    if (!cfg.adminEmail || !cfg.adminUid) return false;
    try {
      const credential=await auth.signInWithEmailAndPassword(cfg.adminEmail, password);
      user=credential.user;
      if (credential.user.uid!==cfg.adminUid) { await auth.signOut(); return false; }
      await attemptLeader();
      return true;
    }catch(e){console.warn('ADMIN LOGIN FAILED',e.code);return false;}
  }
  function setupOffline() {
    online=false; linkActive=false; leader=true;
    status('DEMO · LOCAL ONLY');
    try {
      const snap=JSON.parse(localStorage.getItem(savedKey)||'null');
      if(snap) {savedData=snap;apply(snap);}
    } catch(e) {console.warn('LOCAL SAVE INVALID',e);}
  }
  async function setupFirebase() {
    const missing=['apiKey','authDomain','databaseURL','projectId','appId'].filter(k => !cfg[k]||/^PASTE|YOUR_/.test(cfg[k]));
    if (missing.length || typeof firebase === 'undefined') {
      status('FIREBASE NOT CONFIGURED');
      setupOffline();
      return;
    }
    try {
      firebase.initializeApp(cfg);
      auth=firebase.auth();
      db=firebase.database();
      db.goOnline();
      base=db.ref('sessions/'+sessionId);
      online=true;
      status('CONNECTING...');
      db.ref('.info/serverTimeOffset').on('value',s=>{dbOffset=Number(s.val())||0;});
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      user=auth.currentUser || (await auth.signInAnonymously()).user;
      auth.onAuthStateChanged(u=>{if(u){user=u;attemptLeader();}});
      db.ref('.info/connected').on('value',s=>{linkActive=Boolean(s.val());setStatusOnline();if(linkActive)attemptLeader();else leaderSet(false);});
      ref('state').on('value',s=>{savedData=s.val();if(savedData && !leader)apply(savedData,true);});
      ref('effects').limitToLast(100).on('child_added',s=>receiveEffect(s.val()));
      listenDraft('command'); listenDraft('access');
      ref('requests').on('child_added',s=>onRemoteRequest(s,false));
      ref('adminRequests').on('child_added',s=>onRemoteRequest(s,true));
      ref('control/leader').on('value',s=>{const record=s.val();if(record&&record.client!==clientId)leaderSet(false);});
      timers.push(setInterval(attemptLeader,5000));
    } catch(e) {
      err('INITIALIZE',e);
      online=false;linkActive=false;leader=true;
      status('DEMO · FIREBASE ERROR');
      setupOffline();
    }
  }
  function start() {
    initReady=true;
    document.addEventListener('input',captureInputs,true);
    // Only snapshot global progress and console, never personal modal/window state.
    timers.push(setInterval(schedulePublish,650));
    timers.push(setInterval(checkSpontaneousEffects,5000));
    if(cfg.enabled) setupFirebase(); else setupOffline();
  }
  window.CICARS_SYNC={
    online: onlineMode, isRemoteControlled, isAuthority,
    submit, submitAdmin, loginAdmin,
    broadcastSignal, broadcastVisual, triggerSystemEffect,
    clearDraft, getRole:()=>leader?'leader':'follower',
    getSession:()=>sessionId,
    refresh:()=>{lastSignature='';schedulePublish();},
  };
  start();
})();
