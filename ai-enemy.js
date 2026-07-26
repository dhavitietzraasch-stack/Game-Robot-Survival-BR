/* ============================================================
   SIGNAL LOST — ai-enemy.js  v2.0
   IA dos Inimigos: teleporte corrigido, pathfinding, combate
   Carregado ANTES de game.js
   ============================================================ */
'use strict';

const AI_ENEMY = {
  TELEPORT_MIN_DIST: 50 * 32,   // só teleporta se > 40 tiles do player
  SPAWN_MIN:         10,         // anel de reposicionamento mín (tiles)
  SPAWN_MAX:         16,         // anel de reposicionamento máx (tiles)
  TELEPORT_CD:       420,        // 7s de cooldown individual
  SEP_FORCE:         0.65,
  SEP_FULL_LIMIT:    30,
  SHOOT_COOLDOWN_BASE: { SCOUT:75, FLYER:85, TURRET:44, SPECTER:55, BOMBER:95, ELITE:45, NECRO:60 },
  // ── Group AI ─────────────────────────────────────────────────
  GROUP_SIZE: 3,                   // tamanho médio de grupos
  LEADER_CHANCE: 0.15,            // chance de um inimigo ser líder
  LEADER_BUFF_RANGE: 200,         // alcance de buff do líder
  FOLLOWER_DIST: 80,              // distância ideal de seguidor do líder
  COORDINATION_CD: 180,           // cooldown para ataques coordenados
};

function isTileSafeForEnemy(tx,ty){
  if(!inBounds(tx,ty)) return false;
  const t=getTile(tx,ty);
  return !SOLID.has(t) && t!==8/*LAVA*/ && t!==1/*DEEP_WATER*/ && t!==0/*AIR*/;
}

function findEnemyRespawnNearPlayer(){
  const ptx=Math.floor(robot.x/TILE), pty=Math.floor(robot.y/TILE);
  const minR=AI_ENEMY.SPAWN_MIN, maxR=AI_ENEMY.SPAWN_MAX;
  for(let a=0;a<32;a++){
    const ang=Math.random()*Math.PI*2;
    const r=minR+Math.random()*(maxR-minR);
    const tx=Math.round(ptx+Math.cos(ang)*r);
    const ty=Math.round(pty+Math.sin(ang)*r);
    if(isTileSafeForEnemy(tx,ty)) return{tx,ty};
  }
  for(let r=minR;r<=maxR+4;r++)
    for(let dx=-r;dx<=r;dx++)
      for(let dy=-r;dy<=r;dy++){
        if(Math.abs(dx)!==r&&Math.abs(dy)!==r) continue;
        const tx=clamp(ptx+dx,2,WORLD_W-3), ty=clamp(pty+dy,2,WORLD_H-3);
        if(isTileSafeForEnemy(tx,ty)) return{tx,ty};
      }
  return null;
}

// ─── Assign AI roles to enemies ─────────────────────────────────
function assignEnemyRole(e){
  if(!e) return;
  
  // Elite enemies are always leaders
  if(e.type === 'ELITE' || e.type === 'NECRO'){
    e.role = 'leader';
    return;
  }
  
  // Random chance for other enemies to be leaders
  if(Math.random() < AI_ENEMY.LEADER_CHANCE){
    e.role = 'leader';
    return;
  }
  
  // Assign specialized roles based on enemy type
  const roles = ['follower', 'scout', 'tank', 'standard'];
  const weights = [0.4, 0.2, 0.15, 0.25]; // follower most common
  
  // Type-specific role preferences
  if(e.type === 'SCOUT'){
    e.role = 'scout';
  } else if(e.type === 'TANK'){
    e.role = 'tank';
  } else if(e.type === 'FLYER'){
    e.role = 'scout';
  } else {
    // Random role based on weights
    const rand = Math.random();
    let cumulative = 0;
    for(let i = 0; i < roles.length; i++){
      cumulative += weights[i];
      if(rand < cumulative){
        e.role = roles[i];
        break;
      }
    }
    if(!e.role) e.role = 'standard';
  }
}

// ─── Form enemy groups ───────────────────────────────────────────
function formEnemyGroup(){
  // Find a leader
  const leaders = enemies.filter(e => !e.dead && e.role === 'leader');
  if(leaders.length === 0) return;
  
  const leader = leaders[Math.floor(Math.random() * leaders.length)];
  
  // Assign nearby enemies as followers
  for(const e of enemies){
    if(e.dead || e === leader || e.role === 'leader') continue;
    const dx = e.x - leader.x;
    const dy = e.y - leader.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    if(dist < AI_ENEMY.LEADER_BUFF_RANGE * 1.5 && Math.random() < 0.6){
      e.role = 'follower';
      e.leader = leader;
    }
  }
}

function updateEnemyMovement(e){
  const dx=robot.x-e.x, dy=robot.y-e.y;
  const d=Math.sqrt(dx*dx+dy*dy)||1;
  const phasing=(e.type==='SPECTER'||e.flying);
  const speedMult=e.slowTimer>0?0.3:1.0;
  
  // ── Role-based behavior ─────────────────────────────────────
  const role = e.role || 'standard';
  
  // Leader behavior: stays back, coordinates
  if(role === 'leader'){
    // Leaders maintain distance from player to direct followers
    const idealDist = 250;
    if(d < idealDist){
      // Too close, back away
      e.vx -= (dx/d) * 0.15;
      e.vy -= (dy/d) * 0.15;
    }
  }
  
  // Follower behavior: sticks near leader
  if(role === 'follower' && e.leader){
    const leader = e.leader;
    if(!leader.dead){
      const ldx = leader.x - e.x;
      const ldy = leader.y - e.y;
      const ld = Math.sqrt(ldx*ldx + ldy*ldy) || 1;
      
      // Maintain ideal distance from leader
      if(ld > AI_ENEMY.FOLLOWER_DIST * 1.5){
        // Too far from leader, move towards leader
        e.vx += (ldx/ld) * 0.12;
        e.vy += (ldy/ld) * 0.12;
      } else if(ld < AI_ENEMY.FOLLOWER_DIST * 0.5){
        // Too close to leader, move away
        e.vx -= (ldx/ld) * 0.08;
        e.vy -= (ldy/ld) * 0.08;
      }
    }
  }
  
  // Scout behavior: circles player, finds weak points
  if(role === 'scout'){
    const angle = Math.atan2(dy, dx);
    const circleAngle = angle + Math.PI/4; // Circle around player
    e.vx += Math.cos(circleAngle) * 0.08;
    e.vy += Math.sin(circleAngle) * 0.08;
  }
  
  // Tank behavior: moves aggressively toward player
  if(role === 'tank'){
    e.vx += (dx/d) * 0.15;
    e.vy += (dy/d) * 0.15;
  }

  // ── Efeitos de bioma nos inimigos ──────────────────────────
  if(!phasing && typeof BIOME_FX!=='undefined'){
    const etx=Math.floor(e.x/TILE),ety=Math.floor(e.y/TILE);
    if(typeof inBounds==='function'&&inBounds(etx,ety)){
      const tile=typeof getTile==='function'?getTile(etx,ety):0;
      const fx=BIOME_FX[tile];
      if(fx){
        // Lava e tóxico danificam inimigos também
        if(fx.dmg&&!e._biomeDmgCd){
          e.hp=Math.max(0,e.hp-fx.dmg*0.4);
          e.flashTimer=3;
          e._biomeDmgCd=8;
          if(e.hp<=0&&!e.dead){
            e.dead=true;
            if(typeof score!=='undefined') score+=e.score;
            if(typeof spawnBurst==='function') spawnBurst(e.x,e.y,e.col,10,3);
            if(typeof spawnXPOrb==='function') spawnXPOrb(e.x,e.y,e.xp||e.score);
          }
        }
        if(e._biomeDmgCd>0) e._biomeDmgCd--;
        // Gelo: inimigos ficam mais lentos ainda mais
        if(tile===9/*ICE*/&&!phasing) e.vx*=0.92,e.vy*=0.92;
        // Pântano: pequena redução de velocidade
        if(tile===20/*SWAMP*/||tile===21/*TOXIC*/) e.vx*=0.97,e.vy*=0.97;
        // Neve: levemente mais devagar
        if(tile===7/*SNOW*/||tile===24/*TUNDRA*/) e.vx*=0.98,e.vy*=0.98;
      }
    }
  }

  // Teleporte apenas se muito longe e não é phasing
  e._tcd=(e._tcd||0);
  if(e._tcd>0) e._tcd--;
  if(!phasing && e._tcd<=0 && d>AI_ENEMY.TELEPORT_MIN_DIST){
    const dest=findEnemyRespawnNearPlayer();
    if(dest){
      e.x=(dest.tx+.5)*TILE; e.y=(dest.ty+.5)*TILE;
      e.vx=0; e.vy=0;
      e._tcd=AI_ENEMY.TELEPORT_CD;
      spawnParticle(e.x,e.y,0,-1,15,e.col,3);
    }
    return;
  }

  // Pathfinding
  let mvx,mvy;
  if(phasing){ mvx=dx/d; mvy=dy/d; }
  else{
    const ff=flowDir(e.x,e.y);
    mvx=ff.dx; mvy=ff.dy;
    if(mvx===0&&mvy===0){mvx=dx/d;mvy=dy/d;}
  }
  
  // Apply leader buff to speed
  let speedMultFinal = speedMult;
  if(e._leaderBuff) speedMultFinal *= 1.2;
  
  e.vx+=mvx*e.speed*0.10*speedMultFinal;
  e.vy+=mvy*e.speed*0.10*speedMultFinal;
  e.vx*=0.88; e.vy*=0.88;

  // Separação
  const onSc=Math.abs(e.x-cam.x)<W*2&&Math.abs(e.y-cam.y)<H*2;
  if(onSc||enemies.length<AI_ENEMY.SEP_FULL_LIMIT){
    const lim=(e.size+32)*1.5, lim2=lim*lim;
    for(const f of enemies){
      if(f===e||f.dead)continue;
      const fx2=e.x-f.x,fy2=e.y-f.y,fd2=fx2*fx2+fy2*fy2;
      if(fd2<lim2&&fd2>0){
        const fd=Math.sqrt(fd2),minD=(e.size+f.size)*1.5;
        if(fd<minD){e.vx+=fx2/fd*AI_ENEMY.SEP_FORCE;e.vy+=fy2/fd*AI_ENEMY.SEP_FORCE;}
      }
    }
  }

  e.x+=e.vx; e.y+=e.vy;

  // Colisão com paredes — sem atravessar cantos
  if(!phasing){
    const etx=Math.floor(e.x/TILE),ety=Math.floor(e.y/TILE);
    if(inBounds(etx,ety)&&SOLID.has(getTile(etx,ety))){
      const px=e.x-e.vx,py=e.y-e.vy;
      const ptx2=Math.floor(px/TILE),pty2=Math.floor(py/TILE);
      if(!SOLID.has(getTile(ptx2,ety))){e.x=px;e.vx=0;}
      else if(!SOLID.has(getTile(etx,pty2))){e.y=py;e.vy=0;}
      else{e.x=px;e.y=py;e.vx=(Math.random()-.5)*.5;e.vy=(Math.random()-.5)*.5;}
    }
    // Armadilhas
    const ut=getTile(Math.floor(e.x/TILE),Math.floor(e.y/TILE));
    if(ut===27/*TRAP_SLOW*/){e.slowTimer=45;spawnParticle(e.x,e.y,0,-.5,20,'#38bdf8',3);}
    if(ut===28/*TRAP_DAMAGE*/){
      e.hp-=0.8;e.flashTimer=4;
      if(Math.random()<.08)spawnParticle(e.x,e.y,(Math.random()-.5)*2,-1,15,'#ef4444',3);
      if(e.hp<=0&&!e.dead){e.dead=true;score+=e.score;spawnBurst(e.x,e.y,e.col,10,3);spawnXPOrb(e.x,e.y,e.xp||e.score);}
    }
    if(ut===29/*SPIKE_BLOCK*/){
      e.hp-=2.5;e.flashTimer=6;
      spawnParticle(e.x,e.y,(Math.random()-.5)*2,-1.5,18,'#ef4444',3);
      if(e.hp<=0&&!e.dead){e.dead=true;score+=e.score;spawnBurst(e.x,e.y,e.col,10,3);spawnXPOrb(e.x,e.y,e.xp||e.score);}
    }
  }
}


// ─── Ataques especiais de chefe ──────────────────────────────
// Cada chefe tem um bossPattern definido no spawn (game.js:spawnBoss):
//   'ring'   → rajada radial de projéteis em todas as direções
//   'summon' → invoca inimigos menores como reforço
//   'charge' → investida rápida na direção do jogador
function bossSpecialAttack(e){
  if(!e || e.dead) return;
  if(typeof spawnBurst==='function') spawnBurst(e.x,e.y,'#fff',12,3);

  if(e.bossPattern==='ring'){
    const N=12;
    for(let i=0;i<N;i++){
      const a=(Math.PI*2/N)*i;
      const tx=e.x+Math.cos(a)*160, ty=e.y+Math.sin(a)*160;
      if(typeof spawnProjectile==='function') spawnProjectile(e.x,e.y,tx,ty,'void_bolt',true);
    }
    if(typeof showAlert==='function') showAlert('⚠ RAJADA RADIAL DO CHEFE!');
  } else if(e.bossPattern==='summon'){
    const stx=Math.floor(e.x/TILE), sty=Math.floor(e.y/TILE);
    const n=2+Math.floor(Math.random()*2);
    for(let i=0;i<n;i++){
      if(typeof spawnEnemy==='function'){
        const t=Math.random()<0.5?'SCOUT':'SWARM';
        spawnEnemy(t, stx+Math.floor(Math.random()*5-2), sty+Math.floor(Math.random()*5-2), 0.85);
      }
    }
    if(typeof showAlert==='function') showAlert('⚠ CHEFE INVOCA REFORÇOS!');
  } else if(e.bossPattern==='charge'){
    if(typeof robot!=='undefined' && robot){
      const dx=robot.x-e.x, dy=robot.y-e.y, d=Math.sqrt(dx*dx+dy*dy)||1;
      e.vx += (dx/d)*9; e.vy += (dy/d)*9;
    }
    if(typeof showAlert==='function') showAlert('⚠ INVESTIDA DO CHEFE!');
  }
}

// Verifica se há linha de visão entre dois pontos (sem paredes sólidas no caminho)
function hasLineOfSight(x1, y1, x2, y2){
  const steps = Math.ceil(Math.hypot(x2-x1, y2-y1) / TILE);
  if(steps === 0) return true;
  for(let i=1; i<steps; i++){
    const t = i/steps;
    const px = x1 + (x2-x1)*t;
    const py = y1 + (y2-y1)*t;
    const tx = Math.floor(px/TILE), ty = Math.floor(py/TILE);
    if(inBounds(tx,ty) && SOLID.has(getTile(tx,ty))) return false;
  }
  return true;
}

function enemyShootRange(e){ return e.elite?450:380; }

function updateEnemyShooting(e,d,dx,dy){
  const can=e.type==='SCOUT'||e.type==='FLYER'||e.type==='TURRET'||
            e.type==='SPECTER'||e.type==='BOMBER'||e.type==='ELITE'||
            e.type==='NECRO'||e.boss;
  if(!can) return;
  e.shootCooldown--;
  const range=enemyShootRange(e);
  if(e.shootCooldown>0||d>=range) return;
  // Verificar linha de visão (phasing/void_shade ignoram paredes)
  const isPhasing=(e.type==='SPECTER'||e.flying);
  if(!isPhasing && !hasLineOfSight(e.x, e.y, robot.x, robot.y)) return;
  switch(e.type){
    case'BOMBER': spawnProjectile(e.x,e.y,robot.x,robot.y,'grenade',true); e.shootCooldown=100; break;
    case'ELITE':
      for(let si=-1;si<=1;si++){const ba=Math.atan2(dy,dx)+si*.2;spawnProjectile(e.x,e.y,e.x+Math.cos(ba)*100,e.y+Math.sin(ba)*100,'enemy',true);}
      e.shootCooldown=50; break;
    default:
      spawnProjectile(e.x,e.y,robot.x,robot.y,'enemy',true);
      e.shootCooldown=e.type==='TURRET'?48:e.type==='SPECTER'?60:80;
  }
}

// ─── Reação dos inimigos ao teleporte do jogador ──────────────
// Se o teleporte deixa o jogador a menos da metade do alcance de tiro de um
// inimigo, esse inimigo fica "perdido": continua se movendo normalmente
// (updateEnemyMovement não é afetado), mas leva 1s pra conseguir disparar de
// novo — sem nenhum efeito visual (sem flash, sem partícula, sem alerta).
// É só um atraso silencioso injetado no cooldown de disparo de cada um.
const AI_ENEMY_LOST_SHOOT_DELAY = 60; // 1s a 60fps

function aiEnemyOnPlayerTeleport(){
  for(const e of enemies){
    if(e.dead) continue;
    const range=enemyShootRange(e);
    const d=Math.hypot(robot.x-e.x,robot.y-e.y);
    if(d<range/2) e.shootCooldown=Math.max(e.shootCooldown||0,AI_ENEMY_LOST_SHOOT_DELAY);
  }
}

// Esta função é registrada como `updateEnemies` no game.js via patch
function updateEnemiesAI(){
  // BUG FIX: formEnemyGroup nunca era chamada — Group AI estava 100% inativa
  // Reagrupar a cada ~5s (300 frames) quando há inimigos suficientes
  if(typeof time !== 'undefined' && time % 300 === 0 && enemies.length >= 3){
    formEnemyGroup();
  }

  // ── Group coordination ───────────────────────────────────────
  // Apply leader buffs to nearby followers
  for(const e of enemies){
    if(e.dead) continue;
    if(e.role === 'leader'){
      // Buff nearby followers
      for(const other of enemies){
        if(other.dead || other === e) continue;
        const dx = other.x - e.x;
        const dy = other.y - e.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if(dist < AI_ENEMY.LEADER_BUFF_RANGE && other.role === 'follower'){
          // Apply buff: +20% speed, +10% damage
          other._leaderBuff = true;
          other._buffTimer = 5; // frames
        }
      }
    }
  }
  
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    if(e.dead){
      if(e.boss && typeof onBossDefeated==='function') onBossDefeated(e);
      enemies.splice(i,1);continue;
    }
    if(e.flashTimer>0)e.flashTimer--;
    if(e.slowTimer>0)e.slowTimer--;
    if(e._buffTimer > 0) e._buffTimer--;
    else e._leaderBuff = false;
    
    // Summoner
    if(e.summoner){
      e.summonTimer=(e.summonTimer||0)+1;
      if(e.summonTimer>=300){
        e.summonTimer=0;
        spawnEnemy('SCOUT',Math.floor(e.x/TILE)+Math.floor(Math.random()*3-1),Math.floor(e.y/TILE)+Math.floor(Math.random()*3-1),.8);
        spawnBurst(e.x,e.y,'#6d28d9',8,2);
      }
    }

    // Chefe: dispara seu padrão de ataque especial periodicamente
    if(e.boss){
      e._bossSpecialTimer=(e._bossSpecialTimer||0)+1;
      if(e._bossSpecialTimer>=(e.bossSpecialCD||190)){
        e._bossSpecialTimer=0;
        bossSpecialAttack(e);
      }
    }
    
    const dx=robot.x-e.x,dy=robot.y-e.y,d=Math.sqrt(dx*dx+dy*dy)||1;
    if(e.type!=='TURRET') updateEnemyMovement(e);
    e.angle=Math.atan2(dy,dx);
    updateEnemyShooting(e,d,dx,dy);
    
    // Melee with leader buff bonus
    let meleeDmg = e.dmg;
    if(e._leaderBuff) meleeDmg *= 1.1;
    
    if(d<robot.radius+e.size+2&&robot.invTimer<=0){
      const dmgTaken=meleeDmg*.05*getUpgradeValue('armor');
      robot.hp=Math.max(0,robot.hp-dmgTaken);
      if(typeof rogueOnRobotDamage==='function') rogueOnRobotDamage(dmgTaken);
      robot.invTimer=15;
      // Espinhos: reflete parte do dano de contato de volta ao inimigo
      const thorns=(typeof ROGUE!=='undefined'&&ROGUE.mods.thornsPct)||0;
      if(thorns>0){
        e.hp-=meleeDmg*thorns;
        e.flashTimer=4;
        if(e.hp<=0&&!e.dead){
          e.dead=true;
          if(typeof score!=='undefined') score+=e.score;
          if(typeof spawnBurst==='function') spawnBurst(e.x,e.y,e.col||'#fbbf24',10,3);
          if(typeof spawnXPOrb==='function') spawnXPOrb(e.x,e.y,e.xp||e.score);
        }
      }
    }
  }
  
  // ── Coordinated attacks ───────────────────────────────────────
  // Groups of followers attack together when leader signals
  for(const e of enemies){
    if(e.dead || e.role !== 'leader') continue;
    e._coordTimer = (e._coordTimer || 0) + 1;
    if(e._coordTimer >= AI_ENEMY.COORDINATION_CD){
      e._coordTimer = 0;
      // Signal followers to attack
      for(const other of enemies){
        if(other.dead || other === e || other.role !== 'follower') continue;
        const dx = other.x - e.x;
        const dy = other.y - e.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if(dist < AI_ENEMY.LEADER_BUFF_RANGE){
          // Reduce cooldown for coordinated attack
          other.shootCooldown = Math.max(0, (other.shootCooldown || 0) - 30);
          spawnParticle(other.x, other.y, 0, -1, 8, '#ff6b6b', 2);
        }
      }
    }
  }
}
