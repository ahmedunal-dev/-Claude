import {WIDTH,DASH_COOLDOWN,COMBO_TIME,createArena,resizeArena,aim,aimDirection,tick} from './simulation.mjs';

const $ = id => document.getElementById(id);
const stage=$('stage'), canvas=$('canvas'), ctx=canvas.getContext('2d');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const key='kivilcim-arena-v1';
let stored={};
try { stored=JSON.parse(localStorage.getItem(key))||{}; } catch {}
let best=Math.max(0,Number(stored.best)||0), bestWave=Math.max(0,Number(stored.bestWave)||0);
let sound=stored.sound!==false, audio;
let size=500, scale=1, mode='ready', last=0, game=createArena();
let trails=[], sparks=[], floats=[], shake=0, flash=0, announcement=0;
let cached={};
const fmt=new Intl.NumberFormat('tr-TR');
const directions={KeyW:[0,-1],KeyA:[-1,0],KeyS:[0,1],KeyD:[1,0],ArrowUp:[0,-1],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowRight:[1,0]};
const keys=new Set();
const labels={ready:'Oyna',paused:'Devam et',over:'Bir tur daha'};

function persist() {
  try { localStorage.setItem(key,JSON.stringify({best,bestWave,sound})); } catch {}
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
function label(id,value) {
  if(cached[id]===value) return;
  cached[id]=value;
  $(id).textContent=value;
}
function sync() {
  const {points,wave,combo,comboTime,p}=game;
  label('score',fmt.format(points));
  label('wave',String(wave).padStart(2,'0'));
  const health='♥ '.repeat(p.hp)+'♡ '.repeat(3-p.hp);
  label('health',health.trim());
  $('health').setAttribute('aria-label',p.hp+' can');
  label('record',fmt.format(best));
  label('recordWave',bestWave?String(bestWave).padStart(2,'0'):'–');
  label('combo','×'+combo);
  const fill=p.dash?0:1-Math.min(1,p.cd/DASH_COOLDOWN);
  $('dash').style.transform='scaleX('+fill+')';
  label('dashState',fill===1?'HAZIR':'DOLUYOR');
  $('comboMeter').style.transform='scaleX('+comboTime/COMBO_TIME+')';
}
function showDialog(next, status, headline, copy, hint='') {
  mode=next;
  keys.clear();
  $('overlay').hidden=false;
  $('announce').hidden=true;
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
  trails=[]; sparks=[]; floats=[];
  announcement=shake=flash=0;
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
  persist();
  sync();
  showDialog('over',record?'YENİ REKOR':'TUR BİTTİ','Son kıvılcım.',
    fmt.format(game.points)+' puan · Dalga '+game.wave+' · Kombo ×'+game.peak);
}
function burst(x,y,color,count) {
  if(reduced.matches) count=Math.min(3,count);
  for(let i=0;i<count;i++) {
    const angle=Math.random()*Math.PI*2, speed=58+Math.random()*230, life=.18+Math.random()*.35;
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
        floats.push({x,y:y-20,label:'+'+event.score,color:event.color,life:.55});
        tone(230+event.combo*87,360+event.combo*110,.14,.075);
        if(event.combo>=3&&event.combo>1 && game.hits%2===0) notice('KOMBO ×'+event.combo,.55);
        break;
      case 'parry':
        burst(x,y,'#a9ffee',17);
        tone(380,1200,.21,.075,'sine');
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
        notice('DALGA TEMİZ!',.57);
        tone(500,845,.16,.06);
        tone(710,1040,.16,.055,'triangle',.11);
        break;
    }
  }
  game.events.length=0;
}
function tickFx(dt) {
  announcement-=dt;
  if(announcement<=0) $('announce').hidden=true;
  shake=Math.max(0,shake-dt);
  flash=Math.max(0,flash-dt);
  for(const item of [...trails,...sparks,...floats]) item.life-=dt;
  trails=trails.filter(e=>e.life>0);
  sparks=sparks.filter(e=>e.life>0);
  floats=floats.filter(e=>e.life>0);
  for(const s of sparks) {s.x+=s.vx*dt;s.y+=s.vy*dt;s.vx*=.94;s.vy*=.94;}
  for(const f of floats) f.y-=52*dt;
}
function line(ax,ay,bx,by,color,w=1) {
  ctx.strokeStyle=color;ctx.lineWidth=w;
  ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
}
function circle(x,y,r,stroke,w=1,fill) {
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
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
  for(const r of [54,97,146]) circle(mx,my,r,'#464940');
  line(mx-164,my,mx+164,my,'#44463d');
  line(mx,my-164,mx,my+164,'#44463d');
  ctx.fillStyle='#30332e';ctx.font='900 128px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
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
  const charging=warm<=0&&(kind==='shooter'||kind==='boss'||kind==='charger')&&e.timer<.34;
  if(charging&&!reduced.matches) {
    const a=angle,radius=kind==='boss'?110:105;
    ctx.setLineDash([4,7]);
    line(x+Math.cos(a)*r,y+Math.sin(a)*r,x+Math.cos(a)*radius,y+Math.sin(a)*radius,color,1.5);
    ctx.setLineDash([]);
    circle(x,y,r+8,color,2);
  }
  ctx.save();ctx.translate(x,y);
  ctx.globalAlpha=warm>0?.63:1;
  ctx.rotate(angle);
  const fill=e.hurt>0?'#fff8df':color;
  if(kind==='chaser') {
    poly([[r+3,0],[-r, -r*.82],[-r*.61,0],[-r,r*.82]],fill);
    line(-4,-5,-4,5,'#39242c',3);
  } else if(kind==='shooter') {
    poly([[r*.97,0],[0,r],[-r*.97,0],[0,-r]],'#302835',fill,3);
    line(-3,0,r-2,0,fill,6);
    circle(-4,0,4,undefined,1,'#f5eaff');
  } else if(kind==='charger') {
    poly([[r+4,0],[r*.48,r*.65],[-r*.65,r*.65],[-r,r*.21],[-r,-r*.21],[-r*.65,-r*.65],[r*.48,-r*.65]],fill);
    line(-10,0,8,0,'#593a2b',4);
  } else {
    const hex=Array.from({length:6},(_,i)=>[Math.cos(i*Math.PI/3)*r,Math.sin(i*Math.PI/3)*r]);
    poly(hex,'#402b31',fill,4);
    circle(0,0,17,fill,2,'#262326');
    circle(5,0,6,undefined,1,fill);
    for(const a of [-1,1]) line(-7,a*22,9,a*22,fill,4);
  }
  ctx.restore();
  if(maxHp>1) {
    const bar=r*1.8;
    line(x-bar*.5,y-r-13,x+bar*.5,y-r-13,'#4e4245',4);
    line(x-bar*.5,y-r-13,x-bar*.5+bar*hp/maxHp,y-r-13,color,4);
  }
}
function playerDraw() {
  const {p}=game;
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);
  if(p.inv>0&&!reduced.matches&&Math.floor(p.inv*15)%2) ctx.globalAlpha=.43;
  const c='#ecff59';
  if(p.dash) {
    poly([[-34,0],[-11,9],[13,8],[24,0],[13,-8],[-11,-9]],'#ecff5966');
  }
  circle(0,0,21,'#ecff5960',1);
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
  for(const {from,to,life} of trails) {
    ctx.globalAlpha=Math.max(0,life/.16)*.8;
    line(from.x,from.y,to.x,to.y,'#d8f350',13);
    line(from.x,from.y,to.x,to.y,'#f2ffad',4);
  }
  ctx.globalAlpha=1;
  for(const e of game.enemies) enemyDraw(e);
  for(const b of game.bolts) {
    const color=b.friendly?'#75f0df':'#ff879b';
    line(b.x-b.vx*.05,b.y-b.vy*.05,b.x,b.y,color+'76',6);
    circle(b.x,b.y,6,color,2,'#fff3da');
  }
  playerDraw();
  for(const s of sparks) {
    ctx.globalAlpha=s.life/s.maxLife;ctx.fillStyle=s.color;ctx.fillRect(s.x,s.y,s.size,s.size);
  }
  ctx.font='900 20px system-ui';ctx.textAlign='center';
  for(const f of floats) {
    ctx.globalAlpha=Math.min(1,f.life*3);
    ctx.fillStyle='#1b1b1e';ctx.fillText(f.label,f.x+1.8,f.y+1.8);
    ctx.fillStyle=f.color;ctx.fillText(f.label,f.x,f.y);
  }
  ctx.restore();
  if(flash>0&&!reduced.matches) {
    ctx.fillStyle='rgba(255,112,131,'+flash*1.2+')';
    ctx.fillRect(0,0,WIDTH,size);
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
  trails=[]; sparks=[]; floats=[];
  draw();
}
function frame(now) {
  const dt=Math.min(.12,(now-(last||now))/1000);
  last=now;
  if(mode==='playing') {
    for(let rest=dt;rest>0&&!game.over;) {
      const step=Math.min(rest,1/90);
      tick(game,step);
      rest-=step;
    }
    tickFx(dt);
    events();
    sync();
    if(game.over) finish();
    draw();
  }
  requestAnimationFrame(frame);
}
function keyboardAim() {
  let x=0,y=0;
  for(const code of keys) {x+=directions[code][0];y+=directions[code][1];}
  aimDirection(game,x,y);
}
$('sound').addEventListener('click',()=>{sound=!sound;updateSound();wakeAudio();persist();});
$('pause').addEventListener('click',pause);
$('play').addEventListener('click',()=>mode==='paused'?enter():start());
stage.addEventListener('pointerdown',event=>{
  if(mode!=='playing'||!event.isPrimary||event.button!==0) return;
  event.preventDefault();
  const r=stage.getBoundingClientRect();
  aim(game,(event.clientX-r.left)*WIDTH/r.width,(event.clientY-r.top)*size/r.height);
});
window.addEventListener('keydown',event=>{
  if(event.metaKey||event.ctrlKey||event.altKey) return;
  if(!event.repeat&&(event.code==='KeyP'||event.code==='Escape')) {pause();return;}
  if(mode==='playing'&&directions[event.code]) {
    event.preventDefault();
    keys.add(event.code);
    if(!event.repeat) keyboardAim();
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
sync();
requestAnimationFrame(frame);
