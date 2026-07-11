/* Headless runtime smoke test for Spell Caster (mirrors tests/pose-wall.smoke.js).
   Extracts the Engine <script> (the body containing /*__SPELL_ENGINE__* / — NOT the ESM View
   module and NOT the importmap JSON), runs it in vm with DOM/canvas/getUserMedia shims and stubs
   for BOTH MediaPipe detectors (Pose AND Hands), then drives the PRD §6 script:
     boot(ready) -> Camera -> T-pose start -> calibration -> lean-dodge (Pose) -> draw a line
     glyph (Hands) that casts Bolt -> force a lose to HP0 game-over -> T-pose restart ->
     keyboard fallback (arrows strafe, '1' Bolt, Enter restart) -> a full WIN path (clear 5 waves).
   Any thrown error or console.error fails the run.
   Run: node tests/spell-caster.smoke.js */
const fs=require('fs'), vm=require('vm'), path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','spell-caster.html'),'utf8');

// select the Engine script by its sentinel (robust against the importmap + View module blocks)
const bodies=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const script=bodies.find(s=>s.includes('/*__SPELL_ENGINE__*/'));
if(!script){ console.error('could not find the /*__SPELL_ENGINE__*/ engine script'); process.exit(1); }

let errors=[];
const err=m=>errors.push(m);
const rafq=[]; let clock=0;

function ctxStub(){
  const noop=()=>{}; const grad={addColorStop:noop};
  return new Proxy({ canvas:{width:1280,height:720}, createLinearGradient:()=>grad, createRadialGradient:()=>grad,
    setTransform:noop, getImageData:()=>({data:new Uint8ClampedArray(4)}) },
    { get(t,k){ return k in t?t[k]:noop; }, set(){return true;} });
}
function el(id){
  const h={};
  const e={ id, dataset:{}, style:{}, textContent:'', innerHTML:'', value:'', disabled:false, srcObject:null, readyState:4,
    width:1280, height:720, offsetWidth:1,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
      toggle(c,on){ if(on===undefined)on=!this._s.has(c); on?this._s.add(c):this._s.delete(c); return on;}, contains(c){return this._s.has(c);} },
    setAttribute(k,v){ this['_'+k]=String(v); }, getAttribute(k){ return this['_'+k]; },
    addEventListener(ev,fn){ (h[ev]=h[ev]||[]).push(fn); }, removeEventListener(){},
    appendChild(){}, getContext(){ return ctxStub(); }, play(){ return Promise.resolve(); },
    getBoundingClientRect(){ return {width:1280,height:720,left:0,top:0,right:1280,bottom:720}; },
    _fire(ev,o){ (h[ev]||[]).forEach(fn=>fn(Object.assign({preventDefault(){},target:e},o))); }, _has(ev){return !!(h[ev]&&h[ev].length);} };
  return e;
}
const cache={};
const byId=id=>cache[id]||(cache[id]=el(id));

/* ---- capture BOTH detector callbacks the engine registers ---- */
const POSE={cb:null}, HANDS={cb:null};
let CURRENT_LM=null, CURRENT_HAND=null;
class PoseStub{ setOptions(){} onResults(cb){ this.cb=cb; POSE.cb=cb; } async send(){ this.cb&&this.cb({poseLandmarks:CURRENT_LM}); } close(){} }
class HandsStub{ setOptions(){} onResults(cb){ this.cb=cb; HANDS.cb=cb; } async send(){ this.cb&&this.cb({multiHandLandmarks:CURRENT_HAND?[CURRENT_HAND]:[]}); } close(){} }

/* ---- landmark fixtures ---- */
function mkBody(spec){ const lm=Array.from({length:33},()=>({x:0.5,y:0.5,visibility:1})); for(const k in spec) lm[k]={x:spec[k][0],y:spec[k][1],visibility:1}; return lm; }
function mkHand(spec){ const h=Array.from({length:21},()=>({x:0.5,y:0.5})); for(const k in spec) h[k]={x:spec[k][0],y:spec[k][1]}; return h; }
// arms-down "down" wrists so these are NOT read as a T-pose
const DOWN={15:[0.40,0.60],16:[0.60,0.60]};
function withDown(spec){ return Object.assign({}, DOWN, spec); }
function neutralPose(){ return mkBody(withDown({11:[0.44,0.40],12:[0.56,0.40],23:[0.45,0.62],24:[0.55,0.62]})); }
function leanRightPose(){ return mkBody(withDown({11:[0.38,0.40],12:[0.50,0.40],23:[0.45,0.62],24:[0.55,0.62]})); } // shoulders image-left = lean player-RIGHT (+lean → slot +1)
function leanLeftPose(){ return mkBody(withDown({11:[0.50,0.40],12:[0.62,0.40],23:[0.45,0.62],24:[0.55,0.62]})); }
function duckPose(){ return mkBody(withDown({11:[0.44,0.56],12:[0.56,0.56],23:[0.45,0.72],24:[0.55,0.72]})); }  // shoulders dropped ~0.16 below standing (0.40)
function tposePose(){ return mkBody({11:[0.42,0.40],12:[0.58,0.40],15:[0.12,0.40],16:[0.88,0.40],23:[0.45,0.62],24:[0.55,0.62]}); }
// index-extended hand whose tip traces a diagonal line (t: 0→1)
function handLine(t){ const tx=0.35+0.30*t, ty=0.65-0.30*t; return mkHand({0:[0.5,0.9],5:[0.5,0.6],9:[0.5,0.55],4:[0.4,0.7],6:[tx,ty+0.25],8:[tx,ty]}); }
function handIdle(){ return mkHand({0:[0.5,0.9],5:[0.5,0.6],9:[0.5,0.55],4:[0.4,0.7],6:[0.5,0.40],8:[0.5,0.50]}); } // index NOT extended → falling edge
CURRENT_LM=neutralPose();

const document={ getElementById:byId, createElement:()=>el('new'), head:el('head'),
  querySelectorAll:()=>[], addEventListener(){}, activeElement:null };
const store={};
const localStorage={ getItem:k=>k in store?store[k]:null, setItem:(k,v)=>{store[k]=String(v);} };
function Osc(){ return {type:'',frequency:{setValueAtTime(){}},connect(){return this;},start(){},stop(){}}; }
function Gain(){ return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){return this;}}; }
function AudioCtx(){ this.currentTime=0; this.state='running'; this.destination={}; this.resume=()=>{}; this.createOscillator=()=>new Osc(); this.createGain=()=>new Gain(); }
const win={ innerWidth:1280, innerHeight:720, devicePixelRatio:2,
  matchMedia:()=>({matches:false}), AudioContext:AudioCtx, webkitAudioContext:AudioCtx,
  requestAnimationFrame:fn=>{ rafq.push(fn); return rafq.length; }, Pose:PoseStub, Hands:HandsStub,
  _h:{}, addEventListener(ev,fn){ (this._h[ev]=this._h[ev]||[]).push(fn); }, removeEventListener(){},
  _fire(ev,o){ (this._h[ev]||[]).forEach(fn=>fn(Object.assign({preventDefault(){}},o))); } };
const fireKey=(k,type)=>win._fire(type||'keydown',{key:k});

const sandbox={ window:win, document, localStorage, Pose:PoseStub, Hands:HandsStub,
  navigator:{ mediaDevices:{ getUserMedia:async()=>({ getTracks:()=>[{stop(){}}] }) } },
  performance:{ now:()=>clock },
  requestAnimationFrame:win.requestAnimationFrame,
  setTimeout:(fn)=>{ try{fn();}catch(e){errors.push('setTimeout: '+e.stack);} return 0; }, clearTimeout(){},
  console:{ log(){}, warn(){}, error:(...a)=>errors.push('console.error: '+a.join(' ')) },
  Math,Date,JSON,Array,Object,Uint8ClampedArray,parseInt,parseFloat,isNaN,String,Number,Boolean,Promise,Symbol,Infinity };
sandbox.globalThis=sandbox;

try{ vm.createContext(sandbox); vm.runInContext(script,sandbox,{filename:'spell-caster.html'}); }
catch(e){ console.error('boot threw:',e.stack); process.exit(1); }

const S=sandbox.__spell;
function upd(ms){ clock+=(ms||16); try{ S.update(clock); }catch(e){ errors.push('update: '+(e&&e.stack||e)); } }
function feedPose(lm){ CURRENT_LM=lm; try{ POSE.cb && POSE.cb({poseLandmarks:lm}); }catch(e){ errors.push('pose: '+(e&&e.stack||e)); } }
function feedHand(hd){ CURRENT_HAND=hd; try{ HANDS.cb && HANDS.cb({multiHandLandmarks:hd?[hd]:[]}); }catch(e){ errors.push('hand: '+(e&&e.stack||e)); } }

(async()=>{
  if(!S || !S.G){ console.log('RUNTIME ERRORS:\n could not reach engine state (__spell missing)'); process.exit(1); }
  const G=S.G;

  // sanity — detectorFor parity (the dual-pump routing contract, §3.2)
  if(!(S.detectorFor('ready')==='pose' && S.detectorFor('play',0)==='pose' && S.detectorFor('play',1)==='hands'))
    err('detectorFor routing wrong (ready/play parity)');

  // 1) boot a few frames on the lobby
  upd(16); upd(16); upd(16);
  if(G.screen!=='ready') err('did not boot into the lobby (screen='+G.screen+')');
  if(G.control!=='keyboard') err('default control scheme should be keyboard (got '+G.control+')');

  // 2) enter CAMERA mode (async: getUserMedia + BOTH-model warm-up)
  byId('playCamBtn')._fire('click');
  for(let i=0;i<30;i++){ await Promise.resolve(); await new Promise(r=>setTimeout(r,0)); }
  if(!G.cam.on) err('camera did not come online after clicking Camera');
  if(G.control!=='camera') err('Camera button did not switch to camera control');
  if(G.screen!=='ready') err('camera init should stay on the lobby (screen='+G.screen+')');
  if(!G.cam.poseSeen) err('Pose warm-up did not run (poseSeen false)');
  if(!G.cam.handsSeen) err('Hands warm-up did not run (handsSeen false)');

  // 3) T-pose start → passes through calib → play (calibration captured)
  feedPose(tposePose());
  if(!G.cam.tpose) err('T-pose not recognised in the lobby');
  let guard=0;
  while(G.screen!=='play' && guard++<600){ feedPose(G.screen==='calib'?neutralPose():tposePose()); upd(16); }
  if(G.screen!=='play') err('holding a T-pose did not start the game (screen='+G.screen+')');
  if(!G.running) err('game did not enter the running state');
  if(!G.calibration.done) err('calibration was not captured on start');
  if(G.hp!==100) err('hp did not initialise to 100 (hp='+G.hp+')');
  if(G.wave!==1) err('wave did not initialise to 1 (wave='+G.wave+')');
  if(G.score!==0) err('score did not initialise to 0 (score='+G.score+')');

  // 4) LEAN-DODGE (Pose): lean-right → slot +1, lean-left → slot -1, crouch → duck
  for(let i=0;i<6;i++){ feedPose(leanRightPose()); upd(16); }
  if(G.mage.slot!==1) err('lean-right did not strafe to slot +1 (slot='+G.mage.slot+', lean='+G.dodge.lean.toFixed(2)+')');
  for(let i=0;i<8;i++){ feedPose(leanLeftPose()); upd(16); }
  if(G.mage.slot!==-1) err('lean-left did not strafe to slot -1 (slot='+G.mage.slot+', lean='+G.dodge.lean.toFixed(2)+')');
  for(let i=0;i<5;i++){ feedPose(neutralPose()); upd(16); }   // settle back to centre
  G.mage.duckCooldown=0;
  feedPose(duckPose());
  if(!G.mage.ducking) err('a crouch did not trigger a duck (ducking='+G.mage.ducking+')');

  // 5) DRAW-GLYPH (Hands): trace a straight line, drop the finger → casts Bolt (no upd, so the pump can't interfere)
  for(let i=0;i<12;i++){ feedHand(handLine(i/11)); }
  feedHand(handIdle());   // falling edge → recognizeGlyph → castSpell
  if(G.stroke.lastGlyph!=='bolt') err("drawing a line did not cast Bolt (lastGlyph="+G.stroke.lastGlyph+')');
  if(!(G.spells.length>0)) err('casting Bolt did not spawn a player spell projectile');

  // 6) FORCE A LOSE — resolve slot-0 enemy projectiles onto the mage until HP hits 0
  G.mage.slot=0; G.dodge.lean=0; G.mage.ducking=false;
  guard=0;
  while(G.hp>0 && G.screen==='play' && guard++<20){
    G.mage.slot=0;
    G.eProj.push({ x:0, z:0.001, slot:0, high:false, dmg:20, dead:false });
    feedPose(neutralPose());
    upd(16);
  }
  if(G.screen!=='over') err('HP reaching 0 did not end the run (screen='+G.screen+')');
  if(G.outcome!=='over') err('HP-0 outcome was not "over" (outcome='+G.outcome+')');
  if(!(G.hp<=0)) err('hp was not 0 at game over (hp='+G.hp+')');
  if(byId('overTitleA').textContent!=='GAME') err('defeat over-screen title not set (A='+byId('overTitleA').textContent+')');
  if(store['spellcaster_best']===undefined) err('best score was not persisted to localStorage');

  // 7) T-pose RESTART from the over screen → back to play, fresh run
  feedPose(tposePose()); guard=0;
  while(G.screen!=='play' && guard++<300){ feedPose(tposePose()); upd(16); }
  if(G.screen!=='play') err('T-pose did not restart from the over screen (screen='+G.screen+')');
  if(G.hp!==100) err('restart did not reset hp (hp='+G.hp+')');
  if(G.score!==0) err('restart did not reset score (score='+G.score+')');
  if(G.wave!==1) err('restart did not reset wave (wave='+G.wave+')');

  // 8) KEYBOARD fallback — arrows strafe, '1' casts Bolt, force a lose, Enter restarts
  {
    G.control='keyboard'; S.startGame();
    if(G.screen!=='play') err('keyboard startGame did not reach play (screen='+G.screen+')');
    fireKey('ArrowRight'); upd(16);
    if(G.mage.slot!==1) err('keyboard ArrowRight did not strafe to slot +1 (slot='+G.mage.slot+')');
    const spellsBefore=G.spells.length;
    fireKey('1');
    if(G.stroke.lastGlyph!=='bolt') err("keyboard '1' did not cast Bolt (lastGlyph="+G.stroke.lastGlyph+')');
    if(!(G.spells.length>spellsBefore)) err("keyboard '1' did not spawn a spell");
    fireKey('ArrowRight','keyup');            // release → slot returns to 0
    guard=0;
    while(G.hp>0 && G.screen==='play' && guard++<20){
      G.eProj.push({ x:0, z:0.001, slot:0, high:false, dmg:20, dead:false }); upd(16);
    }
    if(G.screen!=='over') err('keyboard play did not reach a game over (screen='+G.screen+')');
    fireKey('Enter');
    if(G.screen!=='play') err('keyboard Enter did not restart from the over screen (screen='+G.screen+')');
    if(G.hp!==100) err('keyboard restart did not reset hp (hp='+G.hp+')');
  }

  // 9) WIN path — clear all 5 waves by casting at each enemy (synchronous; enemies never fire)
  {
    G.control='keyboard'; S.startGame();
    guard=0;
    while(G.screen==='play' && guard++<300){ S.castSpell('fireball'); }
    if(G.outcome!=='win') err('clearing 5 waves did not produce a win (outcome='+G.outcome+', wave='+G.wave+')');
    if(G.screen!=='over') err('the win did not land on the over screen (screen='+G.screen+')');
    if(G.wave!==5) err('win did not fire on wave 5 (wave='+G.wave+')');
    if(byId('overTitleA').textContent!=='MAGE') err('win over-screen title not set (A='+byId('overTitleA').textContent+')');
    if(byId('overWave').textContent!=='5/5') err('win over-screen wave stat not set (='+byId('overWave').textContent+')');
    if(!(G.score>0)) err('win produced no score (score='+G.score+')');
  }

  if(errors.length){ console.log('RUNTIME ERRORS:\n'+errors.join('\n')); process.exit(1); }
  console.log('spell-caster smoke: boot + camera(dual warm-up) + T-pose start + calibration + lean-dodge + duck + draw-line→Bolt + HP0 lose + T-pose restart + keyboard(arrows/1/Enter) + 5-wave WIN all ran with no errors');
  console.log('  final: screen='+G.screen+'  outcome='+G.outcome+'  score='+G.score+'  best persisted='+store['spellcaster_best']);
  process.exit(0);
})();
