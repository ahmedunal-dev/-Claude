import {WIDTH,UPGRADES,createArena,resizeArena,aim,aimDirection,tick,dashTarget,dashCooldown,comboTime,chooseUpgrade} from './simulation.mjs';

const $ = id => document.getElementById(id);
const stage=$('stage'), canvas=$('canvas'), ctx=canvas.getContext('2d');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const key='kivilcim-arena-v2';
let stored={};
try { stored=JSON.parse(localStorage.getItem(key))||JSON.parse(localStorage.getItem('kivilcim-arena-v1'))||{}; } catch {}
let best=Math.max(0,Number(stored.best)||0), bestWave=Math.max(0,Number(stored.bestWave)||0);
let board=Array.isArray(stored.board)?stored.board.filter(r=>r&&Number.isFinite(r.points)).slice(0,5):[];
let sound=stored.sound!==false, audio;
let size=500, scale=1, mode='ready', last=0, game=createArena();
let trails=[], sparks=[], floats=[], rings=[], shake=0, flash=0, announcement=0;
let hitstop=0, slowmo=0, pointer=null, padHeld=false, padStart=false;
let cached={};
const fmt=new Intl.NumberFormat('tr-TR');
const directions={KeyW:[0,-1],KeyA:[-1,0],KeyS:[0,1],KeyD:[1,0],ArrowUp:[0,-1],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowRight:[1,0]};
const keys=new Set();
const labels={ready:'Oyna',paused:'Devam et',over:'Bir tur daha'};

function persist() {
  try { localStorage.setItem(key,JSON.stringify({best,bestWave,sound,board})); } catch {}
}
function updateSound() {
  $('sound').setAttribute('aria-pressed',String(sound));
  $('sound').textContent=sound?'Ses açık':'Ses kapalı';
}
function wakeAudio() {
  if (!sound) return;
  try {
    audio??=new (window.AudioContext||window.webkitAudioContext)();
    audio.resume().catch(()=>{});
  } catch {}
}
function tone(start,end,time,volume,shape='triangle',delay=0) {
  if(!sound||audio?.state!=='running') return;
  const at=audio.currentTime+delay, oscillator=audio.createOscillator(), gain=audio.createGain();
  oscillator.type=shape;
  oscillator.frequency.setValueAtTime(start,at);
  oscillator.frequency.exponentialRampToValueAtTime(end,at+time);
  gain.gain.setValueAtTime(volume,at);
  gain.gain.exponentialRampToValueAtTime(.001,at+time);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(at);
  oscillator.stop(at+time);
}
function noise(time,volume) {
  if(!sound||audio?.state!=='running') return;
  const buffer=audio.createBuffer(1,Math.floor(audio.sampleRate*time),audio.sampleRate);
  const data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*(1-i/data.length)**2;
  const src=audio.createBufferSource(), gain=audio.createGain();
  src.buffer=buffer; gain.gain.value=volume;
  src.connect(gain).connect(audio.destination);
  src.start();
}
function label(id,value) {
  if(cached[id]===value) return;
  cached[id]=value;
  $(id).textContent=value;
}
function sync() {
  const {points,wave,combo,comboTime:left,p}=game;
  label('score',fmt.format(points));
  label('wave',String(wave).padStart(2,'0'));
  const health='♥ '.repeat(p.hp)+'♡ '.repeat(Math.max(0,p.maxHp-p.hp))+'◆ '.repeat(p.shield);
  label('health',health.trim());
  $('health').setAttribute('aria-label',p.hp+' can'+(p.shield?', '+p.shield+' kalkan':''));
  label('record',fmt.format(best));
  label('recordWave',bestWave?String(bestWave).padStart(2,'0'):'–');
  label('combo','×'+combo);
  const fill=p.dash?0:1-Math.min(1,p.cd/dashCooldown(game));
  $('dash').style.transform='scaleX('+fill+')';
  label('dashState',fill===1?'HAZIR':'DOLUYOR');
  $('comboMeter').style.transform='scaleX('+left/comboTime(game)+')';
  const taken=Object.entries(game.taken).map(([id,n])=>UPGRADES[id].icon+' '+UPGRADES[id].name+(n>1?' ×'+n:'')).join('\n');
  if(cached.perks!==taken) {
    cached.perks=taken;
    const list=$('perks');
    list.replaceChildren(...(taken?taken.split('\n'):['Her iki dalgada bir yükseltme seç.']).map(text=>{
      const li=document.createElement('li'); li.textContent=text; if(!taken) li.className='empty'; return li;
    }));
  }
}
function renderBoard(highlight=-1) {
  const list=$('board');
  if(!board.length) { list.replaceChildren(Object.assign(document.createElement('li'),{className:'empty',textContent:'Henüz tur yok.'})); return; }
  list.replaceChildren(...board.map((r,i)=>{
    const li=document.createElement('li');
    if(i===highlight) li.className='fresh';
    const a=document.createElement('span'); a.textContent=fmt.format(r.points);
    const b=document.createElement('small'); b.textContent='D'+String(r.wave).padStart(2,'0');
    li.append(a,b);
    return li;
  }));
}
function showDialog(next, status, headline, copy, hint='') {
  mode=next;
  keys.clear();
  $('overlay').hidden=false;
  $('announce').hidden=true;
  $('choices').hidden=true;
  $('play').hidden=false;
  $('pause').disabled=next!=='paused';
  $('pause').textContent=next==='paused'?'Devam et':'Duraklat';
  label('status',status);
  label('title',headline);
  label('copy',copy);
  label('shortcut',hint);
  $('shortcut').hidden=!hint;
  $('play').firstChild.textContent=labels[next]+' ';
  $('play').focus({preventScroll:true});
}
function showUpgrades() {
  mode='upgrade';
  keys.clear();
  $('overlay').hidden=false;
  $('announce').hidden=true;
  $('play').hidden=true;
  $('pause').disabled=true;
  label('status','DALGA '+String(game.wave).padStart(2,'0')+' TEMİZ');
  label('title','Güçlen.');
  label('copy','Bir yükseltme seç. Tur boyunca kalır.');
  const fine=matchMedia('(pointer: fine)').matches;
  label('shortcut',fine?'1 · 2 · 3 tuşlarıyla da seçebilirsin.':'');
  $('shortcut').hidden=!fine;
  const box=$('choices');
  box.hidden=false;
  box.replaceChildren(...game.choices.map((id,i)=>{
    const u=UPGRADES[id], button=document.createElement('button');
    button.className='choice';
    button.dataset.id=id;
    const lvl=(game.taken[id]||0)+1;
    button.innerHTML='<i aria-hidden="true"></i><span><b></b><small></small></span><kbd></kbd>';
    button.querySelector('i').textContent=u.icon;
    button.querySelector('b').textContent=u.name+(u.max>1?' '+'I'.repeat(lvl):'');
    button.querySelector('small').textContent=u.text;
    button.querySelector('kbd').textContent=i+1;
    button.addEventListener('click',()=>pick(id));
    return button;
  }));
  box.firstChild.focus({preventScroll:true});
  tone(420,640,.16,.05); tone(640,960,.18,.045,'triangle',.09);
}
function pick(id) {
  if(mode!=='upgrade'||!chooseUpgrade(game,id)) return;
  tone(520,1040,.22,.07,'sine');
  burst(game.p.x,game.p.y,'#e9ff46',24);
  rings.push({x:game.p.x,y:game.p.y,r:80,color:'#e9ff46',life:.4,max:.4});
  enter();
}
function enter() {
  mode='playing';
  wakeAudio();
  $('overlay').hidden=true;
  $('pause').disabled=false;
  $('pause').textContent='Duraklat';
  stage.focus({preventScroll:true});
}
function start() {
  game=createArena(size);
  trails=[]; sparks=[]; floats=[]; rings=[];
  announcement=shake=flash=hitstop=slowmo=0;
  cached={};
  $('announce').hidden=true;
  enter();
  sync();
}
function pause() {
  if(mode==='playing') showDialog('paused','MOLA','Oyun durdu.','Devam edince arena kaldığın yerden açılır.');
  else if(mode==='paused') enter();
}
function finish() {
  const record=game.points>best;
  best=Math.max(best,game.points);
  bestWave=Math.max(bestWave,game.wave);
  let place=-1;
  if(game.points>0) {
    const entry={points:game.points,wave:game.wave};
    board.push(entry);
    board.sort((a,b)=>b.points-a.points);
    board=board.slice(0,5);
    place=board.indexOf(entry);
  }
  persist();
  sync();
  renderBoard(place);
  const s=game.stats;
  showDialog('over',record?'YENİ REKOR':'TUR BİTTİ','Son kıvılcım.',
    fmt.format(game.points)+' puan · Dalga '+game.wave+' · Kombo ×'+game.peak,
    s.kills+' düşman · '+s.parries+' sektirme · '+s.bosses+' boss');
}
function burst(x,y,color,count,power=1) {
  if(reduced.matches) count=Math.min(3,count);
  for(let i=0;i<count;i++) {
    const angle=Math.random()*Math.PI*2, speed=(58+Math.random()*230)*power, life=.18+Math.random()*.35;
    sparks.push({x,y,color,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life,maxLife:life,size:2+Math.random()*5});
  }
}
function notice(text,duration) {
  label('announce',text);
  $('announce').hidden=false;
  announcement=duration;
}
function events() {
  for(const event of game.events) {
    const {type,x,y}=event;
    switch(type) {
      case 'dash': tone(180,490,.13,.062,'sawtooth'); break;
      case 'trail': trails.push({...event,life:.16}); break;
      case 'score':
        burst(x,y,event.color,10);
        floats.push({x,y:y-20,label:'+'+fmt.format(event.score),color:event.color,life:.55});
        tone(230+event.combo*87,360+event.combo*110,.14,.075);
        if(event.up&&event.combo>=3) notice('KOMBO ×'+event.combo,.55);
        break;
      case 'kill':
        hitstop=Math.max(hitstop,event.boss?.16:.035);
        rings.push({x,y,r:event.r*2.4,color:event.color,life:.3,max:.3});
        burst(x,y,event.color,event.boss?40:8,event.boss?1.6:1);
        if(event.boss) { shake=.35; tone(90,30,.6,.14,'sawtooth'); noise(.5,.18); notice('BOSS DÜŞTÜ!',.8); }
        break;
      case 'parry':
        burst(x,y,'#a9ffee',17);
        rings.push({x,y,r:34,color:'#75f0df',life:.22,max:.22});
        slowmo=Math.max(slowmo,.16);
        tone(380,1200,.21,.075,'sine');
        break;
      case 'shock':
        rings.push({x,y,r:event.r,color:'#e9ff46',life:.28,max:.28});
        tone(300,90,.18,.05,'square');
        break;
      case 'boom':
        rings.push({x,y,r:event.r,color:event.hostile?'#ff5a3c':'#ffb35a',life:.38,max:.38,fill:true});
        burst(x,y,'#ffb35a',26,1.4);
        shake=Math.max(shake,.2);
        noise(.35,.16); tone(140,40,.35,.09,'sawtooth');
        break;
      case 'fuse': tone(900,1300,.1,.035,'square'); tone(900,1300,.1,.035,'square',.15); break;
      case 'block':
        rings.push({x,y,r:36,color:'#7fb6ff',life:.3,max:.3});
        burst(x,y,'#7fb6ff',16);
        floats.push({x,y:y-28,label:'KALKAN',color:'#7fb6ff',life:.6});
        tone(700,300,.2,.07,'sine');
        break;
      case 'hurt':
        burst(x,y,'#ff7083',21);
        shake=.22; flash=.17;
        tone(118,40,.32,.13,'sawtooth');
        break;
      case 'shot': tone(230,150,.14,.025,'square'); break;
      case 'wave':
        notice(event.wave%3===0?'BOSS DALGASI':'DALGA '+String(event.wave).padStart(2,'0'),.73);
        tone(170,320,.16,.057);
        tone(340,560,.17,.055,'triangle',.10);
        break;
      case 'clear':
        notice(event.perfect?'KUSURSUZ! +'+fmt.format(event.bonus+event.perfect):'DALGA TEMİZ!',.7);
        tone(500,845,.16,.06);
        tone(710,1040,.16,.055,'triangle',.11);
        if(event.perfect) tone(1040,1560,.2,.05,'sine',.22);
        break;
      case 'offer': showUpgrades(); break;
    }
  }
  game.events.length=0;
}
function tickFx(dt) {
  announcement-=dt;
  if(announcement<=0) $('announce').hidden=true;
  shake=Math.max(0,shake-dt);
  flash=Math.max(0,flash-dt);
  for(const item of [...trails,...sparks,...floats,...rings]) item.life-=dt;
  trails=trails.filter(e=>e.life>0);
  sparks=sparks.filter(e=>e.life>0);
  floats=floats.filter(e=>e.life>0);
  rings=rings.filter(e=>e.life>0);
  for(const s of sparks) {s.x+=s.vx*dt;s.y+=s.vy*dt;s.vx*=.94;s.vy*=.94;}
  for(const f of floats) f.y-=52*dt;
}
function line(ax,ay,bx,by,color,w=1) {
  ctx.strokeStyle=color;ctx.lineWidth=w;
  ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
}
function circle(x,y,r,stroke,w=1,fill) {
  ctx.beginPath();ctx.arc(x,y,Math.max(0,r),0,Math.PI*2);
  if(fill) {ctx.fillStyle=fill;ctx.fill();}
  if(stroke) {ctx.strokeStyle=stroke;ctx.lineWidth=w;ctx.stroke();}
}
function poly(points,fill,stroke,w=1) {
  ctx.beginPath();ctx.moveTo(...points[0]);
  for(const p of points.slice(1)) ctx.lineTo(...p);
  ctx.closePath();
  if(fill){ctx.fillStyle=fill;ctx.fill();}
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=w;ctx.stroke();}
}
function back() {
  ctx.fillStyle='#242629';ctx.fillRect(0,0,WIDTH,size);
  ctx.fillStyle='#282b2d';ctx.fillRect(24,24,WIDTH-48,size-48);
  ctx.strokeStyle='#4b4d47';ctx.lineWidth=1;
  ctx.strokeRect(24,24,WIDTH-48,size-48);
  ctx.strokeRect(30,30,WIDTH-60,size-60);
  for(let x=48;x<WIDTH-28;x+=32) for(let y=48;y<size-26;y+=32) {
    ctx.fillStyle=(x+y)%64===0?'#64655a':'#454745';
    ctx.fillRect(x,y,1.5,1.5);
  }
  const mx=WIDTH/2,my=size/2;
  // The arena "breathes" with your combo.
  const heat=Math.min(1,(game.combo-1)/7);
  for(const r of [54,97,146]) circle(mx,my,r,heat>0?`rgba(233,255,70,${.12+heat*.3})`:'#464940');
  line(mx-164,my,mx+164,my,'#44463d');
  line(mx,my-164,mx,my+164,'#44463d');
  ctx.fillStyle=heat>0?`rgba(233,255,70,${.05+heat*.12})`:'#30332e';
  ctx.font='900 128px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('ϟ',mx,my+4);
  for(const [x,y,sx,sy] of [[24,24,1,1],[WIDTH-24,24,-1,1],[24,size-24,1,-1],[WIDTH-24,size-24,-1,-1]]) {
    line(x,y,x+sx*26,y,'#b1b098',3); line(x,y,x,y+sy*26,'#b1b098',3);
  }
  for(let i=0;i<7;i++) {
    const x=51+i*9;
    line(x,size-13,x+6,size-20,'#737363',2);
    line(WIDTH-x,13,WIDTH-x-6,20,'#737363',2);
  }
}
function enemyDraw(e) {
  const {x,y,r,kind,color,hp,maxHp,warm,angle}=e;
  if(warm>0) {
    circle(x,y,r+8+warm*16,color,1.4);
    line(x-7,y,x+7,y,color,1); line(x,y-7,x,y+7,color,1);
  }
  const charging=warm<=0&&(kind==='shooter'||kind==='boss'||kind==='charger')&&e.timer<.34&&!e.rush;
  if(charging&&!reduced.matches) {
    const a=angle,radius=kind==='charger'?150:kind==='boss'?110:105;
    ctx.setLineDash([4,7]);
    line(x+Math.cos(a)*r,y+Math.sin(a)*r,x+Math.cos(a)*radius,y+Math.sin(a)*radius,color,kind==='charger'?3:1.5);
    ctx.setLineDash([]);
    circle(x,y,r+8,color,2);
  }
  if(kind==='bomber'&&e.fuse!==undefined) {
    const t=Math.max(0,e.fuse)/.95;
    ctx.globalAlpha=.18+.25*(1-t);
    circle(x,y,88,null,1,'#ff5a3c');
    ctx.globalAlpha=1;
    circle(x,y,88*(1-t),'#ff5a3c',2);
  }
  ctx.save();ctx.translate(x,y);
  ctx.globalAlpha=warm>0?.63:1;
  ctx.rotate(angle);
  let fill=e.hurt>0?'#fff8df':color;
  if(kind==='bomber'&&e.fuse!==undefined&&Math.floor(e.fuse*14)%2) fill='#fff8df';
  if(kind==='chaser'||kind==='mini') {
    poly([[r+3,0],[-r, -r*.82],[-r*.61,0],[-r,r*.82]],fill);
    line(-4,-5*r/16,-4,5*r/16,'#39242c',3);
  } else if(kind==='shooter') {
    poly([[r*.97,0],[0,r],[-r*.97,0],[0,-r]],'#302835',fill,3);
    line(-3,0,r-2,0,fill,6);
    circle(-4,0,4,undefined,1,'#f5eaff');
  } else if(kind==='charger') {
    poly([[r+4,0],[r*.48,r*.65],[-r*.65,r*.65],[-r,r*.21],[-r,-r*.21],[-r*.65,-r*.65],[r*.48,-r*.65]],fill);
    line(-10,0,8,0,'#593a2b',4);
  } else if(kind==='splitter') {
    poly([[r,0],[r*.3,r*.9],[-r*.8,r*.55],[-r*.8,-r*.55],[r*.3,-r*.9]],'#24341f',fill,3);
    line(-r*.6,0,r*.7,0,fill,3);
    circle(r*.15,-r*.38,3.5,undefined,1,fill); circle(r*.15,r*.38,3.5,undefined,1,fill);
  } else if(kind==='bomber') {
    circle(0,0,r,'#3a2218',3,fill);
    ctx.rotate(-angle);
    line(0,-r,5,-r-8,'#e9e3c8',2);
    circle(6,-r-9,2.5,undefined,1,'#ffe36b');
    ctx.fillStyle='#3a2218';ctx.font='900 14px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('!',0,1);
  } else {
    const angry=hp<=maxHp/2;
    const hex=Array.from({length:6},(_,i)=>[Math.cos(i*Math.PI/3)*r,Math.sin(i*Math.PI/3)*r]);
    poly(hex,angry?'#5a2730':'#402b31',fill,4);
    circle(0,0,17,fill,2,'#262326');
    circle(5,0,6,undefined,1,angry?'#fff8df':fill);
    for(const a of [-1,1]) line(-7,a*22,9,a*22,fill,4);
  }
  ctx.restore();
  if(maxHp>1&&kind!=='boss') {
    const bar=r*1.8;
    line(x-bar*.5,y-r-13,x+bar*.5,y-r-13,'#4e4245',4);
    line(x-bar*.5,y-r-13,x-bar*.5+bar*hp/maxHp,y-r-13,color,4);
  }
}
function bossBar() {
  const bosses=game.enemies.filter(e=>e.kind==='boss'&&e.warm<=0);
  if(!bosses.length) return;
  const hp=bosses.reduce((n,e)=>n+e.hp,0), max=bosses.reduce((n,e)=>n+e.maxHp,0);
  const w=WIDTH*.5, x=(WIDTH-w)/2, y=size-44;
  ctx.fillStyle='#1a1a1dcc';ctx.fillRect(x-6,y-14,w+12,24);
  ctx.fillStyle='#4e4245';ctx.fillRect(x,y,w,5);
  ctx.fillStyle=hp<=max/2?'#ff4d63':'#ff7083';ctx.fillRect(x,y,w*hp/max,5);
  ctx.font='750 9px ui-monospace,monospace';ctx.textAlign='left';ctx.textBaseline='alphabetic';
  ctx.fillStyle='#b2b0a7';ctx.fillText(hp<=max/2?'BOSS · ÖFKELİ':'BOSS',x,y-4);
}
function aimDraw() {
  const p=game.p;
  if(!pointer||p.dash||mode!=='playing') return;
  const end=dashTarget(game,pointer.x,pointer.y);
  if(!end) return;
  const ready=p.cd<=0;
  ctx.save();
  ctx.globalAlpha=ready?.55:.2;
  ctx.setLineDash([3,8]);
  line(p.x,p.y,end.x,end.y,'#ecff59',1.5);
  ctx.setLineDash([]);
  circle(end.x,end.y,7,'#ecff59',1.5);
  ctx.restore();
}
function playerDraw() {
  const {p}=game;
  if(p.shield>0) {
    ctx.globalAlpha=.5+.2*Math.sin(game.time*6);
    circle(p.x,p.y,27,'#7fb6ff',2);
    ctx.globalAlpha=1;
  }
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);
  if(p.inv>0&&!reduced.matches&&Math.floor(p.inv*15)%2) ctx.globalAlpha=.43;
  const c='#ecff59';
  if(p.dash) {
    poly([[-34,0],[-11,9],[13,8],[24,0],[13,-8],[-11,-9]],'#ecff5966');
  }
  const ready=p.cd<=0&&!p.dash;
  circle(0,0,21,ready?'#ecff59a0':'#ecff5940',ready?1.5:1);
  poly([[18,0],[-7,-12],[-13,-8],[-9,0],[-13,8],[-7,12]],c,'#181c15',2);
  poly([[8,0],[-6,-5],[-6,5]],'#32382a');
  line(-16,0,-20,0,c,3);
  ctx.restore();
}
function draw() {
  ctx.setTransform(scale,0,0,scale,0,0);
  back();
  ctx.save();
  if(shake>0&&!reduced.matches) ctx.translate((Math.random()-.5)*shake*32,(Math.random()-.5)*shake*32);
  for(const g of rings) {
    const t=1-g.life/g.max;
    ctx.globalAlpha=(1-t)*.9;
    if(g.fill) { ctx.globalAlpha=(1-t)*.35; circle(g.x,g.y,g.r*(.4+.6*t),null,1,g.color); ctx.globalAlpha=(1-t)*.9; }
    circle(g.x,g.y,g.r*(.35+.65*t),g.color,3*(1-t)+1);
  }
  ctx.globalAlpha=1;
  aimDraw();
  ctx.globalCompositeOperation='lighter';
  for(const {from,to,life} of trails) {
    ctx.globalAlpha=Math.max(0,life/.16)*.8;
    line(from.x,from.y,to.x,to.y,'#a8c23a',13);
    line(from.x,from.y,to.x,to.y,'#f2ffad',4);
  }
  ctx.globalCompositeOperation='source-over';
  ctx.globalAlpha=1;
  for(const e of game.enemies) enemyDraw(e);
  for(const b of game.bolts) {
    const color=b.friendly?'#75f0df':'#ff879b';
    line(b.x-b.vx*.05,b.y-b.vy*.05,b.x,b.y,color+'76',6);
    circle(b.x,b.y,6,color,2,'#fff3da');
  }
  playerDraw();
  ctx.globalCompositeOperation='lighter';
  for(const s of sparks) {
    ctx.globalAlpha=s.life/s.maxLife;ctx.fillStyle=s.color;ctx.fillRect(s.x,s.y,s.size,s.size);
  }
  ctx.globalCompositeOperation='source-over';
  ctx.font='900 20px system-ui';ctx.textAlign='center';ctx.textBaseline='alphabetic';
  for(const f of floats) {
    ctx.globalAlpha=Math.min(1,f.life*3);
    ctx.fillStyle='#1b1b1e';ctx.fillText(f.label,f.x+1.8,f.y+1.8);
    ctx.fillStyle=f.color;ctx.fillText(f.label,f.x,f.y);
  }
  ctx.globalAlpha=1;
  ctx.restore();
  bossBar();
  if(flash>0&&!reduced.matches) {
    ctx.fillStyle='rgba(255,112,131,'+flash*1.2+')';
    ctx.fillRect(0,0,WIDTH,size);
  }
  if(game.p.hp===1&&mode==='playing'&&!reduced.matches) {
    const g=ctx.createRadialGradient(WIDTH/2,size/2,size*.35,WIDTH/2,size/2,WIDTH*.62);
    g.addColorStop(0,'rgba(255,60,80,0)');
    g.addColorStop(1,`rgba(255,60,80,${.16+.08*Math.sin(game.time*5)})`);
    ctx.fillStyle=g;ctx.fillRect(0,0,WIDTH,size);
  }
}
function resize() {
  const rect=stage.getBoundingClientRect();
  if(!rect.width||!rect.height) return;
  size=WIDTH*rect.height/rect.width;
  const dpr=Math.min(2,devicePixelRatio||1);
  canvas.width=Math.round(rect.width*dpr);
  canvas.height=Math.round(rect.height*dpr);
  scale=canvas.width/WIDTH;
  resizeArena(game,size);
  trails=[]; sparks=[]; floats=[]; rings=[];
  draw();
}
function heldDirection() {
  let x=0,y=0;
  for(const code of keys) {x+=directions[code][0];y+=directions[code][1];}
  return [x,y];
}
let padButtons=false;
function gamepad() {
  const pad=[...(navigator.getGamepads?.()||[])].find(Boolean);
  if(!pad) return;
  const startButton=!!pad.buttons[9]?.pressed;
  if(startButton&&!padStart) {
    if(mode==='playing'||mode==='paused') pause();
    else if(mode!=='upgrade') start();
  }
  padStart=startButton;
  const buttons=[0,1,2,3].some(b=>pad.buttons[b]?.pressed);
  if(mode==='upgrade'&&!padButtons) {
    // X / A / B pick left / middle / right.
    for(const [i,b] of [[0,2],[1,0],[2,1]]) if(pad.buttons[b]?.pressed&&game.choices?.[i]) { pick(game.choices[i]); break; }
  }
  padButtons=buttons;
  if(mode!=='playing') return;
  const x=pad.axes[0]||0, y=pad.axes[1]||0, tilted=Math.hypot(x,y)>.45;
  const press=pad.buttons[0]?.pressed||pad.buttons[7]?.pressed;
  // Flick the stick to dash; hold A/RT to keep dashing.
  if(tilted&&(press||!padHeld)) aimDirection(game,x,y);
  padHeld=tilted;
}
function frame(now) {
  const real=Math.min(.12,(now-(last||now))/1000);
  last=now;
  gamepad();
  if(mode==='playing') {
    // Holding a direction key keeps dashing as soon as the dash is ready.
    if(keys.size&&!game.p.dash&&game.p.cd<=0) { const [x,y]=heldDirection(); aimDirection(game,x,y); }
    let dt=real;
    if(hitstop>0) { hitstop-=real; dt=0; }
    else if(slowmo>0&&!reduced.matches) { slowmo-=real; dt=real*.35; }
    for(let rest=dt;rest>0&&!game.over&&!game.choices;) {
      const step=Math.min(rest,1/90);
      tick(game,step);
      rest-=step;
    }
    tickFx(real);
    events();
    sync();
    if(game.over) finish();
    draw();
  }
  requestAnimationFrame(frame);
}
function stagePoint(event) {
  const r=stage.getBoundingClientRect();
  return {x:(event.clientX-r.left)*WIDTH/r.width,y:(event.clientY-r.top)*size/r.height};
}
$('sound').addEventListener('click',()=>{sound=!sound;updateSound();wakeAudio();persist();});
$('pause').addEventListener('click',pause);
$('play').addEventListener('click',()=>mode==='paused'?enter():start());
stage.addEventListener('pointerdown',event=>{
  if(mode!=='playing'||!event.isPrimary||event.button!==0) return;
  event.preventDefault();
  const {x,y}=stagePoint(event);
  aim(game,x,y);
});
stage.addEventListener('pointermove',event=>{ pointer=event.pointerType==='mouse'?stagePoint(event):null; });
stage.addEventListener('pointerleave',()=>{ pointer=null; });
window.addEventListener('keydown',event=>{
  if(event.metaKey||event.ctrlKey||event.altKey) return;
  if(mode==='upgrade') {
    const n=['Digit1','Digit2','Digit3','Numpad1','Numpad2','Numpad3'].indexOf(event.code)%3;
    if(n>=0&&game.choices?.[n]&&!event.repeat) { event.preventDefault(); pick(game.choices[n]); }
    return;
  }
  if(!event.repeat&&(event.code==='KeyP'||event.code==='Escape')) {pause();return;}
  if(mode==='playing'&&directions[event.code]) {
    event.preventDefault();
    keys.add(event.code);
    if(!event.repeat) { const [x,y]=heldDirection(); aimDirection(game,x,y); }
  } else if(!event.repeat&&event.code==='Space'&&!event.target.closest('button')&&mode!=='playing') {
    event.preventDefault();
    if(mode==='paused') enter();
    else start();
  }
});
window.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',()=>keys.clear());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='playing') pause();});
new ResizeObserver(resize).observe(stage);
updateSound();
renderBoard();
sync();
requestAnimationFrame(frame);
