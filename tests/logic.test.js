/* Pure body-signal -> game-intent logic, mirrored from index.html.
   Run: node tests/logic.test.js */
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
function pickLane(x,cur,h){ h=(h==null)?0.06:h;
  if(x<1/3-h) return 0; if(x>2/3+h) return 2;
  if(x>1/3+h && x<2/3-h) return 1; return cur; }
function pickLaneOffset(off,cur,step,h){ step=(step==null)?0.11:step; h=(h==null)?0.035:h;
  if(off<=-step) return 0; if(off>=step) return 2;
  if(off>-(step-h)&&off<(step-h)) return 1; return cur; }
function laneStep(shoulderW){ return clamp(shoulderW*0.55,0.05,0.13); }
function jumpThreshold(t){ return clamp(0.34*t,0.045,0.13); }
function isJumpTrigger(curY,prevY,baseY,t,th){ th=(th==null)?jumpThreshold(t):th; return (baseY-curY)>th && curY<prevY; }
function runningLevel(e,t){ const n=t>0?e/t:0; return clamp(n/0.9,0,1); }
function jumpThreshold(t){ return clamp(0.34*t,0.045,0.13); }
function isDuckTrigger(c,p,b,t,th){ th=(th==null)?jumpThreshold(t):th; return (c-b)>th && c>p; }
function isPunch(w,pw,shY,t){ if(!w||!pw||t<=0) return false;
  const raised=w.y < shY + t*0.35;
  const speed=Math.hypot(w.x-pw.x,w.y-pw.y)/t;
  return raised && speed>0.30; }
function isVictory(h){ if(!h||h.length<21) return false;
  const up=(t,p)=>(h[p].y-h[t].y)>0.04;
  const index=up(8,6),middle=up(12,10),ring=up(16,14),pinky=up(20,18);
  if(!(index&&middle)||ring||pinky) return false;
  const spread=Math.hypot(h[8].x-h[12].x,h[8].y-h[12].y);
  const size=Math.hypot(h[0].x-h[9].x,h[0].y-h[9].y)+1e-6;
  return spread/size>0.30; }
function isTpose(lm){ if(!lm) return false;
  const vis=i=>lm[i]&&(lm[i].visibility===undefined||lm[i].visibility>0.5);
  if(!(vis(11)&&vis(12)&&vis(15)&&vis(16))) return false;
  const shY=(lm[11].y+lm[12].y)/2, shW=Math.abs(lm[11].x-lm[12].x)+1e-6;
  const span=Math.abs(lm[15].x-lm[16].x); if(span<shW*2.2) return false;
  const tol=shW*0.9; return Math.abs(lm[15].y-shY)<tol && Math.abs(lm[16].y-shY)<tol; }
function detectorFor(screen){ if(screen==='ready') return 'hands';
  if(screen==='calib'||screen==='play'||screen==='over') return 'pose'; return null; }
function mkHand(spec){ const h=Array.from({length:21},()=>({x:0.5,y:0.5})); for(const k in spec) h[k]=spec[k]; return h; }
function mkBody(spec){ const lm=Array.from({length:33},()=>({x:0.5,y:0.5,visibility:1})); for(const k in spec) lm[k]={x:spec[k][0],y:spec[k][1],visibility:1}; return lm; }

let pass=0,fail=0;
const ok=(n,c,d)=>{ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+'  — '+d)); };
console.log('Body Dash — control logic\n');

// ---- lane selection ----
ok('far left x -> lane 0', pickLane(0.1,1)===0);
ok('centre x -> lane 1', pickLane(0.5,0)===1);
ok('far right x -> lane 2', pickLane(0.9,1)===2);
ok('near a boundary holds current lane (hysteresis)', pickLane(1/3+0.01,0)===0 && pickLane(1/3+0.01,1)===1,
   'boundary should not force a switch');
ok('crossing well past boundary does switch', pickLane(0.26,1)===0);
// no oscillation: sitting just inside the dead-zone never flips back and forth
let cur=1, flips=0;
for(const x of [0.34,0.36,0.34,0.36,0.34]){ const nl=pickLane(x,cur); if(nl!==cur) flips++; cur=nl; }
ok('jitter near boundary produces no lane flips', flips===0, 'flips='+flips);

// ---- self-centred (offset) lane picker: the SYMMETRY fix ----
// left and right require the exact same-sized step from your neutral centre,
// regardless of where "neutral" actually is.
ok('offset: step left triggers lane 0', pickLaneOffset(-0.12,1)===0);
ok('offset: step right triggers lane 2', pickLaneOffset(0.12,1)===2);
ok('offset: left and right are symmetric', pickLaneOffset(-0.12,1)===0 && pickLaneOffset(0.12,1)===2);
ok('offset: small drift holds centre', pickLaneOffset(-0.05,1)===1 && pickLaneOffset(0.05,1)===1);
ok('offset: returning past hysteresis re-centres', pickLaneOffset(-0.05,0)===1);
ok('offset: still-out-there holds the side lane (hysteresis)', pickLaneOffset(-0.09,0)===0);
// a right-of-camera neutral (baseX=0.62) must reach LEFT with the same step as right
const baseX=0.62, st=0.11;
ok('offset fix: left reachable even when standing right-of-centre',
   pickLaneOffset((0.50)-baseX, 1, st)===0, 'off='+((0.50)-baseX).toFixed(3));
ok('offset fix: right reachable from the same neutral',
   pickLaneOffset((0.74)-baseX, 1, st)===2, 'off='+((0.74)-baseX).toFixed(3));
// left<->right passes through centre continuously (no impossible double-step)
ok('moving right from the left lane crosses centre then right',
   pickLaneOffset(-0.02, 0, st)===1 && pickLaneOffset(0.12, 1, st)===2);

// ---- lane step scales with body size (distance invariance), clamped ----
ok('step scales up when close (wide shoulders)', laneStep(0.30) > laneStep(0.12));
ok('step clamped to a sane minimum when far', laneStep(0.02)===0.05);
ok('step clamped to a sane maximum when very close', laneStep(0.5)===0.13);

// ---- jump threshold adapts to distance (torso size) ----
ok('threshold clamps low when very close (big torso)', jumpThreshold(0.6)===0.13);
ok('threshold clamps high-floor when far (tiny torso)', jumpThreshold(0.05)===0.045);
ok('threshold scales in-between', Math.abs(jumpThreshold(0.25)-0.085)<1e-9);

// ---- jump trigger ----
const torso=0.25; // th = 0.085
ok('rising body above threshold triggers jump', isJumpTrigger(0.40,0.46,0.50,torso), 'should fire');
ok('small bob below threshold does NOT trigger', !isJumpTrigger(0.47,0.49,0.50,torso));
ok('body moving DOWN never triggers (even if below baseline)', !isJumpTrigger(0.40,0.34,0.50,torso));
ok('standing still does not trigger', !isJumpTrigger(0.50,0.50,0.50,torso));

// ---- calibrated (personalised) threshold override ----
// a big demonstrated jump -> higher threshold -> a small hop no longer fires
ok('override: a rise that fires by default is IGNORED under a bigger calibrated threshold',
   isJumpTrigger(0.40,0.46,0.50,torso) && !isJumpTrigger(0.40,0.46,0.50,torso,0.15));
ok('override: a small hop DOES fire under a small calibrated threshold',
   !isJumpTrigger(0.47,0.49,0.50,torso) && isJumpTrigger(0.47,0.49,0.50,torso,0.02));
ok('override: duck uses the calibrated threshold too',
   !isDuckTrigger(0.53,0.51,0.50,torso) && isDuckTrigger(0.53,0.51,0.50,torso,0.02));

// ---- running level ----
ok('no leg motion -> 0 boost', runningLevel(0,0.25)===0);
ok('strong leg motion -> capped at 1', runningLevel(1.0,0.25)===1);
ok('moderate motion -> partial boost', runningLevel(0.11,0.25)>0.4 && runningLevel(0.11,0.25)<0.6,
   'got '+runningLevel(0.11,0.25));

// ---- ✌️ victory / peace sign detector ----
const VICTORY=mkHand({ 0:{x:0.5,y:0.9}, 9:{x:0.5,y:0.58},
  5:{x:0.44,y:0.6}, 6:{x:0.42,y:0.5}, 8:{x:0.40,y:0.35},   // index up + out
  10:{x:0.5,y:0.48}, 12:{x:0.5,y:0.33},                    // middle up
  14:{x:0.55,y:0.6}, 16:{x:0.55,y:0.64},                   // ring folded
  18:{x:0.6,y:0.62}, 20:{x:0.6,y:0.66} });                 // pinky folded
const FIST=mkHand({ 0:{x:0.5,y:0.9}, 9:{x:0.5,y:0.58},
  6:{x:0.44,y:0.55},8:{x:0.44,y:0.6}, 10:{x:0.5,y:0.55},12:{x:0.5,y:0.6},
  14:{x:0.55,y:0.55},16:{x:0.55,y:0.6}, 18:{x:0.6,y:0.55},20:{x:0.6,y:0.6} });
const OPEN=mkHand({ 0:{x:0.5,y:0.9}, 9:{x:0.5,y:0.58},
  6:{x:0.44,y:0.5},8:{x:0.42,y:0.35}, 10:{x:0.5,y:0.48},12:{x:0.5,y:0.33},
  14:{x:0.55,y:0.48},16:{x:0.56,y:0.33}, 18:{x:0.6,y:0.5},20:{x:0.62,y:0.36} });
const TOGETHER=mkHand({ 0:{x:0.5,y:0.9}, 9:{x:0.5,y:0.58},
  6:{x:0.49,y:0.5},8:{x:0.49,y:0.35}, 10:{x:0.51,y:0.48},12:{x:0.51,y:0.33},
  14:{x:0.55,y:0.6},16:{x:0.55,y:0.64}, 18:{x:0.6,y:0.62},20:{x:0.6,y:0.66} });
ok('✌️ peace sign is recognised', isVictory(VICTORY)===true);
ok('fist is NOT a peace sign', isVictory(FIST)===false);
ok('open palm is NOT a peace sign', isVictory(OPEN)===false);
ok('two fingers held together is NOT a peace sign', isVictory(TOGETHER)===false);
ok('no hand -> not a peace sign', isVictory(null)===false && isVictory([])===false);

// ---- duck / slide trigger (mirror of jump) ----
const T2=0.25; // threshold 0.085
ok('dropping below baseline triggers a duck', isDuckTrigger(0.62,0.55,0.50,T2)===true);
ok('rising body never triggers a duck', isDuckTrigger(0.40,0.46,0.50,T2)===false);
ok('a small dip does not trigger a duck', isDuckTrigger(0.55,0.53,0.50,T2)===false);

// ---- 👊 punch (fast wrist jab raised to chest height) ----
const shY=0.30, PT=0.25;   // shoulder at y=0.30, torso 0.25 -> raised if wrist.y < 0.3875
ok('a fast raised jab is a punch',
   isPunch({x:0.55,y:0.30},{x:0.35,y:0.30},shY,PT)===true);
ok('a slow raised hand is NOT a punch',
   isPunch({x:0.53,y:0.30},{x:0.50,y:0.30},shY,PT)===false);
ok('a fast swing DOWN at hip height (running) is NOT a punch',
   isPunch({x:0.60,y:0.55},{x:0.45,y:0.55},shY,PT)===false);
ok('an upward jab counts (still raised & fast)',
   isPunch({x:0.50,y:0.20},{x:0.50,y:0.40},shY,PT)===true);
ok('punch is distance-invariant (small far body, scaled speed)',
   isPunch({x:0.52,y:0.42},{x:0.44,y:0.42},0.40,0.12)===true, 'far jab should scale');
ok('no wrist / no previous / zero torso -> not a punch',
   isPunch(null,{x:0.5,y:0.3},shY,PT)===false &&
   isPunch({x:0.5,y:0.3},null,shY,PT)===false &&
   isPunch({x:0.55,y:0.30},{x:0.35,y:0.30},shY,0)===false);

// ---- 🧍 T-pose (both arms out at shoulder height, wide) ----
const T_POSE=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.15,0.4],16:[0.85,0.4]});
const ARMS_DOWN=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.4,0.85],16:[0.6,0.85]});
const ARMS_NARROW=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.45,0.4],16:[0.55,0.4]});
const ARMS_UP=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.2,0.1],16:[0.8,0.1]});
ok('arms out at shoulder height is a T-pose', isTpose(T_POSE)===true);
ok('arms down is NOT a T-pose', isTpose(ARMS_DOWN)===false);
ok('arms tucked in (narrow) is NOT a T-pose', isTpose(ARMS_NARROW)===false);
ok('arms raised up (not level) is NOT a T-pose', isTpose(ARMS_UP)===false);

// ---- detector routing (the 'calib' regression: it must run the body Pose) ----
ok('lobby runs the Hands model (for ✌️)', detectorFor('ready')==='hands');
ok('calibration runs the Pose model (else "stand still" hangs)', detectorFor('calib')==='pose');
ok('play runs the Pose model', detectorFor('play')==='pose');
ok('game-over runs the Pose model (for the T-pose restart)', detectorFor('over')==='pose');
ok('start screen runs no detector', detectorFor('start')===null);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
