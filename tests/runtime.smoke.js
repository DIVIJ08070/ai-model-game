/* Headless runtime smoke test for Body Dash.
   Shims the DOM, a fake webcam (getUserMedia) and a stub MediaPipe `Pose`, then
   drives: boot -> ENABLE CAMERA & PLAY -> feed body poses (lane + jump) -> force a
   crash -> game over. Any thrown error or console.error fails the run.
   Run: node tests/runtime.smoke.js */
const fs=require('fs'), vm=require('vm'), path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
// take the LAST <script> (the game); the first is the CDN <script src> (no body)
const bodies=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
const script0=bodies[bodies.length-1];
if(!script0){ console.error('no inline script found'); process.exit(1); }
// top-level `const` bindings aren't visible on the vm global, so append an
// exposer (from inside the script's own scope) for the state we want to inspect.
const script=script0+"\n;try{globalThis.__api={G:G,FOCAL:FOCAL};}catch(e){}";

let errors=[];
const rafq=[];
let clock=0;

function ctxStub(){
  const noop=()=>{}; const grad={addColorStop:noop};
  return new Proxy({ canvas:{width:800,height:600}, createLinearGradient:()=>grad, createRadialGradient:()=>grad,
    setTransform:noop, getImageData:()=>({data:new Uint8ClampedArray(4)}) },
    { get(t,k){ return k in t?t[k]:noop; }, set(){return true;} });
}
function el(id){
  const h={};
  const e={ id, dataset:{}, style:{}, textContent:'', value:'', disabled:false, srcObject:null, readyState:4,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
      toggle(c,on){ if(on===undefined)on=!this._s.has(c); on?this._s.add(c):this._s.delete(c); return on;}, contains(c){return this._s.has(c);} },
    setAttribute(k,v){ this['_'+k]=String(v); }, getAttribute(k){ return this['_'+k]; },
    addEventListener(ev,fn){ (h[ev]=h[ev]||[]).push(fn); }, removeEventListener(){},
    getContext(){ return ctxStub(); }, play(){ return Promise.resolve(); },
    getBoundingClientRect(){ return {width:360,height:270,left:0,top:0,right:360,bottom:270}; },
    _fire(ev,o){ (h[ev]||[]).forEach(fn=>fn(Object.assign({preventDefault(){},target:e},o))); }, _has(ev){return !!(h[ev]&&h[ev].length);} };
  return e;
}
const cache={};
const byId=id=>cache[id]||(cache[id]=el(id));
const diffBtns=['chill','normal','intense'].map(d=>{ const b=el('d-'+d); b.dataset.diff=d; return b; });

// capture the pose + hands callbacks the game registers
const POSE={cb:null}, HANDS={cb:null};
class PoseStub{ constructor(){} setOptions(){} onResults(cb){ this.cb=cb; POSE.cb=cb; }
  async send(){ if(this.cb) this.cb(makeResult(CURRENT_LM)); } close(){} }
class HandsStub{ constructor(){} setOptions(){} onResults(cb){ this.cb=cb; HANDS.cb=cb; }
  async send(){ if(this.cb) this.cb({multiHandLandmarks:CURRENT_HAND?[CURRENT_HAND]:[]}); } close(){} }
let CURRENT_HAND=null;
function victoryHand(){ const h=Array.from({length:21},()=>({x:0.5,y:0.5}));
  const s=(i,x,y)=>h[i]={x,y};
  s(0,0.5,0.9);s(9,0.5,0.58);s(5,0.44,0.6);s(6,0.42,0.5);s(8,0.40,0.35);
  s(10,0.5,0.48);s(12,0.5,0.33);s(14,0.55,0.6);s(16,0.55,0.64);s(18,0.6,0.62);s(20,0.6,0.66);
  return h; }

// build a plausible 33-point landmark set; x,y in [0,1]
function makeResult(lm){ return {poseLandmarks:lm}; }
function bodyLandmarks(centerX, hipY){
  const lm=Array.from({length:33},()=>({x:centerX,y:0.5,visibility:1}));
  const set=(i,x,y)=>{ lm[i]={x,y,visibility:1}; };
  const shoY=hipY-0.22; // torso ~0.22
  set(0,centerX,shoY-0.12);           // nose
  set(11,centerX-0.06,shoY); set(12,centerX+0.06,shoY);   // shoulders
  set(23,centerX-0.05,hipY); set(24,centerX+0.05,hipY);   // hips
  set(25,centerX-0.05,hipY+0.15); set(26,centerX+0.05,hipY+0.15); // knees
  set(27,centerX-0.05,hipY+0.30); set(28,centerX+0.05,hipY+0.30); // ankles
  return lm;
}
function tposeLandmarks(){ const lm=bodyLandmarks(0.5,0.55);
  lm[11]={x:0.42,y:0.4,visibility:1}; lm[12]={x:0.58,y:0.4,visibility:1};   // shoulders
  lm[15]={x:0.15,y:0.4,visibility:1}; lm[16]={x:0.85,y:0.4,visibility:1};   // wrists out wide, level
  return lm; }
let CURRENT_LM=bodyLandmarks(0.5,0.55);

const document={ getElementById:byId, createElement:()=>el('new'),
  querySelectorAll:sel=> sel.includes('#diffRow')?diffBtns:[], addEventListener(){}, };
const store={};
const localStorage={ getItem:k=>k in store?store[k]:null, setItem:(k,v)=>{store[k]=String(v);} };
function Osc(){ return {type:'',frequency:{setValueAtTime(){}},connect(){return this;},start(){},stop(){}}; }
function Gain(){ return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){return this;}}; }
function AudioCtx(){ this.currentTime=0; this.state='running'; this.destination={}; this.resume=()=>{}; this.createOscillator=()=>new Osc(); this.createGain=()=>new Gain(); }
const win={ innerWidth:1280, innerHeight:720, devicePixelRatio:2,
  matchMedia:()=>({matches:false}), AudioContext:AudioCtx, webkitAudioContext:AudioCtx,
  addEventListener(){}, requestAnimationFrame:fn=>{ rafq.push(fn); return rafq.length; } };

const sandbox={ window:win, document, localStorage, Pose:PoseStub, Hands:HandsStub,
  navigator:{ vibrate:()=>true, mediaDevices:{ getUserMedia:async()=>({ getTracks:()=>[{stop(){}}] }) } },
  performance:{ now:()=>clock },
  requestAnimationFrame:win.requestAnimationFrame,
  setTimeout:(fn)=>{ try{fn();}catch(e){errors.push('setTimeout: '+e.stack);} return 0; }, clearTimeout(){},
  console:{ log(){}, warn(){}, error:(...a)=>errors.push('console.error: '+a.join(' ')) },
  Math,Date,JSON,Array,Object,Uint8ClampedArray,parseInt,parseFloat,isNaN,String,Number,Promise,Symbol };
sandbox.globalThis=sandbox;

try{ vm.createContext(sandbox); vm.runInContext(script,sandbox,{filename:'index.html'}); }
catch(e){ console.error('boot threw:',e.stack); process.exit(1); }

function frames(n,stepMs){ stepMs=stepMs||16; for(let i=0;i<n;i++){ clock+=stepMs; try{ sandbox.frame(clock); }catch(e){ errors.push('frame: '+e.stack); } } }
function feed(lm){ CURRENT_LM=lm; try{ POSE.cb && POSE.cb(makeResult(lm)); }catch(e){ errors.push('pose: '+e.stack); } }
function feedHand(h){ CURRENT_HAND=h; try{ HANDS.cb && HANDS.cb({multiHandLandmarks:h?[h]:[]}); }catch(e){ errors.push('hands: '+e.stack); } }

(async()=>{
  frames(3);                               // boot frames on start screen
  byId('playBtn')._fire('click');          // ENABLE CAMERA (async: camera + models)
  await new Promise(r=>setTimeout(r,0)); await Promise.resolve(); await Promise.resolve();
  await new Promise(r=>setTimeout(r,0)); await Promise.resolve();
  frames(2);
  const GS=sandbox.__api&&sandbox.__api.G;
  if(!GS){ console.log('RUNTIME ERRORS:\n could not reach game state (__api missing)'); process.exit(1); }
  if(GS.screen!=='ready'){ errors.push('did not enter the ready lobby after camera init (screen='+GS.screen+')'); }

  // ✌️ start gesture: show a peace sign, hold it -> auto-starts the game
  feedHand(victoryHand());
  if(!GS.gesture.victory) errors.push('peace sign not recognised in lobby');
  frames(45);   // ~0.7s of holding -> should cross GESTURE_HOLD and start
  if(GS.screen!=='play') errors.push('holding ✌️ did not start the game (screen='+GS.screen+')');

  // pose position is smoothed, so hold each stance for several frames (realistic)
  function hold(lm,n){ for(let i=0;i<(n||10);i++){ feed(lm); frames(2); } }
  // user steps to THEIR right -> appears on image-left (small rawX) -> lane 2
  hold(bodyLandmarks(0.12,0.55));
  if(GS.lane!==2) errors.push('stepping right did not move to lane 2 (lane='+GS.lane+')');
  // step back to centre
  hold(bodyLandmarks(0.5,0.55));
  if(GS.lane!==1) errors.push('returning to centre did not reach lane 1 (lane='+GS.lane+')');
  // user steps to THEIR left -> appears image-right (large rawX) -> lane 0 (the reported bug)
  hold(bodyLandmarks(0.88,0.55));
  if(GS.lane!==0) errors.push('stepping left did not move to lane 0 (lane='+GS.lane+')');
  hold(bodyLandmarks(0.5,0.55), 30);   // re-centre and let the jump baseline settle
  // now jump: hips rise sharply
  feed(bodyLandmarks(0.5,0.40));
  if(!GS.jump.active) errors.push('rising body did not trigger a jump');
  frames(20);
  // now duck: hips drop sharply below the settled baseline
  GS.jump.active=false; GS.jumpCooldown=0;
  hold(bodyLandmarks(0.5,0.55), 25);   // settle baseline again
  feed(bodyLandmarks(0.5,0.72));
  if(!GS.duck.active) errors.push('dropping body did not trigger a duck/slide');
  frames(6);

  // running in place should raise boost over time
  for(let i=0;i<14;i++){ feed(bodyLandmarks(0.5, i%2? 0.55:0.59)); frames(2); }

  // overhead bar: DUCKING slides under it safely
  GS.jump.active=false; GS.spawnTimer=999; GS.obstacles.length=0;
  GS.duck.active=true; GS.duck.t=0.3;
  GS.obstacles.push({lane:GS.lane, z:0.7, type:'overhead', passed:false, coin:false});
  frames(6);
  if(GS.screen!=='play') errors.push('ducking did not clear the overhead bar (screen='+GS.screen+')');

  // force a crash: a tall block (can't jump/duck) in the player's lane
  GS.jump.active=false; GS.duck.active=false; GS.obstacles.length=0;
  GS.obstacles.push({lane:GS.lane, z:0.7, type:'block', passed:false, coin:false});
  frames(30);
  await new Promise(r=>setTimeout(r,0));
  if(GS.screen!=='over') errors.push('block in lane did not cause game over (screen='+GS.screen+')');

  // 🧍 T-pose restarts from the game-over screen
  feed(tposeLandmarks()); frames(45);
  if(GS.screen!=='play') errors.push('T-pose did not restart from game over (screen='+GS.screen+')');

  if(errors.length){ console.log('RUNTIME ERRORS:\n'+errors.join('\n')); process.exit(1); }
  console.log('runtime smoke: boot + camera-init + lane + jump + boost + crash all ran with no errors');
  console.log('  final: screen='+GS.screen+'  score='+Math.floor(GS.score)+'  best persisted='+store['bodydash_best']);
  process.exit(0);
})();
