// Run: node tests/simulation.test.mjs — a bot plays many rounds to catch crashes and NaNs.
import {createArena,tick,aim,chooseUpgrade,UPGRADES,speedBoost} from '../simulation.mjs';
import assert from 'node:assert/strict';

let seed=1;
const rand=()=>((seed=(seed*16807)%2147483647)-1)/2147483646;
let maxWave=0, totalUpgrades=0;
const kinds=new Set();
let armored=0;
for (let run=0; run<30; run++) {
  const game=createArena(500,rand);
  for (let t=0; t<90*400 && !game.over; t++) {
    if (game.choices) { totalUpgrades++; assert.ok(chooseUpgrade(game,game.choices[Math.floor(rand()*game.choices.length)])); }
    const target=game.bolts.find(b=>!b.friendly) || game.enemies[0];
    if (target && rand()<.3) aim(game,target.x,target.y);
    tick(game,1/90);
    if (run%2) game.p.hp=game.p.maxHp; // every other bot is immortal so late waves get covered
    armored+=game.enemies.filter(e=>e.armor).length;
    game.enemies.forEach(e=>kinds.add(e.kind));
    for (const body of [game.p,...game.enemies,...game.bolts]) assert.ok(Number.isFinite(body.x)&&Number.isFinite(body.y),'position NaN');
    assert.ok(game.p.hp<=game.p.maxHp);
    for (const [id,n] of Object.entries(game.taken)) assert.ok(n<=UPGRADES[id].max);
    game.events.length=0;
  }
  maxWave=Math.max(maxWave,game.wave);
}
assert.ok(totalUpgrades>0,'upgrades offered');
assert.ok(maxWave>=30,'late waves reached');
assert.ok(armored>0,'armored enemies spawned');
for (let w=1; w<120; w++) assert.ok(speedBoost(w+1)>=speedBoost(w),'enemy speed never drops');
assert.ok(speedBoost(100)>speedBoost(60),'enemy speed keeps rising late');
for (const k of ['splitter','mini','bomber','boss']) assert.ok(kinds.has(k),k+' spawned');
console.log('ok — max wave',maxWave,'upgrades',totalUpgrades,'kinds',[...kinds].join(','));
