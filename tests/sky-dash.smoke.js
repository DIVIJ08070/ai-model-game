/* Headless runtime smoke test for Sky Dash (mirrors tests/runtime.smoke.js).
   Extracts the Engine <script> (the body containing /*__SKY_ENGINE__* / — NOT the ESM View
   module and NOT the importmap JSON), runs it in vm with DOM/canvas/getUserMedia/Pose shims,
   then drives: boot(lobby) -> T-pose start -> flap -> bank/pitch -> collect apple -> win ->
   T-pose restart -> crash -> keyboard scheme. Any thrown error or console.error fails the run.
   Run: node tests/sky-dash.smoke.js */
const fs=require('fs'), vm=require('vm'), path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','sky-dash.html'),'utf8');

// select the Engine script by its sentinel (robust against the importmap + View module blocks)
const bodies=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const script=bodies.find(s=>s.includes('/*__SKY_ENGINE__*/'));
if(!script){ console.error('could not find the /*__SKY_ENGINE__*/ engine script'); process.exit(1); }

let errors=[];
const rafq=[]; let clock=0;

function ctxStub(){
  const noop=()=>{}; const grad={addColorStop:noop};
  return new Proxy({ canvas:{width:132,height:99}, createLinearGradient:()=>grad, createRadialGradient:()=>grad,
    setTransform:noop, getImageData:()=>({data:new Uint8ClampedArray(4)}) },
    { get(t,k){ return k in t?t[k]:noop; }, set(){return true;} });
}
function el(id){
  const h={};
  const e={ id, dataset:{}, style:{}, textContent:'', value:'', disabled:false, srcObject:null, readyState:4,
    width:132, height:99, offsetWidth:1,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
      toggle(c,on){ if(on===undefined)on=!this._s.has(c); on?this._s.add(c):this._s.delete(c); return on;}, contains(c){return this._s.has(c);} },
    setAttribute(k,v){ this['_'+k]=String(v); }, getAttribute(k){ return this['_'+k]; },
    addEventListener(ev,fn){ (h[ev]=h[ev]||[]).push(fn); }, removeEventListener(){},
    appendChild(){}, getContext(){ return ctxStub(); }, play(){ return Promise.resolve(); },
    getBoundingClientRect(){ return {width:132,height:99,left:0,top:0,right:132,bottom:99}; },
    _fire(ev,o){ (h[ev]||[]).forEach(fn=>fn(Object.assign({preventDefault(){},target:e},o))); }, _has(ev){return !!(h[ev]&&h[ev].length);} };
  return e;
}
const cache={};
const byId=id=>cache[id]||(cache[id]=el(id));

// capture the pose callback the engine registers
const POSE={cb:null};
class PoseStub{ constructor(){} setOptions(){} onResults(cb){ this.cb=cb; POSE.cb=cb; }
  async send(){ if(this.cb) this.cb({poseLandmarks:CURRENT_LM}); } close(){} }

// build a plausible 33-point landmark set (x,y in [0,1], y-down)
function bodyLandmarks(centerX, hipY){
  const lm=Array.from({length:33},()=>({x:centerX,y:0.5,visibility:1}));
  const set=(i,x,y)=>{ lm[i]={x,y,visibility:1}; };
  const shoY=hipY-0.22;
  set(0,centerX,shoY-0.12);
  set(11,centerX-0.06,shoY); set(12,centerX+0.06,shoY);
  set(13,centerX-0.12,shoY+0.05); set(14,centerX+0.12,shoY+0.05);
  set(15,centerX-0.10,shoY+0.20); set(16,centerX+0.10,shoY+0.20);
  set(23,centerX-0.05,hipY); set(24,centerX+0.05,hipY);
  set(25,centerX-0.05,hipY+0.15); set(26,centerX+0.05,hipY+0.15);
  set(27,centerX-0.05,hipY+0.30); set(28,centerX+0.05,hipY+0.30);
  return lm;
}
function tposeLandmarks(){ const lm=bodyLandmarks(0.5,0.62);
  lm[11]={x:0.42,y:0.4,visibility:1}; lm[12]={x:0.58,y:0.4,visibility:1};
  lm[15]={x:0.15,y:0.4,visibility:1}; lm[16]={x:0.85,y:0.4,visibility:1};   // arms out wide, level
  return lm; }
function flapPose(up){ const lm=bodyLandmarks(0.5,0.62);   // both wrists high (up) or low (down)
  const wy=up?0.16:0.60;
  lm[15]={x:0.30,y:wy,visibility:1}; lm[16]={x:0.70,y:wy,visibility:1};
  return lm; }
function bankPose(){ const lm=bodyLandmarks(0.5,0.62);      // LEFT hand high, RIGHT hand low → raiseL>raiseR (lean-right)
  lm[15]={x:0.22,y:0.18,visibility:1};
  lm[16]={x:0.78,y:0.58,visibility:1};
  return lm; }
function restPose(){ const lm=bodyLandmarks(0.5,0.62);      // relaxed arms partway down → avgRaise ≈ -0.5 (< CALIB_RELAX, above the dive pose)
  lm[15]={x:0.42,y:0.52,visibility:1}; lm[16]={x:0.58,y:0.52,visibility:1};
  return lm; }
let CURRENT_LM=bodyLandmarks(0.5,0.62);

const document={ getElementById:byId, createElement:()=>el('new'), head:el('head'),
  querySelectorAll:()=>[], addEventListener(){}, activeElement:null };
const store={};
// FEATURE 2: mark the first-time tutorial as already seen so the normal boot→calib→PLAY flow
// below is NOT diverted into the tutorial state. The tutorial state machine is exercised
// explicitly at the end of the run.
store['skydash_tut_done']='1';
const localStorage={ getItem:k=>k in store?store[k]:null, setItem:(k,v)=>{store[k]=String(v);} };
function Osc(){ return {type:'',frequency:{setValueAtTime(){}},connect(){return this;},start(){},stop(){}}; }
function Gain(){ return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){return this;}}; }
function AudioCtx(){ this.currentTime=0; this.state='running'; this.destination={}; this.resume=()=>{}; this.createOscillator=()=>new Osc(); this.createGain=()=>new Gain(); }
const win={ innerWidth:1280, innerHeight:720, devicePixelRatio:2,
  matchMedia:()=>({matches:false}), AudioContext:AudioCtx, webkitAudioContext:AudioCtx,
  addEventListener(){}, requestAnimationFrame:fn=>{ rafq.push(fn); return rafq.length; }, Pose:PoseStub };

const sandbox={ window:win, document, localStorage, Pose:PoseStub,
  navigator:{ mediaDevices:{ getUserMedia:async()=>({ getTracks:()=>[{stop(){}}] }) } },
  performance:{ now:()=>clock },
  requestAnimationFrame:win.requestAnimationFrame,
  setTimeout:(fn)=>{ try{fn();}catch(e){errors.push('setTimeout: '+e.stack);} return 0; }, clearTimeout(){},
  console:{ log(){}, warn(){}, error:(...a)=>errors.push('console.error: '+a.join(' ')) },
  Math,Date,JSON,Array,Object,Uint8ClampedArray,parseInt,parseFloat,isNaN,String,Number,Boolean,Promise,Symbol };
sandbox.globalThis=sandbox;

try{ vm.createContext(sandbox); vm.runInContext(script,sandbox,{filename:'sky-dash.html'}); }
catch(e){ console.error('boot threw:',e.stack); process.exit(1); }

const S=sandbox.__sky;
function upd(ms){ clock+=(ms||16); try{ S.update(clock); }catch(e){ errors.push('update: '+(e&&e.stack||e)); } }
function feed(lm){ CURRENT_LM=lm; try{ POSE.cb && POSE.cb({poseLandmarks:lm}); }catch(e){ errors.push('pose: '+(e&&e.stack||e)); } }
function run(n,lm){ for(let i=0;i<n;i++){ if(lm) feed(lm); upd(16); } }

(async()=>{
  if(!S || !S.G){ console.log('RUNTIME ERRORS:\n could not reach engine state (__sky missing)'); process.exit(1); }
  const G=S.G;

  // 1) boot a few frames on the lobby
  upd(16); upd(16); upd(16);
  if(G.screen!=='lobby') errors.push('did not boot into the lobby (screen='+G.screen+')');
  if(G.control!=='keyboard') errors.push('default control scheme should be keyboard (got '+G.control+')');

  // 2) enter CAMERA mode (async: getUserMedia + Pose warm-up)
  byId('playCamBtn')._fire('click');
  for(let i=0;i<25;i++){ await Promise.resolve(); await new Promise(r=>setTimeout(r,0)); }
  if(!G.cam.on) errors.push('camera did not come online after clicking Camera');
  if(G.control!=='camera') errors.push('Camera button did not switch to camera control');
  if(G.screen!=='lobby') errors.push('camera init should stay on the lobby (screen='+G.screen+')');

  // 2b) T-pose start gesture: hold a T-pose ~0.7s → crosses GESTURE_HOLD → play
  feed(tposeLandmarks());
  if(!G.cam.tpose) errors.push('T-pose not recognised in the lobby');
  let guard=0;
  while(G.screen!=='play' && guard++<400){ feed(G.screen==='calib'?restPose():tposeLandmarks()); upd(16); }   // T-pose→calib(relax)→play
  if(G.screen!=='play') errors.push('holding a T-pose did not start the game (screen='+G.screen+')');
  if(!G.running) errors.push('game did not enter the running state');
  if(G.apples.length!==16) errors.push('level did not scatter exactly 16 apples ('+G.apples.length+')');
  if(!(G.timeLeft>0 && G.timeLeft<=90)) errors.push('timer did not initialise to the 90s countdown (timeLeft='+G.timeLeft+')');

  // isolate the control checks from level events (collect/crash tested explicitly below)
  G.apples.length=0; G.obstacles.length=0;

  // 3) flap: a wing down-stroke adds upward lift (vy rises)
  run(2, flapPose(true));                 // arms up (up-stroke → no lift), seeds prevAvg high
  const vyBefore=G.bird.vy;
  feed(flapPose(false)); upd(16);         // arms down → down-stroke → lift
  if(!(G.bird.vy>vyBefore)) errors.push('a wing down-stroke did not add lift (vy '+vyBefore.toFixed(2)+'→'+G.bird.vy.toFixed(2)+')');

  // 4a) bank: lean-right (raiseL>raiseR) ⇒ steer RIGHT (positive turn ⇒ x DECREASES = screen-right = world −x)
  G.bird.x=0; G.bird.vx=0;
  run(24, bankPose());
  if(!(G.controls.turn>0)) errors.push('bank convention broken: lean-right (raiseL>raiseR) should give turn>0 (got '+G.controls.turn.toFixed(2)+')');
  if(!(G.bird.x<-0.1)) errors.push('lean-right did not steer the bird RIGHT (x='+G.bird.x.toFixed(2)+')');

  // 4b) pitch: arms-up = climb (slower), arms-down = dive (faster)
  run(12, flapPose(true));  const speedClimb=G.bird.speed;
  if(!(G.controls.pitch>0)) errors.push('arms-up did not register a climb (pitch='+G.controls.pitch.toFixed(2)+')');
  run(12, flapPose(false)); const speedDive=G.bird.speed;
  if(!(G.controls.pitch<0)) errors.push('arms-down did not register a dive (pitch='+G.controls.pitch.toFixed(2)+')');
  if(!(speedDive>speedClimb)) errors.push('a dive was not faster than a climb (climb '+speedClimb.toFixed(1)+' vs dive '+speedDive.toFixed(1)+')');

  // 5) collect an apple → applesCollected increments + HUD text updates
  G.apples=[{x:G.bird.x,y:G.bird.y,z:G.bird.z,collected:false,seed:0,popT:0}];
  const collectedBefore=G.applesCollected;
  upd(16);
  if(G.applesCollected!==collectedBefore+1) errors.push('flying into an apple did not collect it ('+collectedBefore+'→'+G.applesCollected+')');
  if(byId('appleV').textContent!==G.applesCollected+'/16') errors.push('apple HUD did not update (text='+byId('appleV').textContent+')');

  // 6) ENDLESS: collecting the 16th apple does NOT end the run; the round ends on TIMEOUT with a score
  G.applesCollected=15; G.apples=[{x:G.bird.x,y:G.bird.y,z:G.bird.z,collected:false,seed:0,popT:0}];
  upd(16);
  if(G.screen!=='play') errors.push('collecting the 16th apple must NOT end the endless run (screen='+G.screen+')');
  if(G.applesCollected!==16) errors.push('the 16th apple did not count in endless mode ('+G.applesCollected+')');
  G.timeLeft=0.01; upd(16);
  if(G.screen!=='over') errors.push('timeout did not end the run (screen='+G.screen+')');
  if(G.outcome!=='timeup') errors.push('run end outcome was not timeup (outcome='+G.outcome+')');
  if(!(G.score>=1600)) errors.push('score missing the apple payout (score='+G.score+')');
  if(byId('overTitleA').textContent!=='TIME') errors.push('timeout over-screen title not set (A='+byId('overTitleA').textContent+')');
  if(store['skydash_best']===undefined) errors.push('best score was not persisted to localStorage');

  // 7) T-pose restart from the over screen → back to play, fresh run
  feed(tposeLandmarks()); guard=0;
  while(G.screen!=='play' && guard++<400){ feed(G.screen==='calib'?restPose():tposeLandmarks()); upd(16); }   // T-pose→calib(relax)→play
  if(G.screen!=='play') errors.push('T-pose did not restart from the over screen (screen='+G.screen+')');
  if(G.applesCollected!==0) errors.push('restart did not reset the apple count (got '+G.applesCollected+')');

  // 6b) CRASH: an obstacle in the flight path ends the run with outcome 'crash'
  G.apples.length=0; G.obstacles=[{x:G.bird.x,y:G.bird.y,z:G.bird.z,type:'rock',r:1.6}];
  upd(16);
  if(G.screen!=='over') errors.push('an obstacle in the path did not crash the run (screen='+G.screen+')');
  if(G.outcome!=='crash') errors.push('hitting an obstacle was not a crash (outcome='+G.outcome+')');

  // 8) KEYBOARD scheme: fully playable with no camera
  G.control='keyboard';
  S.startGame();
  if(G.screen!=='play') errors.push('keyboard startGame did not reach play (screen='+G.screen+')');
  G.apples.length=0; G.obstacles.length=0;
  const zStart=G.bird.z;
  const vyPre=G.bird.vy; S.flap(); upd(16);
  if(!(G.bird.vy>vyPre)) errors.push('keyboard flap did not add lift (vy '+vyPre.toFixed(2)+'→'+G.bird.vy.toFixed(2)+')');
  G.bird.x=0; G.bird.vx=0; G.keys.right=true; run(20); G.keys.right=false;
  if(!(G.bird.x<-0.1)) errors.push('keyboard bank-right did not steer right (x='+G.bird.x.toFixed(2)+')');
  const spNeutral=G.bird.speed; G.keys.dive=true; run(6); G.keys.dive=false;
  if(!(G.bird.speed>spNeutral)) errors.push('keyboard dive did not speed up ('+spNeutral.toFixed(1)+' vs '+G.bird.speed.toFixed(1)+')');
  if(!(G.bird.z>zStart)) errors.push('keyboard play did not auto-fly forward (z did not advance)');
  if(G.screen!=='play') errors.push('keyboard play ended unexpectedly (screen='+G.screen+')');

  // 9) FEATURE 2 — TUTORIAL state machine: enter → detect a pose to advance → skip persists the flag
  delete store['skydash_tut_done'];         // simulate a first-time / replay user
  G.control='camera';
  S.startTutorial();
  if(G.screen!=='tutorial') errors.push('startTutorial did not enter the tutorial screen (screen='+G.screen+')');
  if(!G.tut || G.tut.step!==0 || G.tut.phase!=='coach') errors.push('tutorial did not open at step 0 in the coaching phase');
  if(byId('tutPanel').classList.contains('hidden')) errors.push('the tutorial side panel is not visible on step 0');
  // detect the FLAP step: a wing down-stroke gives lift>0 → the step is cleared, then auto-advances
  run(2, flapPose(true));                   // arms up (seeds prevAvg high — no lift yet)
  feed(flapPose(false)); upd(16);           // down-stroke → flap detected
  run(70, flapPose(false));                 // let the ~0.9s "Nice!" success flash resolve and advance
  if(!(G.tut && (G.tut.step>0 || G.tut.phase==='ready'))) errors.push('flapping did not advance the tutorial (step='+(G.tut&&G.tut.step)+', phase='+(G.tut&&G.tut.phase)+')');
  // "Skip tutorial" always works → sets the done flag so it never auto-shows again, returns to the lobby
  S.skipTutorial();
  if(store['skydash_tut_done']!=='1') errors.push('skipping the tutorial did not persist skydash_tut_done');
  if(G.screen!=='lobby') errors.push('skipping the tutorial did not return to the lobby (screen='+G.screen+')');
  if(G.tut!==null) errors.push('skipping the tutorial did not clear the tutorial state');

  if(errors.length){ console.log('RUNTIME ERRORS:\n'+errors.join('\n')); process.exit(1); }
  console.log('sky-dash smoke: boot + camera + T-pose start + flap + bank/pitch + collect + win + restart + crash + keyboard all ran with no errors');
  console.log('  final: screen='+G.screen+'  applesCollected='+G.applesCollected+'  best persisted='+store['skydash_best']);
  process.exit(0);
})();
