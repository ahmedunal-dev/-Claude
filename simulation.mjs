export const WIDTH = 720;
export const DASH_COOLDOWN = .39;
export const COMBO_TIME = 2.65;
const clamp = (n, low, high) => Math.max(low, Math.min(high,n));
const length = (x,y) => Math.hypot(x,y);
const distance = (a,b) => length(a.x-b.x,a.y-b.y);
const stats = {
  chaser:{r:16,hp:1,speed:117,value:100,color:'#ff7083'},
  shooter:{r:18,hp:1,speed:87,value:150,color:'#cba3ff'},
  charger:{r:21,hp:2,speed:89,value:240,color:'#ffc075'},
  boss:{r:34,hp:6,speed:72,value:720,color:'#ff7083'}
};
export function createArena(height=500, random=Math.random) {
  const game = {height,random, p:{x:WIDTH/2,y:height/2,hp:3,inv:0,angle:-Math.PI/2,cd:0},
    enemies:[], bolts:[], events:[], hits:0, peak:1, combo:1, comboTime:0, points:0, wave:0, nextWave:0, time:0, over:false};
  beginWave(game);
  return game;
}
export function resizeArena(game, height) {
  const factor=height/game.height;
  game.height=height;
  for (const body of [game.p,...game.enemies,...game.bolts]) body.y*=factor;
  if (game.p.dash) game.p.dash.y*=factor;
  if (game.buffer) game.buffer.y*=factor;
}
function enemy(game,kind,x,y,warm) {
  const data=stats[kind];
  const body={kind,...data,x,y,warm,hp:data.hp+(kind==='boss'?Math.floor((game.wave-3)/3):0),
    timer:kind==='shooter'?.84+game.random()*.2:kind==='boss'?1.15:1.65, angle:0, hurt:0};
  body.maxHp=body.hp;
  game.enemies.push(body);
}
function beginWave(game) {
  game.wave++;
  game.nextWave=0;
  const h=game.height;
  game.events.push({type:'wave',wave:game.wave});
  if (game.wave===1) {
    enemy(game,'chaser',WIDTH*.26,h*.41,.32);
    enemy(game,'chaser',WIDTH*.28,h*.56,.4);
    enemy(game,'shooter',WIDTH*.75,h*.47,.48);
    return;
  }
  const bossWave=game.wave%3===0;
  if (bossWave) enemy(game,'boss',WIDTH*.5,game.p.y>h*.5?h*.21:h*.79,.65);
  const count=bossWave?Math.min(4,game.wave):Math.min(10,game.wave+3);
  const offset=game.random()*Math.PI*2;
  for (let i=0;i<count;i++) {
    const direction=offset+i*Math.PI*2/count;
    const x=WIDTH*.5+Math.cos(direction)*WIDTH*.375;
    const y=h*.5+Math.sin(direction)*h*.36;
    const kind=i%4===1?'shooter':game.wave>3&&i%4===3?'charger':'chaser';
    enemy(game,kind,x,y,.44+i*.07);
  }
}
export function aim(game,x,y) {
  const p=game.p;
  if (game.over || length(x-p.x,y-p.y)<8) return false;
  game.buffer={x,y,time:game.time+.22};
  return launch(game);
}
function launch(game) {
  const p=game.p, target=game.buffer;
  if (!target || p.cd>0 || p.dash) return false;
  game.buffer=null;
  const dx=target.x-p.x, dy=target.y-p.y, dist=length(dx,dy);
  if (dist<8) return false;
  const reach=Math.min(325,Math.max(60,dist));
  const x=clamp(p.x+dx/dist*reach,26,WIDTH-26);
  const y=clamp(p.y+dy/dist*reach,26,game.height-26);
  if (length(x-p.x,y-p.y)<6) return false;
  p.dash={x,y,hit:new Set()};
  p.angle=Math.atan2(y-p.y,x-p.x);
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
  game.combo=Math.min(8,1+Math.floor(game.hits/2));
  game.peak=Math.max(game.peak,game.combo);
  game.comboTime=COMBO_TIME;
  const score=value*game.combo;
  game.points+=score;
  game.events.push({type:'score',x,y,score,color,combo:game.combo});
}
function hitEnemy(game,e,damage,reflected=false) {
  e.hp=Math.max(0,e.hp-damage);
  e.hurt=.17;
  hitScore(game,e.hp?35:e.value,e.x,e.y,reflected?'#75f0df':e.color);
}
function hitPlayer(game,x,y) {
  const p=game.p;
  if (p.inv>0 || game.over || p.dash) return;
  p.hp--;
  p.inv=1.05;
  game.combo=1;
  game.hits=0;
  game.comboTime=0;
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
  for (const e of game.enemies) {
    if(e.hp<=0||dash.hit.has(e)||!rayHit(from,p,e.x,e.y,e.r+13)) continue;
    dash.hit.add(e);
    hitEnemy(game,e,1);
  }
  for (const b of game.bolts) {
    if (b.friendly||b.dead||!rayHit(from,p,b.x,b.y,22)) continue;
    parry(game,b);
  }
  if (step>=1) {
    p.dash=null;
    p.cd=dash.hit.size || dash.parried ? .22 : DASH_COOLDOWN;
  }
}
function parry(game,b) {
  b.friendly=true;
  if (game.p.dash) game.p.dash.parried=true;
  const target=b.owner.hp>0?b.owner:game.enemies.find(e=>e.hp>0);
  const angle=target?Math.atan2(target.y-b.y,target.x-b.x):Math.atan2(-b.vy,-b.vx);
  b.vx=Math.cos(angle)*598;
  b.vy=Math.sin(angle)*598;
  b.ttl=1.5;
  hitScore(game,60,b.x,b.y,'#75f0df');
  game.events.push({type:'parry',x:b.x,y:b.y});
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
    if((e.kind==='shooter'||e.kind==='boss') && e.timer<=0) {
      if (e.kind==='boss') {
        const lanes=6+Math.min(4,Math.floor(game.wave/3));
        for(let i=0;i<lanes;i++) shoot(game,e,e.angle+i*Math.PI*2/lanes,245+game.wave*4);
        e.timer=Math.max(.77,1.52-game.wave*.035);
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
  for(const b of game.bolts) {
    if (b.dead) continue;
    const from={x:b.x,y:b.y};
    b.x+=b.vx*dt;
    b.y+=b.vy*dt;
    b.ttl-=dt;
    if(b.x<0||b.x>WIDTH||b.y<0||b.y>game.height||b.ttl<=0) {b.dead=true;continue;}
    if (b.friendly) {
      const target=game.enemies.find(e=>e.hp>0&&e.warm<=0&&rayHit(from,b,e.x,e.y,e.r+6));
      if (target) {hitEnemy(game,target,2,true); b.dead=true;}
    } else if (rayHit(from,b,game.p.x,game.p.y,16)) {
      if (game.p.dash) parry(game,b);
      else { hitPlayer(game,b.x,b.y); b.dead=true; }
    }
  }
}
export function tick(game,dt) {
  if(game.over) return;
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
    game.points+=game.wave*150;
    if(game.wave%3===0) game.p.hp=Math.min(3,game.p.hp+1);
    game.bolts=[];
    game.events.push({type:'clear',wave:game.wave});
  } else if(game.time>=game.nextWave) beginWave(game);
}
