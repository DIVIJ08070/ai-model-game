/* Sky Dash — pure control-math logic, mirrored VERBATIM from the Engine <script>
   in sky-dash.html (same convention as tests/logic.test.js mirrors index.html).
   Run: node tests/sky-dash.logic.test.js */

/* ---- helpers + tuning consts (mirrored) ---- */
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const lerp=(a,b,t)=>a+(b-a)*t;
const sign=x=>x>0?1:(x<0?-1:0);
const LIFT_MAX=3.5, ROLL_MAX=0.5, MAX_ALT=60, BANK_DEADZONE=0.12;
const PARAMS={ gravity:4.0, baseSpeed:14, vxDamp:0.9, turnAccel:16, maxVx:8,
               climbSlow:0.35, diveFast:0.5, glideDescent:0.35,
               diveAccel:16, termVy:20, tuckSpeed:0.35,
               bankSink:2.0 };

/* ---- pure functions (copied verbatim from the Engine) ---- */
function flapImpulse(prevRaise, curRaise, dt, k, deadzone){
  if(k==null) k=0.9; if(deadzone==null) deadzone=0.6;
  if(dt<=0) return 0;
  var v=(prevRaise-curRaise)/dt;
  if(v<=deadzone) return 0;
  return clamp(k*(v-deadzone),0,LIFT_MAX);
}
function glideFactor(wristSpan, shoulderW, raiseL, raiseR){
  var sw=Math.max(1e-6,shoulderW);
  var wide=clamp((wristSpan/sw-1.6)/(2.4-1.6),0,1);
  var level=1-clamp(Math.max(Math.abs(raiseL),Math.abs(raiseR))/0.5,0,1);
  return wide*level;
}
function tuckAmount(wristSpan, shoulderW, raiseL, raiseR){
  var sw=Math.max(1e-6,shoulderW);
  var ratio=wristSpan/sw;
  var narrow=clamp((1.05-ratio)/(1.05-0.40),0,1);
  var hi=Math.max(Math.abs(raiseL),Math.abs(raiseR));
  var near=1-clamp((hi-0.25)/(0.95-0.25),0,1);
  var t=narrow*near;
  return t<0.12 ? 0 : clamp((t-0.12)/(1-0.12),0,1);
}
function bankRate(raiseL, raiseR, deadzone, maxRate){
  if(deadzone==null) deadzone=BANK_DEADZONE; if(maxRate==null) maxRate=1.0;
  var diff=raiseL-raiseR;
  if(Math.abs(diff)<deadzone) return 0;
  return sign(diff)*Math.min(Math.abs(diff)-deadzone,1)*maxRate;
}
function pitchRate(avgRaise, neutral, deadzone, maxRate){
  if(deadzone==null) deadzone=0.2; if(maxRate==null) maxRate=1.0;
  var d=avgRaise-neutral;
  if(Math.abs(d)<deadzone) return 0;
  return sign(d)*Math.min(Math.abs(d)-deadzone,1)*maxRate;
}
function stepFlight(state, controls, dt, params){
  var p=params||PARAMS;
  var lift=controls.lift||0, turn=controls.turn||0, pitch=controls.pitch||0, glide=controls.glide||0, tuck=controls.tuck||0;
  var bank=clamp(Math.abs(turn),0,1);
  var descent=p.gravity*(1-glide*(1-p.glideDescent)) + tuck*(p.diveAccel||0) + bank*(p.bankSink||0);
  state.vy=(state.vy||0)+lift-descent*dt;
  if(tuck>0){ var term=-(p.termVy||18); if(state.vy<term) state.vy=term; }
  state.speed=p.baseSpeed*(1-pitch*p.climbSlow)*(1+Math.max(0,-pitch)*p.diveFast)*(1+tuck*(p.tuckSpeed||0));
  state.vx=clamp((state.vx||0)*p.vxDamp - turn*p.turnAccel*dt,-p.maxVx,p.maxVx);
  state.x=(state.x||0)+state.vx*dt;
  state.z=(state.z||0)+state.speed*dt;
  state.y=(state.y||0)+state.vy*dt;
  state.roll=lerp(state.roll||0, clamp(turn,-1,1)*ROLL_MAX, clamp(dt*8,0,1));
  return state;
}
function applyCeiling(bird, groundY, maxAlt){
  var c=groundY+maxAlt;
  if(bird.y>c){ bird.y=c; if((bird.vy||0)>0) bird.vy=0; }
  return bird;
}
function appleCollected(bird, apple, r){
  if(r==null) r=2.2;
  var dx=bird.x-apple.x, dy=bird.y-apple.y, dz=bird.z-apple.z;
  return (dx*dx+dy*dy+dz*dz) < r*r;
}
function isCrash(bird, groundYAt, obstacles, r){
  if(r==null) r=1.6;
  var g=(typeof groundYAt==='function')?groundYAt(bird.x,bird.z):groundYAt;
  if(typeof g==='number' && bird.y<=g) return true;
  if(obstacles){ for(var i=0;i<obstacles.length;i++){ var o=obstacles[i];
    var dx=bird.x-o.x, dy=bird.y-o.y, dz=bird.z-o.z, rr=r+(o.r||0);
    if(dx*dx+dy*dy+dz*dz < rr*rr) return true; } }
  return false;
}
function isTpose(lm){ if(!lm) return false;
  var vis=function(i){ return lm[i]&&(lm[i].visibility===undefined||lm[i].visibility>0.5); };
  if(!(vis(11)&&vis(12)&&vis(15)&&vis(16))) return false;
  var shY=(lm[11].y+lm[12].y)/2, shW=Math.abs(lm[11].x-lm[12].x)+1e-6, span=Math.abs(lm[15].x-lm[16].x);
  if(span<shW*2.2) return false; var tol=shW*0.9;
  return Math.abs(lm[15].y-shY)<tol && Math.abs(lm[16].y-shY)<tol; }
function computeScore(applesCollected, timeLeft, outcome){
  return applesCollected*100 + (outcome==='win'?Math.round(timeLeft*10):0);
}
function mkBody(spec){ const lm=Array.from({length:33},()=>({x:0.5,y:0.5,visibility:1})); for(const k in spec) lm[k]={x:spec[k][0],y:spec[k][1],visibility:1}; return lm; }

let pass=0,fail=0;
const ok=(n,c,d)=>{ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+'  — '+d)); };
console.log('Sky Dash — control logic\n');

// ---- 🪽 flapImpulse (down-stroke = raise decreasing = lift) ----
ok('a slow/below-dead-zone stroke gives no lift', flapImpulse(1,0.99,1)===0);
ok('an upstroke (raise increasing) gives no lift', flapImpulse(0,1,0.1)===0);
ok('a still pose gives no lift', flapImpulse(1,1,0.1)===0);
ok('a faster down-stroke gives strictly MORE lift', flapImpulse(2,0,1) > flapImpulse(1,0,1),
   'fast='+flapImpulse(2,0,1).toFixed(3)+' slow='+flapImpulse(1,0,1).toFixed(3));
ok('lift clamps at LIFT_MAX for a huge down-stroke', flapImpulse(10,0,0.1)===LIFT_MAX);
ok('lift is never negative', flapImpulse(0,5,0.1)>=0 && flapImpulse(1,0,1)>=0);
ok('dt<=0 is safe (no divide blow-up)', flapImpulse(1,0,0)===0 && flapImpulse(1,0,-1)===0);

// ---- 🕊️ glideFactor ∈ [0,1] ----
ok('wide arms at shoulder level → near-full glide', Math.abs(glideFactor(0.24,0.1,0,0)-1)<1e-9);
ok('narrow arms → no glide', glideFactor(0.16,0.1,0,0)===0);
ok('arms far off the shoulder line → no glide even if wide', glideFactor(0.24,0.1,0.6,0)===0);
ok('glide is partial in the mid-band', glideFactor(0.20,0.1,0,0)>0 && glideFactor(0.20,0.1,0,0)<1);
ok('glide always stays within [0,1]', (()=>{ let good=true;
  for(const ws of [0.10,0.16,0.20,0.30]) for(const rl of [-1,0,0.3,1]){ const g=glideFactor(ws,0.1,rl,0); if(g<0||g>1) good=false; } return good; })());

// ---- 🤿 tuckAmount (FEATURE 1) — crossed/tucked arms → dive; the OPPOSITE of glide ----
ok('crossed-in pose (narrow span, hands at chest) → tuck above the dead-zone', tuckAmount(0.05,0.12,0,0)>0,
   'got '+tuckAmount(0.05,0.12,0,0).toFixed(3));
ok('a wide/spread pose (glide-shaped) → NO tuck', tuckAmount(0.24,0.12,0,0)===0);
ok('narrow BUT raised overhead → NO tuck (not a chest tuck)', tuckAmount(0.05,0.12,1.0,1.0)===0);
ok('a barely-narrow pose stays inside the dead-zone → 0', tuckAmount(0.12,0.12,0,0)===0);
ok('tuck always stays within [0,1]', (()=>{ let good=true;
  for(const ws of [0.03,0.05,0.10,0.16,0.24]) for(const rl of [-1,-0.3,0,0.3,1]){ const tt=tuckAmount(ws,0.12,rl,rl); if(tt<0||tt>1) good=false; } return good; })());
ok('tuck is CLEARLY DISTINCT from glide: wide→glide only, narrow-chest→tuck only', (()=>{
  const wide = glideFactor(0.24,0.12,0,0)>0 && tuckAmount(0.24,0.12,0,0)===0;
  const narrow = tuckAmount(0.05,0.12,0,0)>0 && glideFactor(0.05,0.12,0,0)===0;
  return wide && narrow; })());
ok('a tighter tuck reads stronger than a looser one', tuckAmount(0.04,0.12,0,0) > tuckAmount(0.09,0.12,0,0));

// ---- ⇆ bankRate — DIRECTION CONVENTION (Manager #1): raiseL>raiseR ⇒ steer RIGHT (positive) ----
ok('symmetric arms → no turn (dead-zone)', bankRate(0.5,0.5)===0);
ok('a tiny asymmetry inside the dead-zone → no turn', bankRate(0.55,0.45)===0);
ok('raiseL>raiseR ⇒ steers RIGHT (POSITIVE) — the documented convention', bankRate(0.6,0.2) > 0,
   'got '+bankRate(0.6,0.2).toFixed(3));
ok('raiseR>raiseL ⇒ steers LEFT (NEGATIVE) — the mirror', bankRate(0.2,0.6) < 0);
ok('bank is exactly mirror-symmetric', bankRate(0.6,0.2)=== -bankRate(0.2,0.6));
ok('bank magnitude clamps at maxRate', bankRate(2,0)===1.0 && bankRate(0,2)===-1.0);
ok('at an asymmetric REST the baseline-subtracted bank is 0 — no drift', bankRate(0.30-0.30, (-0.10)-(-0.10))===0);
ok('raising the LEFT arm above its own rest (lean-right) steers RIGHT regardless of rest asymmetry', bankRate(0.50-(-0.10), 0.30-0.30) > 0);

// ---- ⇅ pitchRate (+ = climb, − = dive) ----
ok('at the calibrated neutral → level (0)', pitchRate(-1.15,-1.15)===0);
ok('a small deviation inside the dead-zone → level', pitchRate(0.1,0)===0);
ok('arms above neutral → CLIMB (positive)', pitchRate(0.6,0) > 0);
ok('arms tucked below neutral → DIVE (negative)', pitchRate(-0.6,0) < 0);
ok('pitch magnitude clamps at maxRate', pitchRate(5,0)===1.0 && pitchRate(-5,0)===-1.0);

// ---- ✈ stepFlight — the §4.6 monotonic properties ----
const mkBird=()=>({x:0,y:30,z:0,vx:0,vy:0,roll:0,speed:14});
ok('larger lift ⇒ higher vy', (()=>{ const a=stepFlight(mkBird(),{lift:1},0.1);
  const b=stepFlight(mkBird(),{lift:3},0.1); return b.vy>a.vy; })());
ok('no lift over a step ⇒ altitude drops', (()=>{ const s=stepFlight(mkBird(),{lift:0},0.1); return s.y<30; })());
ok('turn>0 ⇒ x decreases (banks RIGHT on screen = world −x)', (()=>{ const s=stepFlight(mkBird(),{turn:1},0.1); return s.x<0; })());
ok('turn<0 ⇒ x increases (banks LEFT on screen = world +x)', (()=>{ const s=stepFlight(mkBird(),{turn:-1},0.1); return s.x>0; })());
ok('a dive (pitch<0) is FASTER than neutral', (()=>{ const n=stepFlight(mkBird(),{},0.1);
  const d=stepFlight(mkBird(),{pitch:-1},0.1); return d.speed>n.speed; })());
ok('a climb (pitch>0) is SLOWER than neutral', (()=>{ const n=stepFlight(mkBird(),{},0.1);
  const c=stepFlight(mkBird(),{pitch:1},0.1); return c.speed<n.speed; })());
ok('glide=1 descends SLOWER than glide=0', (()=>{ const g0=stepFlight(mkBird(),{glide:0},0.1);
  const g1=stepFlight(mkBird(),{glide:1},0.1); return g1.vy>g0.vy && g1.y>g0.y; })());
ok('auto-fly: z always advances forward', (()=>{ const s=stepFlight(mkBird(),{},0.1); return s.z>0; })());
ok('roll follows the turn toward +ROLL_MAX for a RIGHT turn', (()=>{ let s=mkBird();
  for(let i=0;i<40;i++) s=stepFlight(s,{turn:1},0.05); return s.roll>0 && s.roll<=ROLL_MAX+1e-9; })());
ok('vx is clamped to ±maxVx', (()=>{ let s=mkBird(); for(let i=0;i<200;i++) s=stepFlight(s,{turn:1},0.1);
  return Math.abs(s.vx)<=PARAMS.maxVx+1e-9; })());

// ---- 🤿 dive physics (FEATURE 1) — a tuck descends faster, clamped, with a small forward boost ----
ok('a tuck/dive INCREASES descent (vy more negative + altitude drops) vs no tuck', (()=>{
  const n=stepFlight(mkBird(),{tuck:0},0.1), d=stepFlight(mkBird(),{tuck:1},0.1);
  return d.vy<n.vy && d.y<n.y; })());
ok('a partial tuck dives between no-tuck and full-tuck', (()=>{
  const n=stepFlight(mkBird(),{tuck:0},0.1), h=stepFlight(mkBird(),{tuck:0.5},0.1), d=stepFlight(mkBird(),{tuck:1},0.1);
  return d.vy<h.vy && h.vy<n.vy; })());
ok('the dive is a CONTROLLED speed-dive — vy clamps at terminal velocity, never a teleport', (()=>{
  let s=mkBird(); for(let i=0;i<300;i++) s=stepFlight(s,{tuck:1},0.1); return s.vy>=-(PARAMS.termVy)-1e-9; })());
ok('a tuck adds a small forward-speed boost', (()=>{
  const n=stepFlight(mkBird(),{tuck:0},0.1), d=stepFlight(mkBird(),{tuck:1},0.1); return d.speed>n.speed; })());

// ---- ↘ Goal 3 — banking asymmetry bleeds a LITTLE altitude, far less than a full tuck-dive ----
ok('banking (wing asymmetry) adds a little descent, but FAR less than a full tuck-dive', (()=>{
  const level=stepFlight(mkBird(),{turn:0},0.1);
  const bank =stepFlight(mkBird(),{turn:1},0.1);
  const dive =stepFlight(mkBird(),{tuck:1},0.1);
  const bankDrop=level.vy-bank.vy, diveDrop=level.vy-dive.vy;
  return bank.vy<level.vy && bank.y<level.y            // banking loses a little altitude vs level
      && bankDrop>0 && bankDrop < 0.25*diveDrop        // and that loss is far less than a full tuck-dive
      && bank.vy>dive.vy; })());                        // banking is nowhere near as steep as a dive
ok('a symmetric (no-turn) bank adds NO extra sink', (()=>{
  const level=stepFlight(mkBird(),{turn:0},0.1), zero=stepFlight(mkBird(),{turn:0,tuck:0},0.1);
  return level.vy===zero.vy; })());

// ---- 🔝 applyCeiling — ground-relative altitude cap (kills only upward vy, never pulls down) ----
ok('altitude caps at ground+MAX_ALT and kills upward vy', (()=>{ const b={x:0,y:200,z:0,vy:5}; applyCeiling(b,6,MAX_ALT); return b.y===66 && b.vy===0; })());
ok('below the ceiling, altitude & vy are untouched', (()=>{ const b={x:0,y:30,z:0,vy:2}; applyCeiling(b,6,MAX_ALT); return b.y===30 && b.vy===2; })());
ok('the ceiling never pulls the bird DOWN', (()=>{ const b={x:0,y:10,z:0,vy:-3}; applyCeiling(b,6,MAX_ALT); return b.y===10 && b.vy===-3; })());

// ---- 🍎 appleCollected / 💥 isCrash ----
ok('apple inside the radius is collected', appleCollected({x:0,y:30,z:0},{x:1,y:30.5,z:1})===true);
ok('apple outside the radius is NOT collected', appleCollected({x:0,y:30,z:0},{x:5,y:30,z:5})===false);
ok('collect radius is tunable via r', appleCollected({x:0,y:30,z:0},{x:2.5,y:30,z:0},2.2)===false
   && appleCollected({x:0,y:30,z:0},{x:2.5,y:30,z:0},3.0)===true);
ok('touching the ground is a crash', isCrash({x:0,y:5,z:0}, ()=>6, [])===true);
ok('flying above the ground is not a crash', isCrash({x:0,y:30,z:0}, ()=>6, [])===false);
ok('a constant (number) ground floor also works', isCrash({x:0,y:2,z:0}, 6, [])===true);
ok('an obstacle within radius is a crash', isCrash({x:0,y:30,z:0}, 0, [{x:0.5,y:30,z:0,r:1.6}])===true);
ok('an obstacle off to the side is safe', isCrash({x:0,y:30,z:0}, 0, [{x:12,y:30,z:0,r:1.6}])===false);

// ---- 🧍 isTpose (the four canonical cases from logic.test.js) ----
const T_POSE=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.15,0.4],16:[0.85,0.4]});
const ARMS_DOWN=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.4,0.85],16:[0.6,0.85]});
const ARMS_NARROW=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.45,0.4],16:[0.55,0.4]});
const ARMS_UP=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.2,0.1],16:[0.8,0.1]});
ok('arms out at shoulder height is a T-pose', isTpose(T_POSE)===true);
ok('arms down is NOT a T-pose', isTpose(ARMS_DOWN)===false);
ok('arms tucked in (narrow) is NOT a T-pose', isTpose(ARMS_NARROW)===false);
ok('arms raised up (not level) is NOT a T-pose', isTpose(ARMS_UP)===false);
ok('no landmarks → not a T-pose', isTpose(null)===false && isTpose([])===false);

// ---- 🗺️ map registry (selectable themes) — mirrored VERBATIM from sky-dash.html ----
var MAPS=[{ id:'meadow', label:'Green Hills', emoji:'⛰️' },{ id:'beach', label:'Beach', emoji:'🏝️' }];
function mapDef(id){ for(var i=0;i<MAPS.length;i++){ if(MAPS[i].id===id) return MAPS[i]; } return MAPS[0]; }
ok('mapDef returns the requested map', mapDef('beach').id==='beach' && mapDef('beach').label==='Beach');
ok('mapDef resolves the base map', mapDef('meadow').id==='meadow');
ok('mapDef falls back to the first map for unknown / null ids', mapDef('atlantis').id==='meadow' && mapDef(null).id==='meadow');
ok('every map has an id, label and emoji', MAPS.every(function(m){ return !!(m.id && m.label && m.emoji); }));
ok('at least two maps are selectable', MAPS.length>=2);

// ---- 🏆 scoring (Manager Decision #2) ----
ok('win score = apples*100 + round(timeLeft*10)', computeScore(16,28.4,'win')===16*100+284);
ok('a non-win score has no time bonus', computeScore(9,50,'timeup')===900 && computeScore(9,50,'crash')===900);
ok('timeLeft bonus rounds to the nearest whole point', computeScore(0,1.04,'win')===10 && computeScore(0,1.06,'win')===11);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
