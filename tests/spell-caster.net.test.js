/* Loopback netcode test for Spell Caster's live 1v1 duel (no real WebRTC / no network).
   Extracts the Engine <script> (the /*__SPELL_ENGINE__* / block), runs it in a vm with DOM
   shims, wires a FAKE open DataChannel that captures every netSend(), then drives the duel
   message contract:
     beginDuelMatch → pos/cast apply → dodge vs hit + HP broadcast → opponent HP → my casts
     are relayed (shield stays local) → win via 'end' → lose broadcasts 'end' → ready handshake.
   Any thrown error / console.error, or a failed assertion, fails the run.
   Run: node tests/spell-caster.net.test.js */
const fs=require('fs'), vm=require('vm'), path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','spell-caster.html'),'utf8');
const bodies=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const script=bodies.find(s=>s.includes('/*__SPELL_ENGINE__*/'));
if(!script){ console.error('could not find the /*__SPELL_ENGINE__*/ engine script'); process.exit(1); }

let errors=[], pass=0;
const ok=(n,c,d)=>{ c?pass++:errors.push(n+(d?(' — '+d):'')); };
const rafq=[]; let clock=0;

function ctxStub(){ const noop=()=>{}; const grad={addColorStop:noop};
  return new Proxy({ canvas:{width:1280,height:720}, createLinearGradient:()=>grad, createRadialGradient:()=>grad,
    setTransform:noop, getImageData:()=>({data:new Uint8ClampedArray(4)}) },
    { get(t,k){ return k in t?t[k]:noop; }, set(){return true;} }); }
function el(id){ const h={};
  const e={ id, dataset:{}, style:{}, textContent:'', innerHTML:'', value:'', disabled:false, srcObject:null, readyState:4, width:1280, height:720,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
      toggle(c,on){ if(on===undefined)on=!this._s.has(c); on?this._s.add(c):this._s.delete(c); return on;}, contains(c){return this._s.has(c);} },
    setAttribute(k,v){ this['_'+k]=String(v); }, getAttribute(k){ return this['_'+k]; },
    addEventListener(ev,fn){ (h[ev]=h[ev]||[]).push(fn); }, removeEventListener(){},
    appendChild(){}, getContext(){ return ctxStub(); }, play(){ return Promise.resolve(); },
    getBoundingClientRect(){ return {width:1280,height:720,left:0,top:0,right:1280,bottom:720}; },
    _fire(ev,o){ (h[ev]||[]).forEach(fn=>fn(Object.assign({preventDefault(){},target:e},o))); } };
  return e; }
const cache={}; const byId=id=>cache[id]||(cache[id]=el(id));
const document={ getElementById:byId, createElement:()=>el('new'), head:el('head'), querySelectorAll:()=>[], addEventListener(){}, activeElement:null };
const store={};
const localStorage={ getItem:k=>k in store?store[k]:null, setItem:(k,v)=>{store[k]=String(v);} };
function AudioCtx(){ this.currentTime=0; this.state='running'; this.destination={}; this.resume=()=>{};
  this.createOscillator=()=>({type:'',frequency:{setValueAtTime(){}},connect(){return this;},start(){},stop(){}});
  this.createGain=()=>({gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){return this;}}); }
const win={ innerWidth:1280, innerHeight:720, devicePixelRatio:2, matchMedia:()=>({matches:false}),
  AudioContext:AudioCtx, webkitAudioContext:AudioCtx, requestAnimationFrame:fn=>{ rafq.push(fn); return rafq.length; },
  _h:{}, addEventListener(ev,fn){ (this._h[ev]=this._h[ev]||[]).push(fn); }, removeEventListener(){} };
const sandbox={ window:win, document, localStorage,
  navigator:{ mediaDevices:{ getUserMedia:async()=>({ getTracks:()=>[{stop(){}}] }) } },
  performance:{ now:()=>clock }, requestAnimationFrame:win.requestAnimationFrame,
  setTimeout:()=>0, clearTimeout(){},                        // no-op: never auto-run scheduled callbacks
  console:{ log(){}, warn(){}, error:(...a)=>errors.push('console.error: '+a.join(' ')) },
  Math,Date,JSON,Array,Object,Uint8ClampedArray,parseInt,parseFloat,isNaN,String,Number,Boolean,Promise,Symbol,Infinity };
sandbox.globalThis=sandbox;

try{ vm.createContext(sandbox); vm.runInContext(script,sandbox,{filename:'spell-caster.html'}); }
catch(e){ console.error('boot threw:',e.stack); process.exit(1); }

const S=sandbox.__spell;
if(!S || !S.G){ console.log('RUNTIME ERRORS:\n could not reach engine state (__spell missing)'); process.exit(1); }
const G=S.G;

/* fake open DataChannel — capture every message the Engine ships to the peer */
const SENT=[];
function connectFake(){ G.net.dc={ readyState:'open', send:s=>{ try{ SENT.push(JSON.parse(s)); }catch(e){} } }; G.net.connected=true; }
const sentOf=t=>SENT.filter(m=>m.t===t);
function upd(ms){ clock+=(ms||16); try{ S.update(clock); }catch(e){ errors.push('update: '+(e&&e.stack||e)); } }

(async()=>{
  // 0) graceful degrade — createRoom/joinRoom must not throw when WebRTC is unavailable (this vm)
  try{ await S.createRoom(); }catch(e){ errors.push('createRoom threw without RTCPeerConnection: '+e); }
  ok('createRoom degrades gracefully w/o WebRTC (sets an error, no throw)', !!G.net.error, 'error='+G.net.error);
  G.net.error=''; G.net.state='idle';

  // 1) both sides connected + ready → duel starts
  connectFake();
  S.duelReady();
  ok("readying up ships a 'ready' message", sentOf('ready').length===1);
  ok('meReady set after readying', G.net.meReady===true);
  ok('one ready alone does not start the match', G.screen!=='play');
  S.netApply({ t:'ready' });                                  // opponent readies
  ok('both ready → the duel starts (screen play)', G.screen==='play', 'screen='+G.screen);
  ok("both ready broadcasts a 'start'", sentOf('start').length===1);
  ok('duel mode is active', G.mode==='duel');
  ok('my HP starts full', G.hp===100);
  ok('opponent HP starts full', G.net.oppHp===100);

  // 2) opponent position message → opp mirror updated (drives the View's 2nd mage)
  S.netApply({ t:'pos', x:2, s:1, d:1 });
  ok('pos updates opp x/slot/duck', G.net.opp.x===2 && G.net.opp.slot===1 && G.net.opp.ducking===true);

  // 3) opponent CAST → an incoming projectile spawns for me to dodge (with the right damage)
  const before=G.eProj.length;
  S.netApply({ t:'cast', k:'bolt', slot:0, high:false });
  ok('opponent cast spawns one incoming projectile', G.eProj.length===before+1);
  const inc=G.eProj[G.eProj.length-1];
  ok('incoming carries the spell damage (Bolt=16)', inc.dmg===S.netDmg('bolt') && inc.dmg===16, 'dmg='+inc.dmg);
  ok('shield is never spawned as an incoming attack', (S.netApply({t:'cast',k:'shield'}), G.eProj.length===before+1));

  // 4) DODGE — different slot than the incoming → no damage
  G.control='camera'; G.mage.slot=1; G.mage.ducking=false;    // camera control so stepPlay won't override my slot
  inc.z=0.001; inc.slot=0;
  const hpBeforeDodge=G.hp; upd(16);
  ok('dodging (wrong slot) takes no damage', G.hp===hpBeforeDodge, 'hp='+G.hp);

  // 5) HIT — stand in the incoming's slot → HP drops AND my new HP is broadcast to the peer
  S.netApply({ t:'cast', k:'bolt', slot:0, high:false });
  const p2=G.eProj[G.eProj.length-1]; p2.z=0.001; p2.slot=0; G.mage.slot=0; G.shield=false;
  const hpBeforeHit=G.hp; SENT.length=0; upd(16);
  ok('being hit reduces my HP by the spell damage', G.hp===hpBeforeHit-16, 'hp='+G.hp);
  ok('a hit broadcasts my new HP to the opponent', sentOf('hp').some(m=>m.v===G.hp));

  // 6) opponent HP message → my HUD mirror follows the peer
  S.netApply({ t:'hp', v:40 });
  ok('opponent HP message updates oppHp', G.net.oppHp===40);

  // 7) MY casts are relayed; shield stays local (defensive)
  SENT.length=0;
  const spellsBefore=G.spells.length;
  S.castSpell('bolt');
  ok('casting Bolt in a duel relays it to the opponent', sentOf('cast').some(m=>m.k==='bolt'));
  ok('casting Bolt also shows my own bolt flying', G.spells.length>spellsBefore);
  SENT.length=0;
  S.castSpell('shield');
  ok('Shield raises my local barrier', G.shield===true);
  ok('Shield is NOT sent to the opponent', sentOf('cast').length===0);

  // 8) WIN — the opponent's 'end' (they were defeated) makes me the winner
  S.netApply({ t:'end', l:1 });
  ok("opponent's 'end' → I win", G.outcome==='win' && G.screen==='over', 'outcome='+G.outcome+' screen='+G.screen);

  // 9) LOSE — my HP hitting 0 ends the run AND tells the opponent they won
  S.beginDuelMatch();
  ok('a fresh duel can start after a result', G.screen==='play' && G.mode==='duel');
  G.control='camera'; G.mage.slot=0; G.shield=false;
  G.eProj.push({ x:0, z:0.001, slot:0, high:false, dmg:100, dead:false });
  SENT.length=0; upd(16);
  ok('HP reaching 0 ends the duel (I lose)', G.screen==='over' && G.outcome==='over', 'outcome='+G.outcome);
  ok("losing broadcasts 'end' so the opponent wins", sentOf('end').some(m=>m.l===1));

  if(errors.length){ console.log('NET ERRORS:\n'+errors.join('\n')); process.exit(1); }
  console.log('spell-caster net: '+pass+' duel-netcode assertions passed');
  console.log('  connect→ready handshake, pos/cast apply, dodge vs hit, HP broadcast, relayed casts, win/lose all ran with no errors');
  process.exit(0);
})();
