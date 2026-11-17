export const WIDTH = 720;
export const DASH_COOLDOWN = .39;
export const COMBO_TIME = 2.65;
export const BOMB_RADIUS = 88;
const clamp = (n, low, high) => Math.max(low, Math.min(high,n));
const length = (x,y) => Math.hypot(x,y);
const stats = {
  chaser:{r:16,hp:1,speed:117,value:100,color:'#ff7083'},
  shooter:{r:18,hp:1,speed:87,value:150,color:'#cba3ff'},
  charger:{r:21,hp:2,speed:89,value:240,color:'#ffc075'},
  splitter:{r:20,hp:1,speed:96,value:180,color:'#8dff8a'},
  mini:{r:11,hp:1,speed:152,value:60,color:'#8dff8a'},
  bomber:{r:17,hp:1,speed:74,value:210,color:'#ff9548'},
  boss:{r:34,hp:6,speed:72,value:720,color:'#ff7083'}
};

// Upgrades offered between waves. `max` = how often it can be taken.
export const UPGRADES = {
  reach:  {name:'Uzun Atılım',     text:'Atılma menzili +%20.',                    icon:'⟶', max:3},
  charge: {name:'Hızlı Şarj',      text:'Atılma bekleme süresi −%18.',             icon:'↻', max:3},
  blade:  {name:'Geniş Kıvılcım',  text:'Atılırken vuruş alanın büyür.',            icon:'◎', max:3},
  pierce: {name:'Delici Sektirme', text:'Geri sektirdiğin mermi bir düşman daha deler.', icon:'➶', max:2},
  fork:   {name:'Çatallanma',      text:'Sektirilen mermi başka bir düşmana da kopyalanır.', icon:'⑂', max:2},
  shock:  {name:'Şok Dalgası',     text:'Atılmanın sonunda çevrene hasar verirsin.', icon:'✺', max:2},
  shield: {name:'Enerji Kalkanı',  text:'Her dalgada bir darbeyi emer.',            icon:'◆', max:2},
  heart:  {name:'Ekstra Can',      text:'+1 maksimum can ve tam iyileşme.',         icon:'♥', max:2},
  chain:  {name:'Uzun Zincir',     text:'Kombo süresi +0,8 sn, kombo sınırı +2.',   icon:'×', max:2}
};

export function createArena(height=500, random=Math.random) {
  const game = {height,random, p:{x:WIDTH/2,y:height/2,hp:3,maxHp:3,shield:0,inv:0,angle:-Math.PI/2,cd:0},
    enemies:[], bolts:[], events:[], hits:0, peak:1, combo:1, comboTime:0, points:0, wave:0, nextWave:0, time:0, over:false,
    taken:{}, choices:null, flawless:true, stats:{kills:0,parries:0,dashes:0,bosses:0}};
  beginWave(game);
  return game;
}
const level = (game,id) => game.taken[id]||0;
export const dashReach = game => 325*(1+.2*level(game,'reach'));
export const dashCooldown = game => DASH_COOLDOWN*Math.pow(.82,level(game,'charge'));
export const comboTime = game => COMBO_TIME+.8*level(game,'chain');
const comboCap = game => 8+2*level(game,'chain');
const bladeRadius = game => 13+7*level(game,'blade');

export function resizeArena(game, height) {
  const factor=height/game.height;
  game.height=height;
  for (const body of [game.p,...game.enemies,...game.bolts]) body.y*=factor;
  if (game.p.dash) game.p.dash.y*=factor;
  if (game.buffer) game.buffer.y*=factor;
}
function enemy(game,kind,x,y,warm) {
  const data=stats[kind];
  const extra=kind==='boss'?Math.floor((game.wave-3)/3):kind==='charger'&&game.wave>=12?1:0;
  const body={kind,...data,x:clamp(x,data.r+17,WIDTH-data.r-17),y:clamp(y,data.r+17,game.height-data.r-17),warm,
    hp:data.hp+extra, timer:kind==='shooter'?.84+game.random()*.2:kind==='boss'?1.15:1.65, angle:0, hurt:0, spin:0};
  body.maxHp=body.hp;
  game.enemies.push(body);
  return body;
}
function kindFor(game,i) {
  const w=game.wave;
  if (w>=7&&i%6===4) return 'bomber';
  if (w>=5&&i%5===2) return 'splitter';
  if (i%4===1) return 'shooter';
  if (w>3&&i%4===3) return 'charger';
  return 'chaser';
}
function beginWave(game) {
  game.wave++;
  game.nextWave=0;
  game.flawless=true;
  game.p.shield=level(game,'shield');
  const h=game.height;
  game.events.push({type:'wave',wave:game.wave});
  if (game.wave===1) {
    enemy(game,'chaser',WIDTH*.26,h*.41,.32);
    enemy(game,'chaser',WIDTH*.28,h*.56,.4);
    enemy(game,'shooter',WIDTH*.75,h*.47,.48);
    return;
  }
  const bossWave=game.wave%3===0;
  if (bossWave) {
    const top=game.p.y>h*.5;
    if (game.wave>=9 && game.wave%9===0) {
      enemy(game,'boss',WIDTH*.3,top?h*.22:h*.78,.65);
      enemy(game,'boss',WIDTH*.7,top?h*.22:h*.78,.85);
    } else enemy(game,'boss',WIDTH*.5,top?h*.21:h*.79,.65);
  }
  const count=bossWave?Math.min(5,game.wave):Math.min(12,game.wave+3);
  const offset=game.random()*Math.PI*2;
  for (let i=0;i<count;i++) {
    const direction=offset+i*Math.PI*2/count;
    const x=WIDTH*.5+Math.cos(direction)*WIDTH*.375;
    const y=h*.5+Math.sin(direction)*h*.36;
    enemy(game,kindFor(game,i),x,y,.44+i*.07);
  }
}
// Where a dash toward (x,y) would end. Used by the aim preview, too.
export function dashTarget(game,x,y) {
  const p=game.p, dx=x-p.x, dy=y-p.y, dist=length(dx,dy);
  if (dist<8) return null;
  const reach=Math.min(dashReach(game),Math.max(60,dist));
  return {x:clamp(p.x+dx/dist*reach,26,WIDTH-26), y:clamp(p.y+dy/dist*reach,26,game.height-26)};
}
export function aim(game,x,y) {
  const p=game.p;
  if (game.over || game.choices || length(x-p.x,y-p.y)<8) return false;
  game.buffer={x,y,time:game.time+.22};
  return launch(game);
}
function launch(game) {
  const p=game.p, target=game.buffer;
  if (!target || p.cd>0 || p.dash) return false;
  game.buffer=null;
  const end=dashTarget(game,target.x,target.y);
  if (!end || length(end.x-p.x,end.y-p.y)<6) return false;
  p.dash={...end,hit:new Set()};
  p.angle=Math.atan2(end.y-p.y,end.x-p.x);
  game.stats.dashes++;
  game.events.push({type:'dash',x:p.x,y:p.y});
  return true;
}
export function aimDirection(game,x,y) {
  const size=length(x,y);
  if (size) return aim(game,game.p.x+x/size*250,game.p.y+y/size*250);
  return false;
}
function hitScore(game,value,x,y,color) {
  if (game.comboTime<=0) game.hits=0;
  game.hits++;
  const before=game.combo;
  game.combo=Math.min(comboCap(game),1+Math.floor(game.hits/2));
  game.peak=Math.max(game.peak,game.combo);
  game.comboTime=comboTime(game);
  const score=value*game.combo;
  game.points+=score;
  game.events.push({type:'score',x,y,score,color,combo:game.combo,up:game.combo>before});
}
function hitEnemy(game,e,damage,reflected=false) {
  if (e.hp<=0) return;
  e.hp=Math.max(0,e.hp-damage);
  e.hurt=.17;
  hitScore(game,e.hp?35:e.value,e.x,e.y,reflected?'#75f0df':e.color);
  if (!e.hp) kill(game,e);
}
function kill(game,e) {
  game.stats.kills++;
  if (e.kind==='boss') game.stats.bosses++;
  game.events.push({type:'kill',x:e.x,y:e.y,r:e.r,color:e.color,boss:e.kind==='boss'});
  if (e.kind==='splitter') {
    const a=e.angle+Math.PI/2;
    for (const s of [-1,1]) enemy(game,'mini',e.x+Math.cos(a)*s*18,e.y+Math.sin(a)*s*18,.18);
  }
  if (e.kind==='bomber') explode(game,e,false);
}
// A bomber blows up. Killed by the player → only enemies are hurt (reward).
// Detonating on its own → it hurts the player, too.
function explode(game,e,hostile) {
  e.hp=0;
  game.events.push({type:'boom',x:e.x,y:e.y,r:BOMB_RADIUS,hostile});
  for (const other of game.enemies) {
    if (other===e||other.hp<=0||other.warm>0) continue;
    if (length(other.x-e.x,other.y-e.y)<BOMB_RADIUS+other.r) hitEnemy(game,other,hostile?1:2);
  }
  if (hostile && length(game.p.x-e.x,game.p.y-e.y)<BOMB_RADIUS+10) hitPlayer(game,e.x,e.y);
}
function hitPlayer(game,x,y) {
  const p=game.p;
  if (p.inv>0 || game.over || p.dash) return;
  if (p.shield>0) {
    p.shield--;
    p.inv=.8;
    game.events.push({type:'block',x:p.x,y:p.y});
    return;
  }
  p.hp--;
  p.inv=1.05;
  game.combo=1;
  game.hits=0;
  game.comboTime=0;
  game.flawless=false;
  game.events.push({type:'hurt',x:p.x,y:p.y});
  if (!p.hp) { game.over=true; return; }
  const d=Math.max(1,length(p.x-x,p.y-y));
  p.x=clamp(p.x+(p.x-x)/d*24,26,WIDTH-26);
  p.y=clamp(p.y+(p.y-y)/d*24,26,game.height-26);
}
function rayHit(a,b,x,y,r) {
  const dx=b.x-a.x,dy=b.y-a.y;
  const k=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
  return length(a.x+dx*k-x,a.y+dy*k-y)<=r;
}
function movePlayer(game,dt) {
  const p=game.p;
  p.inv=Math.max(0,p.inv-dt);
  p.cd=Math.max(0,p.cd-dt);
  if (game.buffer?.time<game.time) game.buffer=null;
  launch(game);
  if (!p.dash) return;
  const from={x:p.x,y:p.y};
  const dash=p.dash, dx=dash.x-p.x,dy=dash.y-p.y;
  const remaining=length(dx,dy);
  const step=Math.min(1,2100*dt/(remaining||1));
  p.x+=dx*step;
  p.y+=dy*step;
  game.events.push({type:'trail',from,to:{x:p.x,y:p.y}});
  const blade=bladeRadius(game);
  for (const e of [...game.enemies]) {
    if(e.hp<=0||dash.hit.has(e)||!rayHit(from,p,e.x,e.y,e.r+blade)) continue;
    dash.hit.add(e);
    hitEnemy(game,e,1);
  }
  for (const b of [...game.bolts]) {
    if (b.friendly||b.dead||!rayHit(from,p,b.x,b.y,22+blade-13)) continue;
    parry(game,b);
  }
  if (step>=1) {
    const shock=level(game,'shock');
    if (shock) {
      const radius=55+shock*30;
      game.events.push({type:'shock',x:p.x,y:p.y,r:radius});
      for (const e of [...game.enemies]) {
        if (e.hp>0&&e.warm<=0&&!dash.hit.has(e)&&length(e.x-p.x,e.y-p.y)<radius+e.r) { dash.hit.add(e); hitEnemy(game,e,1); }
      }
    }
    p.dash=null;
    p.cd=dash.hit.size || dash.parried ? .22*dashCooldown(game)/DASH_COOLDOWN : dashCooldown(game);
  }
}
function nearestEnemy(game,x,y,skip) {
  let best=null,bestD=Infinity;
  for (const e of game.enemies) {
    if (e.hp<=0||e.warm>0||skip?.has(e)) continue;
    const d=length(e.x-x,e.y-y);
    if (d<bestD) {best=e;bestD=d;}
  }
  return best;
}
function steer(b,target,speed=598) {
  const angle=target?Math.atan2(target.y-b.y,target.x-b.x):Math.atan2(-b.vy,-b.vx);
  b.vx=Math.cos(angle)*speed;
  b.vy=Math.sin(angle)*speed;
}
function parry(game,b) {
  b.friendly=true;
  b.pierce=level(game,'pierce');
  b.hitSet=new Set();
  if (game.p.dash) game.p.dash.parried=true;
  const target=b.owner.hp>0&&b.owner.warm<=0?b.owner:nearestEnemy(game,b.x,b.y);
  steer(b,target);
  b.ttl=1.5;
  game.stats.parries++;
  hitScore(game,60,b.x,b.y,'#75f0df');
  game.events.push({type:'parry',x:b.x,y:b.y});
  const forks=level(game,'fork');
  const used=new Set(target?[target]:[]);
  for (let i=0;i<forks;i++) {
    const other=nearestEnemy(game,b.x,b.y,used);
    if (!other) break;
    used.add(other);
    const copy={x:b.x,y:b.y,vx:0,vy:0,owner:b.owner,ttl:1.5,friendly:true,pierce:b.pierce,hitSet:new Set()};
    steer(copy,other);
    game.bolts.push(copy);
  }
}
function shoot(game,e,angle,speed) {
  game.bolts.push({x:e.x+Math.cos(angle)*(e.r+7),y:e.y+Math.sin(angle)*(e.r+7),
    vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,owner:e,ttl:4,friendly:false});
}
function moveEnemies(game,dt) {
  const p=game.p;
  const boost=1+Math.min(.64,(game.wave-1)*.078);
  for (const e of game.enemies) {
    if(e.hp<=0) continue;
    e.hurt=Math.max(0,e.hurt-dt);
    e.warm-=dt;
    if(e.warm>0) continue;
    const dx=p.x-e.x,dy=p.y-e.y,d=length(dx,dy);
    if(!e.rush) e.angle=Math.atan2(dy,dx);
    e.timer-=dt;
    let speed=e.speed*boost;
    if(e.kind==='shooter') speed*=d>235?1:d<125?-.73:0;
    if(e.kind==='charger') {
      if(e.timer<=0 && !e.rush) { e.rush=.32; e.timer=1.9; }
      if(e.rush) { e.rush=Math.max(0,e.rush-dt); speed=420; }
      else if(e.timer<.37) speed=0;
    }
    if(e.kind==='bomber') {
      if(e.fuse===undefined && d<78) { e.fuse=.95; game.events.push({type:'fuse',x:e.x,y:e.y}); }
      if(e.fuse!==undefined) {
        speed=0;
        e.fuse-=dt;
        if(e.fuse<=0) { explode(game,e,true); continue; }
      }
    }
    if((e.kind==='shooter'||e.kind==='boss') && e.timer<=0) {
      if (e.kind==='boss') {
        const angry=e.hp<=e.maxHp/2;
        const lanes=6+Math.min(4,Math.floor(game.wave/3));
        const speedB=245+game.wave*4;
        e.spin+=angry?.33:0;
        for(let i=0;i<lanes;i++) shoot(game,e,e.angle+e.spin+i*Math.PI*2/lanes,speedB);
        if (angry) shoot(game,e,e.angle,speedB*1.25);
        e.timer=Math.max(.7,1.52-game.wave*.035)*(angry?.78:1);
      } else {
        shoot(game,e,e.angle,Math.min(410,306+game.wave*8));
        e.timer=Math.max(.76,1.58-game.wave*.055);
      }
      game.events.push({type:'shot',x:e.x,y:e.y});
    }
    if (e.kind==='boss'&&e.timer<.33) speed*=.25;
    e.x=clamp(e.x+Math.cos(e.angle)*speed*dt,e.r+17,WIDTH-e.r-17);
    e.y=clamp(e.y+Math.sin(e.angle)*speed*dt,e.r+17,game.height-e.r-17);
    if(d<e.r+12) hitPlayer(game,e.x,e.y);
  }
}
function separate(game) {
  for(let i=0;i<game.enemies.length;i++) for(let j=i+1;j<game.enemies.length;j++) {
    const a=game.enemies[i],b=game.enemies[j];
    const dx=b.x-a.x,dy=b.y-a.y,d=length(dx,dy);
    const missing=a.r+b.r+2-d;
    if(missing<=0||d===0) continue;
    const n=Math.min(missing*.16,3)/d;
    a.x-=dx*n; a.y-=dy*n;
    b.x+=dx*n; b.y+=dy*n;
  }
}
function moveBolts(game,dt) {
  for(const b of [...game.bolts]) {
    if (b.dead) continue;
    const from={x:b.x,y:b.y};
    b.x+=b.vx*dt;
    b.y+=b.vy*dt;
    b.ttl-=dt;
    if(b.x<0||b.x>WIDTH||b.y<0||b.y>game.height||b.ttl<=0) {b.dead=true;continue;}
    if (b.friendly) {
      const target=game.enemies.find(e=>e.hp>0&&e.warm<=0&&!b.hitSet?.has(e)&&rayHit(from,b,e.x,e.y,e.r+6));
      if (!target) continue;
      b.hitSet?.add(target);
      hitEnemy(game,target,2,true);
      if (b.pierce>0) {
        b.pierce--;
        steer(b,nearestEnemy(game,b.x,b.y,b.hitSet)||{x:b.x+b.vx,y:b.y+b.vy});
      } else b.dead=true;
    } else if (rayHit(from,b,game.p.x,game.p.y,16)) {
      if (game.p.dash) parry(game,b);
      else { hitPlayer(game,b.x,b.y); b.dead=true; }
    }
  }
}
function offerUpgrades(game) {
  const open=Object.keys(UPGRADES).filter(id=>level(game,id)<UPGRADES[id].max);
  const choices=[];
  while (open.length && choices.length<3) choices.push(open.splice(Math.floor(game.random()*open.length),1)[0]);
  return choices.length?choices:null;
}
export function chooseUpgrade(game,id) {
  if (!game.choices?.includes(id)) return false;
  game.taken[id]=level(game,id)+1;
  if (id==='heart') { game.p.maxHp++; game.p.hp=game.p.maxHp; }
  if (id==='shield') game.p.shield=level(game,'shield');
  game.choices=null;
  game.nextWave=game.time+.45;
  game.events.push({type:'upgrade',id});
  return true;
}
export function tick(game,dt) {
  if(game.over||game.choices) return;
  game.time+=dt;
  game.comboTime=Math.max(0,game.comboTime-dt);
  if(!game.comboTime) game.combo=1;
  movePlayer(game,dt);
  moveEnemies(game,dt);
  separate(game);
  moveBolts(game,dt);
  game.enemies=game.enemies.filter(e=>e.hp>0);
  game.bolts=game.bolts.filter(b=>!b.dead);
  if(game.enemies.length||game.over) return;
  if(!game.nextWave) {
    game.nextWave=game.time+.62;
    const bonus=game.wave*150, perfect=game.flawless?game.wave*100:0;
    game.points+=bonus+perfect;
    if(game.wave%3===0) game.p.hp=Math.min(game.p.maxHp,game.p.hp+1);
    game.bolts=[];
    game.p.dash=null;
    game.buffer=null;
    game.events.push({type:'clear',wave:game.wave,bonus,perfect});
    if(game.wave%2===0) game.pendingOffer=true;
  } else if(game.time>=game.nextWave) {
    if(game.pendingOffer) {
      game.pendingOffer=false;
      game.choices=offerUpgrades(game);
      if(game.choices) { game.events.push({type:'offer'}); return; }
    }
    beginWave(game);
  }
}
