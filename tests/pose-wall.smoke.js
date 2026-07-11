/* Headless runtime smoke test for Pose Wall (mirrors tests/sky-dash.smoke.js).
   Extracts the Engine <script> (the body containing the /*__POSE_WALL_ENGINE__* / sentinel — NOT
   the ESM View module and NOT the importmap JSON), runs it in vm with DOM/canvas/getUserMedia/Pose
   shims, then drives: boot(lobby) -> Camera -> T-pose start -> calibration -> pass a wall ->
   force misses to lives-0 game over -> T-pose restart -> keyboard fallback (pass+miss) -> 20-wall
   WIN. Any thrown error or console.error fails the run.
   Run: node tests/pose-wall.smoke.js */
const fs=require('fs'), vm=require('vm'), path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','pose-wall.html'),'utf8');

// select the Engine script by its sentinel (robust against the importmap + View module blocks)
const bodies=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const script=bodies.find(s=>s.includes('/*__POSE_WALL_ENGINE__*/'));
if(!script){ console.error('could not find the /*__POSE_WALL_ENGINE__*/ engine script'); process.exit(1); }

let errors=[];
const err=m=>errors.push(m);
const rafq=[]; let clock=0;

function ctxStub(){
  const noop=()=>{}; const grad={addColorStop:noop};
  return new Proxy({ canvas:{width:132,height:99}, createLinearGradient:()=>grad, createRadialGradient:()=>grad,
    setTransform:noop, getImageData:()=>({data:new Uint8ClampedArray(4)}) },
    { get(t,k){ return k in t?t[k]:noop; }, set(){return true;} });
}
function el(id){
  const h={};
  const e={ id, dataset:{}, style:{}, textContent:'', innerHTML:'', value:'', disabled:false, srcObject:null, readyState:4,
    width:48, height:48, offsetWidth:1,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
      toggle(c,on){ if(on===undefined)on=!this._s.has(c); on?this._s.add(c):this._s.delete(c); return on;}, contains(c){return this._s.has(c);} },
    setAttribute(k,v){ this['_'+k]=String(v); }, getAttribute(k){ return this['_'+k]; },
    addEventListener(ev,fn){ (h[ev]=h[ev]||[]).push(fn); }, removeEventListener(){},
    appendChild(){}, getContext(){ return ctxStub(); }, play(){ return Promise.resolve(); },
    getBoundingClientRect(){ return {width:132,height:99,left:0,top:0,right:132,bottom:99}; },
    _fire(ev,o){ (h[ev]||[]).forEach(fn=>fn(Object.assign({preventDefault(){},target:e},o))); }, _has(ev){return !!(h[ev]&&h[ev].length);} };
  // camOverlay / nextPose want real-ish canvas dims
  if(id==='camOverlay'){ e.width=132; e.height=99; }
  return e;
}
const cache={};
const byId=id=>cache[id]||(cache[id]=el(id));

// capture the pose callback the engine registers
const POSE={cb:null};
class PoseStub{ constructor(){} setOptions(){} onResults(cb){ this.cb=cb; POSE.cb=cb; }
  async send(){ if(this.cb) this.cb({poseLandmarks:CURRENT_LM}); } close(){} }

// a T-pose landmark set (arms out wide at shoulder height) — the start/restart gesture.
function tposeLandmarks(){
  const lm=Array.from({length:33},()=>({x:0.5,y:0.5,visibility:1}));
  const set=(i,x,y)=>{ lm[i]={x,y,visibility:1}; };
  set(0,0.5,0.20);
  set(11,0.42,0.40); set(12,0.58,0.40);
  set(13,0.28,0.40); set(14,0.72,0.40);
  set(15,0.15,0.40); set(16,0.85,0.40);   // arms out wide, level
  set(23,0.45,0.62); set(24,0.55,0.62);
  set(25,0.45,0.78); set(26,0.55,0.78);
  set(27,0.45,0.92); set(28,0.55,0.92);
  return lm;
}
let CURRENT_LM=tposeLandmarks();

const document={ getElementById:byId, createElement:()=>el('new'), head:el('head'),
  querySelectorAll:()=>[], addEventListener(){}, activeElement:null };
const store={};
// mark the first-time tutorial as already seen so the normal boot→play flow below is unblocked
// (the dedicated tutorial section at the end clears this flag to exercise the first-time path).
store['posewall_tut_done']='1';
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

try{ vm.createContext(sandbox); vm.runInContext(script,sandbox,{filename:'pose-wall.html'}); }
catch(e){ console.error('boot threw:',e.stack); process.exit(1); }

const S=sandbox.__pw;
function upd(ms){ clock+=(ms||16); try{ S.update(clock); }catch(e){ errors.push('update: '+(e&&e.stack||e)); } }
function feed(lm){ CURRENT_LM=lm; try{ POSE.cb && POSE.cb({poseLandmarks:lm}); }catch(e){ errors.push('pose: '+(e&&e.stack||e)); } }
function run(n,lm){ for(let i=0;i<n;i++){ if(lm) feed(lm); upd(16); } }

(async()=>{
  if(!S || !S.G){ console.log('RUNTIME ERRORS:\n could not reach engine state (__pw missing)'); process.exit(1); }
  const G=S.G, LIB=S.POSE_LIBRARY;
  const byPoseId=id=>LIB.find(p=>p.id===id);
  const idxOf=id=>LIB.findIndex(p=>p.id===id);

  // 1) boot a few frames on the lobby
  upd(16); upd(16); upd(16);
  if(G.screen!=='lobby') err('did not boot into the lobby (screen='+G.screen+')');
  if(G.control!=='keyboard') err('default control scheme should be keyboard (got '+G.control+')');

  // 2) enter CAMERA mode (async: getUserMedia + Pose warm-up)
  byId('playCamBtn')._fire('click');
  for(let i=0;i<25;i++){ await Promise.resolve(); await new Promise(r=>setTimeout(r,0)); }
  if(!G.cam.on) err('camera did not come online after clicking Camera');
  if(G.control!=='camera') err('Camera button did not switch to camera control');
  if(G.screen!=='lobby') err('camera init should stay on the lobby (screen='+G.screen+')');

  // 3) T-pose start gesture: hold a T-pose across GESTURE_HOLD → play + calibration captured
  feed(tposeLandmarks());
  if(!G.cam.tpose) err('T-pose not recognised in the lobby');
  let guard=0;
  while(G.screen!=='play' && guard++<200){ feed(tposeLandmarks()); upd(16); }
  if(G.screen!=='play') err('holding a T-pose did not start the game (screen='+G.screen+')');
  if(!G.running) err('game did not enter the running state');
  if(!G.calibration.done) err('calibration was not captured on start');
  if(G.lives!==3) err('lives did not initialise to 3 (lives='+G.lives+')');
  if(G.score!==0) err('score did not initialise to 0 (score='+G.score+')');
  if(!(G.walls[0] && G.walls[0].target)) err('no active wall with a target after start');
  if(G.walls[0] && G.walls[0].targetId!=='ARMS_UP') err('first wall was not the easy ARMS_UP (got '+ (G.walls[0]&&G.walls[0].targetId) +')');

  // 4) PASS a wall: feed the active wall's own fixture until matchScore crosses PASS, then resolve
  {
    const fix=byPoseId(G.walls[0].targetId).lm;
    const scoreBefore=G.score;
    guard=0; while(G.matchScore<0.72 && guard++<60){ feed(fix); upd(16); }
    if(!(G.matchScore>=0.72)) err('feeding the target fixture did not raise matchScore to PASS ('+G.matchScore.toFixed(3)+')');
    G.walls[0].dist=0.001; feed(fix); upd(16);   // resolve at the impact plane
    if(G.score!==scoreBefore+1) err('passing a wall did not increment score ('+scoreBefore+'→'+G.score+')');
    if(G.streak<1) err('streak did not grow on a pass (streak='+G.streak+')');
    if(byId('scoreV').textContent!==String(G.score)) err('score HUD did not update (text='+byId('scoreV').textContent+')');
  }

  // 5) force MISSES to lives-0 game over: feed a clearly-different fixture (HANDS_ON_HIPS)
  {
    const miss=byPoseId('HANDS_ON_HIPS').lm;
    guard=0;
    while(G.lives>0 && G.screen==='play' && guard++<80){
      feed(miss); upd(16);                    // matchScore stays low vs the tier-1 walls
      if(G.walls[0]) G.walls[0].dist=0.001;
      feed(miss); upd(16);                    // resolve → miss
    }
    if(G.screen!=='over') err('lives reaching 0 did not end the run (screen='+G.screen+')');
    if(G.outcome!=='over') err('lives-0 outcome was not "over" (outcome='+G.outcome+')');
    if(G.lives!==0) err('lives were not 0 at game over (lives='+G.lives+')');
    if(byId('overTitleA').textContent!=='GAME') err('game-over title not set (A='+byId('overTitleA').textContent+')');
    if(store['posewall_best']===undefined) err('best score was not persisted to localStorage');
    if(store['posewall_beststreak']===undefined) err('best streak was not persisted to localStorage');
  }

  // 6) T-pose restart from the over screen → back to play, fresh run
  feed(tposeLandmarks()); guard=0;
  while(G.screen!=='play' && guard++<200){ feed(tposeLandmarks()); upd(16); }
  if(G.screen!=='play') err('T-pose did not restart from the over screen (screen='+G.screen+')');
  if(G.lives!==3) err('restart did not reset lives (lives='+G.lives+')');
  if(G.score!==0) err('restart did not reset the score (score='+G.score+')');

  // 7) KEYBOARD fallback — commit the correct pose → pass; commit a wrong pose → miss
  {
    G.control='keyboard';
    S.startGame();
    if(G.screen!=='play') err('keyboard startGame did not reach play (screen='+G.screen+')');
    const activeId=G.walls[0].targetId;
    const scoreBefore=G.score;
    S.commitPose(idxOf(activeId));
    if(G.committedPoseId!==activeId) err('commitPose did not commit the selected pose');
    guard=0; while(G.matchScore<0.72 && guard++<40){ upd(16); }   // kbLm drives matching, no feed
    if(!(G.matchScore>=0.72)) err('keyboard commit of the correct pose did not raise matchScore ('+G.matchScore.toFixed(3)+')');
    G.walls[0].dist=0.001; upd(16);
    if(G.score!==scoreBefore+1) err('keyboard correct commit did not pass ('+scoreBefore+'→'+G.score+')');

    // wrong pose for the next wall → miss
    const nextId=G.walls[0].targetId;
    let wrongIdx=idxOf('HANDS_ON_HIPS'); if(LIB[wrongIdx].id===nextId) wrongIdx=idxOf('STAR');
    const livesBefore=G.lives;
    S.commitPose(wrongIdx);
    run(5);
    G.walls[0].dist=0.001; upd(16);
    if(!(G.lives<livesBefore || (G.screen==='over'&&G.outcome==='over'))) err('keyboard wrong commit did not miss (lives '+livesBefore+'→'+G.lives+')');
  }

  // 8) WIN path — clear walls (always committing the correct pose) until the 20-wall win fires
  {
    G.control='keyboard'; S.startGame();
    guard=0;
    while(G.screen==='play' && guard++<50){
      const ai=idxOf(G.walls[0].targetId);
      S.commitPose(ai);
      let g2=0; while(G.matchScore<0.72 && g2++<20){ upd(16); }
      G.walls[0].dist=0.001; upd(16);
    }
    if(G.outcome!=='win') err('clearing 20 walls did not produce a win (outcome='+G.outcome+', score='+G.score+')');
    if(G.screen!=='over') err('the win did not land on the over screen (screen='+G.screen+')');
    if(byId('overTitleA').textContent!=='YOU') err('win over-screen title not set (A='+byId('overTitleA').textContent+')');
    if(G.score<20) err('win fired before 20 walls (score='+G.score+')');
  }

  // 9) FIRST-TIME TUTORIAL — the start gate routes first-timers into a guided, NO-FAIL demo;
  //    clearing a step needs a real pose match; "Skip" persists posewall_tut_done → returning
  //    users then go straight to play.
  {
    G.control='keyboard';
    delete store['posewall_tut_done'];          // simulate a brand-new player
    S.startFlow();                              // first-time → tutorial, NOT normal play
    if(G.screen!=='tutorial') err('first-time startFlow did not enter the tutorial (screen='+G.screen+')');
    if(!G.tutorial.active) err('tutorial.active was not set on entry');
    if(!(G.walls[0] && G.walls[0].target)) err('tutorial did not spawn a coaching wall');
    if(G.tutorial.step!==0) err('tutorial did not begin on step 0 (step='+G.tutorial.step+')');

    const livesBefore=G.lives;
    // clear step 0 by holding the matching pose at the wait plane — must be no-fail (no life lost)
    let g=0;
    while(G.tutorial.active && G.tutorial.step===0 && G.walls[0] && g++<300){
      S.commitPose(idxOf(G.walls[0].targetId));
      G.walls[0].dist=0.001;                    // drive the wall to the hold plane
      upd(16);
    }
    if(G.lives!==livesBefore) err('tutorial changed lives — it must be strictly no-fail (lives '+livesBefore+'→'+G.lives+')');
    if(G.screen==='over') err('tutorial reached a game-over — it must be no-fail');
    if(!(G.tutorial.step>0 || !G.walls[0])) err('holding the matching pose did not clear the first tutorial step');

    // Skip tutorial → persists the done flag, deactivates, returns to the lobby
    S.skipTutorial();
    if(store['posewall_tut_done']!=='1') err('skipping the tutorial did not persist posewall_tut_done');
    if(G.tutorial.active) err('skip did not deactivate the tutorial');
    if(G.screen!=='lobby') err('skip did not return to the lobby (screen='+G.screen+')');

    // returning user → startFlow goes straight to normal play (no tutorial)
    S.startFlow();
    if(G.screen!=='play') err('returning-user startFlow did not go straight to play (screen='+G.screen+')');
    if(G.tutorial.active) err('returning-user flow should not re-activate the tutorial');
  }

  if(errors.length){ console.log('RUNTIME ERRORS:\n'+errors.join('\n')); process.exit(1); }
  console.log('pose-wall smoke: boot + camera + T-pose start + calibration + pass + lives-0 over + restart + keyboard pass/miss + 20-wall win + first-time tutorial (no-fail step clear + skip flag) all ran with no errors');
  console.log('  final: screen='+G.screen+'  outcome='+G.outcome+'  score='+G.score+'  best='+store['posewall_best']+'  beststreak='+store['posewall_beststreak']);
  process.exit(0);
})();
