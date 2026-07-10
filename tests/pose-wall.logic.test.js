/* Pose Wall — pure pose-match math, mirrored VERBATIM from the Engine <script> in pose-wall.html
   (same convention as tests/sky-dash.logic.test.js mirrors sky-dash.html). SPEC §5 / §6 / §11.1.
   Run: node tests/pose-wall.logic.test.js */

/* ---- helpers ---- */
var clamp=function(v,a,b){ return v<a?a:(v>b?b:v); };

/* ---- 5.1 tuning constants (mirrored verbatim) ---- */
var PASS_THRESHOLD = 0.72;
var ANGLE_DEADZONE = 0.14;
var ARM_W   = 1.0;
var TORSO_W = 0.6;
var LEG_W   = 0.4;
var WALLS_PER_LEVEL = 3;
var MAX_LEVEL = 8;
var WALL_BASE = 8, WALL_STEP = 1.5, WALL_MAX = 24;
var VIS_MIN = 0.5;
var EPS = 1e-6;

/* ---- pure functions (copied verbatim from the Engine) ---- */
function mid(a,b){ return { x:(a.x+b.x)/2, y:(a.y+b.y)/2 }; }
function dist(a,b){ var dx=a.x-b.x, dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy); }
function visOK(lm,i){ return !!(lm && lm[i] && (lm[i].visibility===undefined || lm[i].visibility>=VIS_MIN)); }
function normalizePose(lm){
  if(!lm||!lm[23]||!lm[24]||!lm[11]||!lm[12]) return [];
  var midHipX=(lm[23].x+lm[24].x)/2, midHipY=(lm[23].y+lm[24].y)/2;
  var sw=Math.max(EPS, dist(lm[11],lm[12]));
  return lm.map(function(p){ if(!p) return {x:0,y:0}; return { x:(p.x-midHipX)/sw, y:(p.y-midHipY)/sw }; });
}
function limbAngle(a,b){ return Math.atan2(b.y-a.y, b.x-a.x); }
function angleDiff(a,b){ var d=a-b; while(d>Math.PI) d-=2*Math.PI; while(d<-Math.PI) d+=2*Math.PI; return d; }
function limbSimilarity(playerAngle, targetAngle, deadzone){
  if(deadzone==null) deadzone=ANGLE_DEADZONE;
  var d=Math.abs(angleDiff(playerAngle,targetAngle));
  var eff=Math.max(0, d-deadzone);
  return 1 - Math.min(eff,Math.PI)/Math.PI;
}
var CORE_KEYS = ['luArm','lfArm','ruArm','rfArm','torso'];
var LEG_KEYS  = ['lThigh','lShin','rThigh','rShin'];
var LIMB_W = { luArm:ARM_W, lfArm:ARM_W, ruArm:ARM_W, rfArm:ARM_W, torso:TORSO_W,
               lThigh:LEG_W, lShin:LEG_W, rThigh:LEG_W, rShin:LEG_W };
var LEG_LMS = { lThigh:[23,25], lShin:[25,27], rThigh:[24,26], rShin:[26,28] };
function limbEndpoints(lm,k){
  switch(k){
    case 'luArm': return [lm[11],lm[13]];
    case 'lfArm': return [lm[13],lm[15]];
    case 'ruArm': return [lm[12],lm[14]];
    case 'rfArm': return [lm[14],lm[16]];
    case 'torso': return [mid(lm[23],lm[24]), mid(lm[11],lm[12])];
    case 'lThigh': return [lm[23],lm[25]];
    case 'lShin':  return [lm[25],lm[27]];
    case 'rThigh': return [lm[24],lm[26]];
    case 'rShin':  return [lm[26],lm[28]];
  }
  return null;
}
function limbAngleFor(lm,k){ var e=limbEndpoints(lm,k); return (e&&e[0]&&e[1])?limbAngle(e[0],e[1]):0; }
function poseTarget(lm){
  var limbs={}, weights={};
  for(var i=0;i<CORE_KEYS.length;i++){ var k=CORE_KEYS[i]; limbs[k]=limbAngleFor(lm,k); weights[k]=LIMB_W[k]; }
  var hasLegs = visOK(lm,25)&&visOK(lm,26)&&visOK(lm,27)&&visOK(lm,28);
  if(hasLegs){ for(var j=0;j<LEG_KEYS.length;j++){ var lk=LEG_KEYS[j]; limbs[lk]=limbAngleFor(lm,lk); weights[lk]=LIMB_W[lk]; } }
  return { limbs:limbs, weights:weights, hasLegs:hasLegs };
}
function poseMatchScore(lm, target, opts){
  var wsum=0, wtot=0;
  for(var k in target.limbs){
    if(LEG_KEYS.indexOf(k)>=0){
      if(!target.hasLegs) continue;
      var idx=LEG_LMS[k];
      if(!(visOK(lm,idx[0])&&visOK(lm,idx[1]))) continue;
    }
    var pa=limbAngleFor(lm,k), w=target.weights[k];
    wsum += w*limbSimilarity(pa, target.limbs[k]);
    wtot += w;
  }
  return wtot>0 ? wsum/wtot : 0;
}
function passesWall(score, thr){ if(thr==null) thr=PASS_THRESHOLD; return score >= thr; }
function isTpose(lm){ if(!lm) return false;
  var vis=function(i){ return lm[i]&&(lm[i].visibility===undefined||lm[i].visibility>0.5); };
  if(!(vis(11)&&vis(12)&&vis(15)&&vis(16))) return false;
  var shY=(lm[11].y+lm[12].y)/2, shW=Math.abs(lm[11].x-lm[12].x)+1e-6, span=Math.abs(lm[15].x-lm[16].x);
  if(span<shW*2.2) return false; var tol=shW*0.9;
  return Math.abs(lm[15].y-shY)<tol && Math.abs(lm[16].y-shY)<tol; }
function levelForScore(score){ return 1 + Math.floor(score/WALLS_PER_LEVEL); }
function maxTierForLevel(level){ return level<2 ? 1 : (level<4 ? 2 : 3); }
function wallSpeed(level){ return clamp(WALL_BASE + (level-1)*WALL_STEP, WALL_BASE, WALL_MAX); }
function poseDifficulty(level){ return clamp((level-1)/(MAX_LEVEL-1), 0, 1); }
function pickPose(index, level){
  if(index===0){ for(var i=0;i<POSE_LIBRARY.length;i++){ if(POSE_LIBRARY[i].id==='ARMS_UP') return POSE_LIBRARY[i]; } }
  var pool=POSE_LIBRARY.filter(function(p){ return p.tier<=maxTierForLevel(level); });
  return pool[(index*7 + 3*level) % pool.length];
}

/* ---- 6. pose library (copied verbatim from the Engine) ---- */
function mkBody(spec){
  var lm=[]; for(var i=0;i<33;i++) lm[i]={x:0.5,y:0.5,visibility:1};
  for(var k in spec){ var s=spec[k]; lm[k]={ x:s[0], y:s[1], visibility:(s.length>2?s[2]:1) }; }
  return lm;
}
var NEUTRAL_SPEC = {
  0:[0.50,0.18],
  11:[0.42,0.30], 12:[0.58,0.30],
  13:[0.40,0.42], 14:[0.60,0.42],
  15:[0.40,0.54], 16:[0.60,0.54],
  23:[0.45,0.55], 24:[0.55,0.55],
  25:[0.45,0.72,0.2], 26:[0.55,0.72,0.2], 27:[0.45,0.88,0.2], 28:[0.55,0.88,0.2]
};
function poseSpec(ov){ var s={}; for(var k in NEUTRAL_SPEC) s[k]=NEUTRAL_SPEC[k]; for(var k2 in ov) s[k2]=ov[k2]; return s; }
var POSE_DEFS = [
  ['ARMS_UP','ARMS UP',1,{ 13:[0.42,0.18], 15:[0.42,0.06], 14:[0.58,0.18], 16:[0.58,0.06] }],
  ['STAR','STAR',1,{ 13:[0.34,0.22], 15:[0.26,0.14], 14:[0.66,0.22], 16:[0.74,0.14],
      25:[0.38,0.72,1], 27:[0.32,0.88,1], 26:[0.62,0.72,1], 28:[0.68,0.88,1] }],
  ['LEFT_UP_RIGHT_DOWN','LEFT UP',2,{ 13:[0.42,0.18], 15:[0.42,0.06], 14:[0.60,0.42], 16:[0.60,0.54] }],
  ['ONE_ARM_OUT','ARM OUT',2,{ 13:[0.40,0.42], 15:[0.40,0.54], 14:[0.70,0.30], 16:[0.82,0.30] }],
  ['ARMS_CROSSED','CROSSED',2,{ 13:[0.38,0.40], 15:[0.58,0.40], 14:[0.62,0.40], 16:[0.42,0.40] }],
  ['LEAN_LEFT','LEAN LEFT',2,{ 11:[0.36,0.32], 12:[0.52,0.30], 13:[0.28,0.38], 15:[0.18,0.42], 14:[0.44,0.38], 16:[0.34,0.42] }],
  ['LEAN_RIGHT','LEAN RIGHT',2,{ 11:[0.48,0.30], 12:[0.64,0.32], 13:[0.56,0.38], 15:[0.66,0.42], 14:[0.72,0.38], 16:[0.82,0.42] }],
  ['HANDS_ON_HIPS','HIPS',3,{ 13:[0.28,0.36], 15:[0.44,0.55], 14:[0.72,0.36], 16:[0.56,0.55] }]
];
var POSE_LIBRARY = POSE_DEFS.map(function(d){
  var lm=mkBody(poseSpec(d[3]));
  return { id:d[0], name:d[1], tier:d[2], lm:lm, target:poseTarget(lm) };
});
function poseById(id){ for(var i=0;i<POSE_LIBRARY.length;i++){ if(POSE_LIBRARY[i].id===id) return POSE_LIBRARY[i]; } return null; }

/* ================================ harness ==================================== */
var pass=0,fail=0;
var ok=function(n,c,d){ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+'  — '+(d||''))); };
console.log('Pose Wall — pose-match logic\n');

// ---- 🎯 self-match: every library pose matches its own target ≈ 1.0 (≥ 0.9) + passesWall ----
POSE_LIBRARY.forEach(function(p){
  var s=poseMatchScore(p.lm, p.target);
  ok(p.id+' self-matches ≥ 0.9', s>=0.9, 'score='+s.toFixed(4));
  ok(p.id+' self-match passes the wall', passesWall(s)===true, 'score='+s.toFixed(4));
});

// ---- ❌ clearly-different poses score LOW (< 0.5) and fail passesWall (Manager Decision #2) ----
var sUpCross = poseMatchScore(poseById('ARMS_UP').lm, poseById('ARMS_CROSSED').target);
ok('ARMS_UP vs ARMS_CROSSED is low (< 0.5)', sUpCross<0.5, 'score='+sUpCross.toFixed(4));
ok('ARMS_UP vs ARMS_CROSSED fails passesWall', passesWall(sUpCross)===false, 'score='+sUpCross.toFixed(4));
var sHipsUp = poseMatchScore(poseById('HANDS_ON_HIPS').lm, poseById('ARMS_UP').target);
ok('HANDS_ON_HIPS vs ARMS_UP is low (< 0.5)', sHipsUp<0.5, 'score='+sHipsUp.toFixed(4));
ok('HANDS_ON_HIPS vs ARMS_UP fails passesWall', passesWall(sHipsUp)===false, 'score='+sHipsUp.toFixed(4));

// ---- ↔ directional: LEAN_LEFT and LEAN_RIGHT are distinguishable (Manager Decision #5) ----
var sLeanLR = poseMatchScore(poseById('LEAN_LEFT').lm, poseById('LEAN_RIGHT').target);
var sLeanRL = poseMatchScore(poseById('LEAN_RIGHT').lm, poseById('LEAN_LEFT').target);
ok('LEAN_LEFT vs LEAN_RIGHT is distinguishable (fails the wall)', passesWall(sLeanLR)===false && sLeanLR<0.6,
   'L→R='+sLeanLR.toFixed(4));
ok('LEAN_RIGHT vs LEAN_LEFT is distinguishable (fails the wall)', passesWall(sLeanRL)===false && sLeanRL<0.6,
   'R→L='+sLeanRL.toFixed(4));

// ---- 📐 normalizePose invariance ----
var body=poseById('ONE_ARM_OUT').lm;
var base=normalizePose(body);
(function(){
  var dx=0.13, dy=-0.27;
  var shifted=body.map(function(p){ return {x:p.x+dx, y:p.y+dy, visibility:p.visibility}; });
  var out=normalizePose(shifted);
  var maxd=0; for(var i=0;i<out.length;i++){ maxd=Math.max(maxd, Math.abs(out[i].x-base[i].x), Math.abs(out[i].y-base[i].y)); }
  ok('normalizePose is translation-invariant (add dx,dy → same output)', maxd<1e-9, 'maxΔ='+maxd);
})();
(function(){
  var k=2.4, mhx=(body[23].x+body[24].x)/2, mhy=(body[23].y+body[24].y)/2;
  var scaled=body.map(function(p){ return { x:mhx+(p.x-mhx)*k, y:mhy+(p.y-mhy)*k, visibility:p.visibility }; });
  var out=normalizePose(scaled);
  var maxd=0; for(var i=0;i<out.length;i++){ maxd=Math.max(maxd, Math.abs(out[i].x-base[i].x), Math.abs(out[i].y-base[i].y)); }
  ok('normalizePose is scale-invariant (scale about mid-hip by k → same output)', maxd<1e-9, 'maxΔ='+maxd);
})();

// ---- 📐 limbAngle values ----
ok('limbAngle horizontal-right ≈ 0', Math.abs(limbAngle({x:0,y:0},{x:1,y:0}))<1e-9);
ok('limbAngle straight-up (b above a) ≈ -π/2', Math.abs(limbAngle({x:0,y:1},{x:0,y:0}) - (-Math.PI/2))<1e-9);
ok('limbAngle horizontal-left ≈ ±π', Math.abs(Math.abs(limbAngle({x:0,y:0},{x:-1,y:0})) - Math.PI)<1e-9);

// ---- 🔀 angleDiff wrap-safety ----
ok('angleDiff is wrap-safe near ±π', Math.abs(Math.abs(angleDiff(3.0,-3.0)) - (2*Math.PI-6.0))<1e-9);
ok('angleDiff of equal angles is 0', angleDiff(1.2,1.2)===0);

// ---- 🧍 isTpose (the four canonical cases from tests/logic.test.js:150-153) ----
function mkT(spec){ var lm=[]; for(var i=0;i<33;i++) lm[i]={x:0.5,y:0.5,visibility:1}; for(var k in spec) lm[k]={x:spec[k][0],y:spec[k][1],visibility:1}; return lm; }
var T_POSE=mkT({11:[0.42,0.4],12:[0.58,0.4],15:[0.15,0.4],16:[0.85,0.4]});
var ARMS_DOWN=mkT({11:[0.42,0.4],12:[0.58,0.4],15:[0.4,0.85],16:[0.6,0.85]});
var ARMS_NARROW=mkT({11:[0.42,0.4],12:[0.58,0.4],15:[0.45,0.4],16:[0.55,0.4]});
var ARMS_HIGH=mkT({11:[0.42,0.4],12:[0.58,0.4],15:[0.2,0.1],16:[0.8,0.1]});
ok('isTpose: arms out at shoulder height is a T-pose', isTpose(T_POSE)===true);
ok('isTpose: arms down is NOT a T-pose', isTpose(ARMS_DOWN)===false);
ok('isTpose: arms tucked in (narrow) is NOT a T-pose', isTpose(ARMS_NARROW)===false);
ok('isTpose: arms raised up (not level) is NOT a T-pose', isTpose(ARMS_HIGH)===false);
ok('isTpose: no landmarks → not a T-pose', isTpose(null)===false && isTpose([])===false);
// none of the library poses is ever a T-pose (they are scored wall poses only)
ok('no library pose is a T-pose', POSE_LIBRARY.every(function(p){ return isTpose(p.lm)===false; }));

// ---- 📈 monotonic difficulty ----
(function(){
  var wsMono=true, wsStrictThenClamp=true, pdMono=true, pdRange=true, lvlMono=true, tierMono=true, prevWs=-1;
  for(var L=1;L<=14;L++){
    var ws=wallSpeed(L), pd=poseDifficulty(L);
    if(L>1 && ws<prevWs-1e-12) wsMono=false;
    if(pd<-1e-12 || pd>1+1e-12) pdRange=false;
    prevWs=ws;
  }
  for(var l=1;l<12;l++){ if(wallSpeed(l+1)<wallSpeed(l)-1e-12) wsMono=false;
    if(poseDifficulty(l+1)<poseDifficulty(l)-1e-12) pdMono=false;
    if(maxTierForLevel(l+1)<maxTierForLevel(l)) tierMono=false; }
  // strictly increasing until the WALL_MAX clamp
  for(var m=1;m<8;m++){ if(!(wallSpeed(m+1)>wallSpeed(m)) && wallSpeed(m)<WALL_MAX-1e-9) wsStrictThenClamp=false; }
  for(var s=0;s<40;s++){ if(levelForScore(s+1)<levelForScore(s)) lvlMono=false; }
  ok('wallSpeed is non-decreasing in level', wsMono);
  ok('wallSpeed strictly increases until it clamps at WALL_MAX', wsStrictThenClamp && wallSpeed(20)===WALL_MAX);
  ok('poseDifficulty is non-decreasing and in [0,1]', pdMono && pdRange && poseDifficulty(1)===0 && poseDifficulty(MAX_LEVEL)===1);
  ok('levelForScore is non-decreasing in score', lvlMono && levelForScore(0)===1 && levelForScore(3)===2);
  ok('maxTierForLevel is non-decreasing', tierMono && maxTierForLevel(1)===1 && maxTierForLevel(2)===2 && maxTierForLevel(4)===3);
})();

// ---- 🎲 pickPose determinism & guards ----
ok('pickPose is deterministic (same index,level → same entry)',
   pickPose(5,3)===pickPose(5,3) && pickPose(9,6)===pickPose(9,6));
ok('pickPose(0, ·) is always the tier-1 ARMS_UP (easy symmetric first wall)',
   pickPose(0,1).id==='ARMS_UP' && pickPose(0,5).id==='ARMS_UP' && pickPose(0,1).tier===1);
ok('at level 1 pickPose only returns tier-1 poses', (function(){
   for(var i=0;i<60;i++){ if(pickPose(i,1).tier!==1) return false; } return true; })());
ok('pickPose never returns a T-pose (T is not in POSE_LIBRARY) and always returns a library entry', (function(){
   var ids=POSE_LIBRARY.map(function(p){return p.id;});
   for(var L=1;L<=9;L++){ for(var i=0;i<50;i++){ var p=pickPose(i,L); if(ids.indexOf(p.id)<0 || isTpose(p.lm)) return false; } } return true; })());
ok('pickPose pool grows with level (tier-3 poses only appear at level ≥ 4)', (function(){
   var seenT3atLow=false, seenT3atHigh=false;
   for(var i=0;i<80;i++){ if(pickPose(i,1).tier===3) seenT3atLow=true; if(pickPose(i,5).tier===3) seenT3atHigh=true; }
   return !seenT3atLow && seenT3atHigh; })());

// ---- ✅ passesWall boundary at 0.72 ----
ok('passesWall: exactly 0.72 passes', passesWall(0.72)===true);
ok('passesWall: 0.719 fails', passesWall(0.719)===false);
ok('passesWall: custom threshold honoured', passesWall(0.6,0.5)===true && passesWall(0.4,0.5)===false);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
