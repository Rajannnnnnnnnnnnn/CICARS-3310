/* Optional personal ambient soundtrack. All alarm sounds are from the
   shared game stream; ambience is controlled separately on each device. */
(() => {
  'use strict';
  const toggle = document.getElementById('ambient-toggle');
  const unlock = document.getElementById('audio-unlock');
  const prefKey = 'cicars_ambient_pref_v1';
  let ctx = null, master = null, nodes = [], chordTimer = null;
  let wanted = localStorage.getItem(prefKey) === 'on';
  let turnedOn = false;
  function getAudio() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume().catch(()=>{});
    } catch (e) {console.warn('Ambient audio unavailable',e);}
    return ctx;
  }
  function ensureGameSounds() {
    try {unlockSignalAudio();}catch(_){ }
    getAudio();
    unlock.textContent = '◉ AUDIO ENABLED';
    unlock.classList.add('is-enabled');
  }
  function stopAmbient() {
    if (chordTimer) clearInterval(chordTimer);
    chordTimer = null;
    if (master && ctx) master.gain.setTargetAtTime(0,ctx.currentTime,.12);
    const ending = nodes;nodes=[];
    setTimeout(()=>ending.forEach(node=>{try{node.stop?.();node.disconnect?.();}catch(_){}}),800);
    master=null;turnedOn=false;
  }
  function startAmbient() {
    if (turnedOn) return;
    const ac=getAudio();if(!ac) return;
    stopAmbient();
    const mix=ac.createGain(), filt=ac.createBiquadFilter();
    mix.gain.value=0;
    filt.type='lowpass';filt.frequency.value=430;filt.Q.value=.65;
    mix.connect(filt).connect(ac.destination);
    master=mix; nodes.push(mix,filt);
    // Sparse low synth drone: cinematic ambient, far quieter than alerts.
    const frequencies=[55,82.41,110,164.81];
    frequencies.forEach((f,i)=>{
      const osc=ac.createOscillator(),g=ac.createGain();
      osc.type=i===0?'triangle':'sine'; osc.frequency.value=f;
      g.gain.value=[.54,.16,.085,.028][i];
      osc.connect(g).connect(mix);osc.start();nodes.push(osc,g);
    });
    const lfo=ac.createOscillator(),depth=ac.createGain();
    lfo.type='sine';lfo.frequency.value=.13;depth.gain.value=.003;
    lfo.connect(depth).connect(mix.gain);lfo.start();nodes.push(lfo,depth);
    const tones=[123.47,130.81,146.83,164.81,155.56,130.81,110];
    let count=0;
    function ping() {
      if (!master || ac.state!=='running') return;
      const t=ac.currentTime+.03,osc=ac.createOscillator(),g=ac.createGain();
      osc.type='triangle';osc.frequency.value=tones[(count++)%tones.length];
      g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.005,t+.09);
      g.gain.exponentialRampToValueAtTime(.0001,t+2.5);
      osc.connect(g).connect(ac.destination);osc.start(t);osc.stop(t+2.55);
    }
    chordTimer=setInterval(ping,4200);ping();
    master.gain.setTargetAtTime(.028,ac.currentTime,.85);
    turnedOn=true;
  }
  function updateButton() {
    toggle.textContent=wanted?'♫ AMBIENT ON':'♫ AMBIENT OFF';
    toggle.setAttribute('aria-pressed',String(wanted));
  }
  toggle.addEventListener('click',()=>{
    ensureGameSounds();wanted=!wanted;
    localStorage.setItem(prefKey,wanted?'on':'off');
    if(wanted)startAmbient();else stopAmbient();
    updateButton();
  });
  unlock.addEventListener('click',()=>{
    ensureGameSounds();
    if(wanted&&!turnedOn)startAmbient();
  });
  document.addEventListener('pointerdown',()=>{
    try{unlockSignalAudio();}catch(_){ }
    if(wanted&&!turnedOn)startAmbient();
  },{capture:true});
  document.addEventListener('visibilitychange',()=>{
    // Music is personal; keep the preference but save resources when hidden.
    if(document.hidden && master && ctx) master.gain.setTargetAtTime(.004,ctx.currentTime,.3);
    else if(wanted && master && ctx) master.gain.setTargetAtTime(.028,ctx.currentTime,.3);
  });
  updateButton();
})();
