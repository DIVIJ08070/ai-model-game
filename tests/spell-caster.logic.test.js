/* Spell Caster — pure control-math + glyph recognizer, mirrored VERBATIM from the Engine <script>
   in spell-caster.html (same convention as tests/sky-dash.logic.test.js mirrors sky-dash.html).
   Run: node tests/spell-caster.logic.test.js */

/* ---- helpers + tuning consts (mirrored VERBATIM) ---- */
var clamp=function(v,a,b){ return v<a?a:(v>b?b:v); };
var lerp=function(a,b,t){ return a+(b-a)*t; };
var LEAN_STEP=0.22, LEAN_HYST=0.08, LEAN_EMA=0.4, DUCK_DROP=0.09, INDEX_EXT=0.05,
    PINCH_TH=0.35, STROKE_MIN_PTS=8, STROKE_MIN_LEN=0.5, CORNER_ANGLE=1.0, GESTURE_HOLD=0.6, EPS=1e-6;

/* ---- pure functions (copied VERBATIM from the Engine) ---- */
function leanOffset(lm, center){
  if(!lm || !lm[11] || !lm[12] || !lm[23] || !lm[24]) return 0;
  var shMidX=(lm[11].x+lm[12].x)/2;
  var hipMidX=(lm[23].x+lm[24].x)/2;
  var shoulderW=Math.max(EPS, Math.abs(lm[11].x-lm[12].x));
  var raw=(shMidX-hipMidX)/shoulderW;
  var mirrored=-raw;
  return mirrored-(center||0);
}
function pickDodge(lean, cur, step, hyst){
  step=(step==null)?LEAN_STEP:step; hyst=(hyst==null)?LEAN_HYST:hyst;
  if(lean<=-step) return -1;
  if(lean>=step) return 1;
  if(lean>-(step-hyst) && lean<(step-hyst)) return 0;
  return cur;
}
function isDuck(lm, standingY, th){
  if(!lm || !lm[11] || !lm[12]) return false;
  var shY=(lm[11].y+lm[12].y)/2;
  th=(th==null)?DUCK_DROP:th;
  return (shY-standingY)>th;
}
function isIndexExtended(hand){
  if(!hand || hand.length<9) return false;
  return (hand[6].y-hand[8].y)>INDEX_EXT;
}
function isPinch(hand, th){
  if(!hand || hand.length<9) return false;
  var handSize=Math.hypot(hand[0].x-hand[9].x, hand[0].y-hand[9].y)+EPS;
  var d=Math.hypot(hand[4].x-hand[8].x, hand[4].y-hand[8].y);
  th=(th==null)?PINCH_TH:th;
  return d/handSize<th;
}
function resampleStroke(points, count){
  if(points.length<2) return points.slice();
  var pts=points.slice(), total=0, i;
  for(i=1;i<pts.length;i++) total+=Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y);
  if(total<EPS){ var flat=[]; for(i=0;i<count;i++) flat.push({x:pts[0].x,y:pts[0].y}); return flat; }
  var interval=total/(count-1);
  var out=[{x:pts[0].x,y:pts[0].y}], D=0;
  i=1;
  while(i<pts.length){
    var p1=pts[i-1], p2=pts[i];
    var d=Math.hypot(p2.x-p1.x, p2.y-p1.y);
    if(D+d>=interval && d>EPS){
      var t=(interval-D)/d;
      var np={x:p1.x+t*(p2.x-p1.x), y:p1.y+t*(p2.y-p1.y)};
      out.push(np); pts.splice(i,0,np); D=0;
    } else { D+=d; }
    i++;
  }
  while(out.length<count) out.push({x:pts[pts.length-1].x, y:pts[pts.length-1].y});
  if(out.length>count) out=out.slice(0,count);
  return out;
}
function normalizeStroke(points){
  var n=points.length, i, minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
  for(i=0;i<n;i++){ var p=points[i];
    if(p.x<minx)minx=p.x; if(p.y<miny)miny=p.y; if(p.x>maxx)maxx=p.x; if(p.y>maxy)maxy=p.y; }
  var w=maxx-minx, h=maxy-miny, scale=Math.max(w,h,EPS), norm=[];
  for(i=0;i<n;i++) norm.push({x:(points[i].x-minx)/scale, y:(points[i].y-miny)/scale});
  return { pts:resampleStroke(norm,24), w:w, h:h };
}
function strokeFeatures(pts){
  var n=pts.length, i, pathLen=0;
  for(i=1;i<n;i++) pathLen+=Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y);
  var endDist=Math.hypot(pts[n-1].x-pts[0].x, pts[n-1].y-pts[0].y);
  var straightness=endDist/Math.max(EPS,pathLen);
  var netTurn=0, absTurn=0, corners=0, reversals=0, lastSharp=0;
  for(i=1;i<n-1;i++){
    var ax=pts[i].x-pts[i-1].x, ay=pts[i].y-pts[i-1].y;
    var bx=pts[i+1].x-pts[i].x, by=pts[i+1].y-pts[i].y;
    if(Math.hypot(ax,ay)<EPS || Math.hypot(bx,by)<EPS) continue;
    var ang=Math.atan2(ax*by-ay*bx, ax*bx+ay*by);
    netTurn+=ang; absTurn+=Math.abs(ang);
    if(Math.abs(ang)>CORNER_ANGLE){ corners++; var s=ang>0?1:-1;
      if(lastSharp!==0 && s!==lastSharp) reversals++; lastSharp=s; }
  }
  return { pathLen:pathLen, endDist:endDist, straightness:straightness,
    netTurn:netTurn, absTurn:absTurn, corners:corners, reversals:reversals };
}
function recognizeGlyph(points){
  if(!points || points.length<STROKE_MIN_PTS) return null;
  var ns=normalizeStroke(points);
  var f=strokeFeatures(ns.pts);
  if(f.pathLen<STROKE_MIN_LEN) return null;
  var closed=(f.endDist < 0.30*f.pathLen);
  if(f.straightness>0.80 && f.corners<=1) return 'bolt';
  if(closed){
    if(f.corners>=2 && f.corners<=6 && Math.abs(f.netTurn)>3.5 && f.absTurn<12) return 'fireball';
    if(f.corners<=1 && Math.abs(f.netTurn)>4.5) return 'shield';
    return null;
  }
  if(f.corners>=1 && f.absTurn>=1.2 && f.absTurn<10 && f.straightness<0.80) return 'lightning';
  return null;
}
function isTpose(lm){ if(!lm) return false;
  var vis=function(i){ return lm[i]&&(lm[i].visibility===undefined||lm[i].visibility>0.5); };
  if(!(vis(11)&&vis(12)&&vis(15)&&vis(16))) return false;
  var shY=(lm[11].y+lm[12].y)/2, shW=Math.abs(lm[11].x-lm[12].x)+1e-6, span=Math.abs(lm[15].x-lm[16].x);
  if(span<shW*2.2) return false; var tol=shW*0.9;
  return Math.abs(lm[15].y-shY)<tol && Math.abs(lm[16].y-shY)<tol; }
function detectorFor(screen, frame){
  if(screen==='ready' || screen==='calib' || screen==='over') return 'pose';
  if(screen==='play' || screen==='tutorial') return ((frame||0)%2===0)?'pose':'hands';
  return null;
}

/* ---- fixture builders ---- */
function mkBody(spec){ var lm=Array.from({length:33},function(){ return {x:0.5,y:0.5,visibility:1}; });
  for(var k in spec) lm[k]={x:spec[k][0],y:spec[k][1],visibility:1}; return lm; }
function mkHand(spec){ var h=Array.from({length:21},function(){ return {x:0.5,y:0.5}; });
  for(var k in spec) h[k]={x:spec[k][0],y:spec[k][1]}; return h; }
function seg(a,b,n){ var out=[]; for(var i=0;i<n;i++){ var t=i/(n-1); out.push({x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t}); } return out; }
function poly(verts, perSeg){ var out=[]; for(var i=0;i<verts.length-1;i++){ var s=seg(verts[i],verts[i+1],perSeg); if(i>0) s.shift(); out=out.concat(s); } return out; }
function circlePts(cw){ var out=[],N=22; for(var i=0;i<N;i++){ var a=(cw?1:-1)*(i/(N-1))*2*Math.PI; out.push({x:0.5+0.35*Math.cos(a), y:0.5+0.35*Math.sin(a)}); } return out; }
function scribblePts(){ var out=[],x=0.5,y=0.5,seed=12345;
  function rnd(){ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }
  for(var i=0;i<40;i++){ x+=(rnd()-0.5)*0.4; y+=(rnd()-0.5)*0.4; x=Math.max(0,Math.min(1,x)); y=Math.max(0,Math.min(1,y)); out.push({x:x,y:y}); }
  return out; }

var LINE=seg({x:0.2,y:0.8},{x:0.8,y:0.2},12);
var LINE2=seg({x:0.15,y:0.15},{x:0.85,y:0.85},10);
var TRIANGLE=poly([{x:0.5,y:0.12},{x:0.86,y:0.82},{x:0.14,y:0.82},{x:0.5,y:0.12}],6);
var CIRCLE_CW=circlePts(true), CIRCLE_CCW=circlePts(false);
var ZIGZAG=poly([{x:0.15,y:0.25},{x:0.42,y:0.7},{x:0.58,y:0.3},{x:0.85,y:0.75}],5);
var VSHAPE=poly([{x:0.2,y:0.2},{x:0.5,y:0.85},{x:0.8,y:0.2}],7);
var SCRIBBLE=scribblePts();

let pass=0,fail=0;
const ok=(n,c,d)=>{ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+'  — '+(d||''))); };
console.log('Spell Caster — control logic + glyph recognizer\n');

/* ---- 🧍➡ leanOffset (mirrored, +right, size-normalized) ---- */
const NEUTRAL=mkBody({11:[0.44,0.40],12:[0.56,0.40],23:[0.45,0.62],24:[0.55,0.62]});
const LEAN_R =mkBody({11:[0.38,0.40],12:[0.50,0.40],23:[0.45,0.62],24:[0.55,0.62]});   // shoulders shifted image-left = lean player-RIGHT
const LEAN_L =mkBody({11:[0.50,0.40],12:[0.62,0.40],23:[0.45,0.62],24:[0.55,0.62]});
ok('upright/neutral torso → ~0 lean', Math.abs(leanOffset(NEUTRAL,0))<1e-9);
ok('lean to the player right → POSITIVE', leanOffset(LEAN_R,0)>0.2, 'got '+leanOffset(LEAN_R,0).toFixed(3));
ok('lean to the player left → NEGATIVE', leanOffset(LEAN_L,0)<-0.2, 'got '+leanOffset(LEAN_L,0).toFixed(3));
ok('lean is mirror-symmetric', Math.abs(leanOffset(LEAN_R,0)+leanOffset(LEAN_L,0))<1e-9);
ok('calibration center subtracts a resting bias', Math.abs(leanOffset(LEAN_R,0.5)-(leanOffset(LEAN_R,0)-0.5))<1e-9);
ok('missing hips/shoulders → 0', leanOffset([],0)===0 && leanOffset(null,0)===0);

/* ---- ⇆ pickDodge (dead-zone + hysteresis, symmetric) ---- */
ok('inside the dead-zone → centre 0', pickDodge(0,1)===0 && pickDodge(0.05,1)===0);
ok('lean ≥ LEAN_STEP → slot +1', pickDodge(LEAN_STEP,0)===1 && pickDodge(0.5,0)===1);
ok('lean ≤ -LEAN_STEP → slot -1', pickDodge(-LEAN_STEP,0)===-1 && pickDodge(-0.5,0)===-1);
ok('inside the hysteresis band holds cur', pickDodge(0.18,1)===1 && pickDodge(-0.18,-1)===-1);
ok('pickDodge is symmetric', pickDodge(0.3,0)=== -pickDodge(-0.3,0));
ok('custom step/hyst respected', pickDodge(0.3,0,0.4,0.1)===0 && pickDodge(0.45,0,0.4,0.1)===1);

/* ---- 🧎 isDuck (shoulders drop below standing height) ---- */
const STAND=mkBody({11:[0.44,0.40],12:[0.56,0.40]});
const CROUCH=mkBody({11:[0.44,0.55],12:[0.56,0.55]});
ok('at standing height → not ducking', isDuck(STAND,0.40)===false);
ok('shoulders dropped > DUCK_DROP → ducking', isDuck(CROUCH,0.40)===true);
ok('a shallow drop inside the dead-zone → not ducking', isDuck(mkBody({11:[0.44,0.44],12:[0.56,0.44]}),0.40)===false);
ok('custom threshold respected', isDuck(CROUCH,0.40,0.2)===false && isDuck(CROUCH,0.40,0.1)===true);
ok('missing shoulders → false', isDuck(null,0.4)===false && isDuck([],0.4)===false);

/* ---- ☝ isIndexExtended (index tip above its PIP) ---- */
const IDX_UP=mkHand({6:[0.5,0.7],8:[0.5,0.4]});     // tip 8 above PIP 6 (smaller y)
const IDX_CURL=mkHand({6:[0.5,0.4],8:[0.5,0.5]});   // tip below PIP
ok('index pointed up → extended', isIndexExtended(IDX_UP)===true);
ok('index curled/down → not extended', isIndexExtended(IDX_CURL)===false);
ok('short/empty hand → not extended', isIndexExtended([{x:0,y:0}])===false && isIndexExtended(null)===false);

/* ---- 🤏 isPinch (thumb↔index, hand-size normalized) ---- */
const PINCH=mkHand({0:[0.5,0.9],9:[0.5,0.5],4:[0.5,0.42],8:[0.52,0.44]});   // thumb+index tips together
const OPEN =mkHand({0:[0.5,0.9],9:[0.5,0.5],4:[0.3,0.4],8:[0.7,0.4]});      // tips far apart
ok('thumb + index tips together → pinch', isPinch(PINCH)===true);
ok('tips apart → not a pinch', isPinch(OPEN)===false);
ok('pinch is hand-size normalized (custom th)', isPinch(OPEN,2.0)===true && isPinch(PINCH,0.01)===false);
ok('short/empty hand → not a pinch', isPinch([{x:0,y:0}])===false && isPinch(null)===false);

/* ---- ✨ recognizeGlyph — the STAR (fixtures are the contract, §10.1) ---- */
ok('a straight line → bolt', recognizeGlyph(LINE)==='bolt' && recognizeGlyph(LINE2)==='bolt');
ok('a triangle → fireball', recognizeGlyph(TRIANGLE)==='fireball', 'got '+recognizeGlyph(TRIANGLE));
ok('a circle → shield', recognizeGlyph(CIRCLE_CW)==='shield', 'got '+recognizeGlyph(CIRCLE_CW));
ok('clockwise AND counter-clockwise circles BOTH → shield (direction-agnostic)',
   recognizeGlyph(CIRCLE_CW)==='shield' && recognizeGlyph(CIRCLE_CCW)==='shield');
ok('a zigzag → lightning', recognizeGlyph(ZIGZAG)==='lightning', 'got '+recognizeGlyph(ZIGZAG));
ok('a V → lightning', recognizeGlyph(VSHAPE)==='lightning', 'got '+recognizeGlyph(VSHAPE));
ok('a scribble → null (fizzle)', recognizeGlyph(SCRIBBLE)===null, 'got '+recognizeGlyph(SCRIBBLE));
ok('[] / null / too-few points → null',
   recognizeGlyph([])===null && recognizeGlyph(null)===null && recognizeGlyph([{x:0,y:0},{x:1,y:1}])===null);

/* ---- 🧍 isTpose (the four canonical cases) ---- */
const T_POSE=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.15,0.4],16:[0.85,0.4]});
const ARMS_DOWN=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.4,0.85],16:[0.6,0.85]});
const ARMS_NARROW=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.45,0.4],16:[0.55,0.4]});
const ARMS_UP=mkBody({11:[0.42,0.4],12:[0.58,0.4],15:[0.2,0.1],16:[0.8,0.1]});
ok('arms out level → T-pose', isTpose(T_POSE)===true);
ok('arms down → NOT a T-pose', isTpose(ARMS_DOWN)===false);
ok('arms narrow → NOT a T-pose', isTpose(ARMS_NARROW)===false);
ok('arms up (not level) → NOT a T-pose', isTpose(ARMS_UP)===false);
ok('null / [] → NOT a T-pose', isTpose(null)===false && isTpose([])===false);

/* ---- 🎥 detectorFor (dual-pump routing parity) ---- */
ok('ready / calib / over → pose', detectorFor('ready')==='pose' && detectorFor('calib')==='pose' && detectorFor('over')==='pose');
ok('play even frame → pose, odd frame → hands', detectorFor('play',0)==='pose' && detectorFor('play',1)==='hands' && detectorFor('play',2)==='pose');
ok('tutorial alternates pose/hands (dodge + draw drills)', detectorFor('tutorial',0)==='pose' && detectorFor('tutorial',1)==='hands');
ok('unknown screen → null', detectorFor('boot',0)===null);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
