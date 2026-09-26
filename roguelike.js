/* ============================================================
   SIGNAL LOST — roguelike.js  v1.0
   Sistema "Action Roguelike": ao limpar cada onda, o jogo pausa e
   oferece 3 chips de upgrade (emoji + descrição). O jogador escolhe
   apenas 1 por onda. Alguns chips têm um efeito temporário/condicional
   (ex: Overclock ao tomar dano em um bioma específico) explicado numa
   segunda linha, abaixo da descrição principal.

   Carregado DEPOIS de game.js (usa T, DIM, robot, TILE, ctx, W, H,
   getTile, addPause/removePause, showAlert, spawnBurst,
   roundRect — todos definidos em game.js/biomes.js).
   ============================================================ */
'use strict';

// ─── Estado global do sistema roguelike ─────────────────────────
const ROGUE = {
  screenOpen: false,     // true enquanto a tela de escolha de chip está aberta
  choices: [],           // os 3 chips sorteados nesta tela
  pickedIds: new Set(),  // ids de chips não-repetíveis já escolhidos nesta run
  pickedCounts: {},      // {chipId: vezes escolhido} — usado para limitar chips repetíveis (ver maxStacks)
  history: [],           // títulos escolhidos (debug/HUD futuro)
  shieldCharges: 0,      // cargas do "Escudo de Emergência" disponíveis na onda atual

  // Overclock: buff temporário disparado por chips do tipo "proc" (dano em bioma X)
  overclock: { active:false, timer:0, dmgMult:1.25, cooldownMult:0.75 },

  procCooldowns: {},     // {chipId: framesRestantes} — evita spam de proc

  // Modificadores acumulados pelos chips escolhidos. Sempre neutros (1 ou 0)
  // até o jogador escolher algo — lidos por getUpgradeValue()/updateAutoWeapons()
  // em game.js (com fallback seguro caso este arquivo não tenha carregado).
  mods: {
    maxHpBonus:0, maxEnergyBonus:0, maxHeatBonus:0,
    armorMult:1, speedMult:1, regenBonus:0, energyRegenMult:1,
    critChanceBonus:0, critMultBonusAdd:0, cooldownMult:1,
    dmgMult:1, xpGainMult:1, heatGainMult:1,
    // ── Novos mods (v1.1) ────────────────────────────────────
    blastMult:1,       // multiplicador de raio de explosão (foguete/granada)
    teleportCdMult:1,  // multiplicador do cooldown do teleporte (tecla F)
    lifestealPct:0,    // % do dano causado que retorna como cura
    xpPullMult:1,      // multiplicador da velocidade de atração dos orbs de XP
    xpRadiusBonus:0,   // px extras no raio magnético de coleta dos orbs
    biomeDmg: {},     // {chipId:{tiles:[...], dim?:Number, mult:Number}}
    biomeProcs: [],   // [{id, tiles:[...], dim?:Number, effect:'overclock', duration, cooldown, label}]
    // ── Novos mods (v1.2) ────────────────────────────────────
    energyDrainMult:1,      // multiplicador do consumo de energia ao mover
    passiveHeatDown:0,      // dissipação passiva de calor por frame (fora de bioma)
    buildCostMult:1,        // multiplicador do custo de energia ao construir blocos
    thornsPct:0,            // % do dano de contato corpo-a-corpo refletido ao inimigo
    shieldChargesPerWave:0, // cargas extras de Escudo de Emergência concedidas a cada onda
  },

  // Protocolo Fênix (chip "second_wind"): true = pronto para disparar nesta onda
  secondWindReady: false,

  _chipBounds: [],      // bounding boxes dos 3 cards (preenchido em drawRogueChips)

  // ── Reload de opções (reroll) gastando XP ─────────────────────
  // seenIds acumula TODOS os ids já mostrados nesta tela (sorteio inicial +
  // cada reload), garantindo 0% de chance de repetição a cada reload.
  // Escopo por tela: resetado sempre que uma nova tela de chips abre.
  seenIds: new Set(),
  rerollCount: 0,        // quantos reloads já foram usados nesta tela
  _rerollBounds: null,   // bounding box do botão de reload (preenchido em drawRogueChips)
};

function resetRogue(){
  ROGUE.screenOpen=false;
  ROGUE.choices=[];
  ROGUE.pickedIds.clear();
  ROGUE.pickedCounts={};
  ROGUE.history=[];
  ROGUE.shieldCharges=0;
  ROGUE.overclock.active=false; ROGUE.overclock.timer=0;
  ROGUE.procCooldowns={};
  const m=ROGUE.mods;
  m.maxHpBonus=0; m.maxEnergyBonus=0; m.maxHeatBonus=0;
  m.armorMult=1; m.speedMult=1; m.regenBonus=0; m.energyRegenMult=1;
  m.critChanceBonus=0; m.critMultBonusAdd=0; m.cooldownMult=1;
  m.dmgMult=1; m.xpGainMult=1; m.heatGainMult=1;
  m.blastMult=1; m.teleportCdMult=1; m.lifestealPct=0;
  m.xpPullMult=1; m.xpRadiusBonus=0;
  m.biomeDmg={}; m.biomeProcs=[];
  m.energyDrainMult=1; m.passiveHeatDown=0; m.buildCostMult=1;
  m.thornsPct=0; m.shieldChargesPerWave=0;
  ROGUE.secondWindReady=false;
  ROGUE._chipBounds=[];
  ROGUE.seenIds=new Set();
  ROGUE.rerollCount=0;
  ROGUE._rerollBounds=null;
}

// ─── Grupos de bioma usados pelos chips condicionais ────────────
function ROGUE_BIOMES(){
  return {
    lava:  { label:'Vulcânico',       icon:'🌋', tiles:[T.LAVA,T.VOLCANIC_ASH,T.MAGMA_ROCK] },
    ice:   { label:'Gelo / Neve',     icon:'❄️', tiles:[T.ICE,T.SNOW,T.TUNDRA] },
    toxic: { label:'Tóxico / Pântano',icon:'☣️', tiles:[T.TOXIC,T.SWAMP] },
    water: { label:'Aquático',        icon:'🌊', tiles:[T.WATER,T.DEEP_WATER,T.CORAL] },
    rock:  { label:'Rochoso/Mineral', icon:'⛰️', tiles:[T.ROCK,T.STONE,T.IRON,T.OBSIDIAN,T.CRYSTAL] },
    grass: { label:'Campo/Floresta',  icon:'🌿', tiles:[T.GRASS,T.FOREST,T.SAVANNA] },
  };
}

function _rogueTileMatches(entry, tile){
  return !!(entry.tiles && entry.tiles.includes(tile));
}

// ─── Raridade ──────────────────────────────────────────────────
// Peso usado no sorteio ponderado das 3 opções na tela de chip.
// Chips sem campo `rarity` são tratados como 'comum' (retrocompatível).
const RARITY_WEIGHTS = { comum:10, raro:5, epico:2, lendario:1 };
function rogueRarityWeight(chip){
  return RARITY_WEIGHTS[chip.rarity] || RARITY_WEIGHTS.comum;
}

// ─── Pool de chips disponíveis ───────────────────────────────────
// repeatable:true  → chip genérico de stat, pode reaparecer/ser escolhido várias vezes
// repeatable:false → efeito único, some do pool depois de escolhido uma vez
const CHIP_POOL = [
  // ── Stats simples (repetíveis, sem limite — crescimento linear/seguro) ──
  { id:'hp_up', emoji:'❤️', title:'Blindagem Extra', repeatable:true,
    desc:'+25 de Vida máxima. Cura instantaneamente a diferença.',
    apply(){ ROGUE.mods.maxHpBonus+=25; if(typeof applyPassiveBonuses==='function') applyPassiveBonuses(); robot.hp=Math.min(robot.maxHp, robot.hp+25); } },

  { id:'energy_up', emoji:'🔋', title:'Bateria Auxiliar', repeatable:true,
    desc:'+20 de Energia máxima.',
    apply(){ ROGUE.mods.maxEnergyBonus+=20; if(typeof applyPassiveBonuses==='function') applyPassiveBonuses(); robot.energy=Math.min(robot.maxEnergy, robot.energy+20); } },

  { id:'heat_up', emoji:'🧊', title:'Dissipador Reforçado', repeatable:true,
    desc:'+20 de resistência ao Calor máximo.',
    apply(){ ROGUE.mods.maxHeatBonus+=20; if(typeof applyPassiveBonuses==='function') applyPassiveBonuses(); } },

  { id:'regen_up', emoji:'💉', title:'Nanite Regenerativo', repeatable:true,
    desc:'+0.08 de regeneração de vida por segundo.',
    apply(){ ROGUE.mods.regenBonus+=0.08; } },

  { id:'xp_gain_up', emoji:'📡', title:'Amplificador de Sinal', repeatable:true,
    desc:'+20% de XP ganho de todo inimigo abatido.',
    apply(){ ROGUE.mods.xpGainMult*=1.20; } },

  // ── Stats multiplicativos (repetíveis, COM limite de compra —
  // sem isso a multiplicação em cadeia quebra o balanceamento em runs longas) ──
  { id:'armor_up', emoji:'🛡️', title:'Placas de Blindagem', repeatable:true, maxStacks:8,
    desc:'-12% de dano recebido de qualquer fonte.',
    apply(){ ROGUE.mods.armorMult*=0.88; } },

  { id:'speed_up', emoji:'💨', title:'Motores Turbo', repeatable:true, maxStacks:5,
    desc:'+15% de velocidade de movimento.',
    apply(){ ROGUE.mods.speedMult*=1.15; } },

  { id:'crit_chance_up', emoji:'🎯', title:'Mira Calibrada', repeatable:true, maxStacks:10,
    desc:'+6% de chance de acerto crítico.',
    apply(){ ROGUE.mods.critChanceBonus+=0.06; } },

  { id:'crit_mult_up', emoji:'💥', title:'Ogiva Perfurante', repeatable:true, maxStacks:8,
    desc:'+30% de dano em acertos críticos.',
    apply(){ ROGUE.mods.critMultBonusAdd+=0.30; } },

  { id:'cooldown_down', emoji:'⚙️', title:'Disparo Acelerado', repeatable:true, maxStacks:6,
    desc:'-12% no tempo de recarga das armas.',
    apply(){ ROGUE.mods.cooldownMult*=0.88; } },

  { id:'heatgain_down', emoji:'🌡️', title:'Radiador Avançado', repeatable:true, maxStacks:6,
    desc:'-15% de calor gerado ao disparar.',
    apply(){ ROGUE.mods.heatGainMult*=0.85; } },

  // ── Novos stats simples (v1.1, repetíveis) ─────────────────
  { id:'energy_regen_up', emoji:'🔌', title:'Recarregador Rápido', repeatable:true, maxStacks:6,
    desc:'+20% na taxa de regeneração de Energia.',
    apply(){ ROGUE.mods.energyRegenMult*=1.20; } },

  { id:'blast_radius_up', emoji:'💥', title:'Núcleo Expansivo', repeatable:true, maxStacks:6,
    desc:'+15% no raio de explosão de foguetes e granadas.',
    apply(){ ROGUE.mods.blastMult*=1.15; } },

  { id:'teleport_cd_down', emoji:'🌀', title:'Capacitor de Salto', repeatable:true, maxStacks:6,
    desc:'-15% no tempo de recarga do Teleporte [F].',
    apply(){ ROGUE.mods.teleportCdMult*=0.85; } },

  { id:'lifesteal_up', emoji:'🩸', title:'Nanites Vampíricos', repeatable:true, maxStacks:10,
    desc:'Cura 3% de todo dano causado como Vida.',
    apply(){ ROGUE.mods.lifestealPct+=0.03; } },

  { id:'loot_magnet_up', emoji:'🧲', title:'Coletor Otimizado', repeatable:true, maxStacks:5,
    desc:'+35% na velocidade de atração e +60px no raio magnético de coleta dos orbs de XP.',
    apply(){ ROGUE.mods.xpPullMult*=1.35; ROGUE.mods.xpRadiusBonus+=60; } },

  // ── Novos chips repetíveis (v1.2) ───────────────────────────
  { id:'energy_efficiency_up', emoji:'🔋', title:'Motor Eficiente', repeatable:true, maxStacks:6,
    desc:'-12% no consumo de energia ao se mover.',
    apply(){ ROGUE.mods.energyDrainMult*=0.88; } },

  { id:'heat_radiator_up', emoji:'🌡️', title:'Radiador Passivo', repeatable:true, maxStacks:5,
    desc:'Dissipa uma pequena quantidade de calor a cada instante, mesmo fora de biomas frios.',
    apply(){ ROGUE.mods.passiveHeatDown+=0.06; } },

  { id:'build_cost_down', emoji:'🧱', title:'Nanofabricação', repeatable:true, maxStacks:5,
    desc:'-15% no custo de energia para construir blocos.',
    apply(){ ROGUE.mods.buildCostMult*=0.85; } },

  { id:'thorns_up', emoji:'🦔', title:'Blindagem de Espinhos', repeatable:true, maxStacks:8,
    desc:'Reflete 8% do dano de contato corpo-a-corpo de volta ao inimigo.',
    apply(){ ROGUE.mods.thornsPct+=0.08; } },

  // ── Dano bônus por bioma (não-repetível, 1 por bioma) ──────
  ...['lava','ice','toxic','water','rock','grass'].map(key=>{
    const b=ROGUE_BIOMES()[key];
    return {
      id:'dmg_'+key, emoji:b.icon, title:`Sinergia: ${b.label}`, repeatable:false,
      desc:`+35% de dano enquanto estiver no bioma ${b.label}.`,
      apply(){ ROGUE.mods.biomeDmg['dmg_'+key] = { tiles:b.tiles, dim:b.dim, mult:1.35 }; },
    };
  }),

  // ── Overclock ao tomar dano em bioma específico (não-repetível) ──
  ...['lava','ice','toxic','water','rock','grass'].map(key=>{
    const b=ROGUE_BIOMES()[key];
    return {
      id:'overclock_'+key, emoji:'⚡', title:`Overclock: ${b.label}`, repeatable:false,
      desc:`Ao tomar dano estando no bioma ${b.label}, ativa OVERCLOCK.`,
      sub:'OVERCLOCK (5s): +25% de dano e -25% no tempo de recarga das armas. Efeito reutilizável a cada 6s.',
      apply(){
        ROGUE.mods.biomeProcs.push({
          id:'overclock_'+key, tiles:b.tiles, dim:b.dim,
          effect:'overclock', duration:300, cooldown:360, label:b.label,
        });
      },
    };
  }),

  // ── Mecânica única ──────────────────────────────────────────
  { id:'emergency_shield', emoji:'🪖', title:'Escudo de Emergência', repeatable:false,
    desc:'Absorve automaticamente o próximo golpe fatal.',
    sub:'Recarrega 1 carga no início de cada nova onda. Ao ativar, restaura 30% da vida máxima.',
    apply(){ ROGUE.shieldCharges=1; } },

  // ── Novos chips de risco/recompensa e mecânica única (v1.1) ──
  { id:'glass_cannon', emoji:'💎', title:'Núcleo Instável', repeatable:false,
    desc:'+30% de dano causado, mas -20 de Vida máxima.',
    sub:'Compensa a fragilidade com poder de fogo bruto. Combine com Blindagem Extra ou Placas de Blindagem para equilibrar.',
    apply(){
      ROGUE.mods.dmgMult*=1.30;
      ROGUE.mods.maxHpBonus-=20;
      if(typeof applyPassiveBonuses==='function') applyPassiveBonuses();
      robot.hp=Math.min(robot.hp, robot.maxHp);
    } },

  { id:'overdrive', emoji:'🔥', title:'Sobrecarga dos Motores', repeatable:false,
    desc:'+25% de velocidade de movimento, mas +20% de calor gerado ao disparar.',
    sub:'Ideal para builds agressivas com Radiador Avançado ou Dissipador Reforçado.',
    apply(){ ROGUE.mods.speedMult*=1.25; ROGUE.mods.heatGainMult*=1.20; } },

  { id:'second_wind', emoji:'🌟', title:'Protocolo Fênix', repeatable:false,
    desc:'Ao cair abaixo de 20% de Vida, ganha 2s de invulnerabilidade e recupera 15% da Vida máxima.',
    sub:'Uma carga por onda, reativada automaticamente ao iniciar a próxima onda.',
    apply(){ ROGUE.secondWindReady=true; } },

  { id:'reserve_shield', emoji:'🛡️', title:'Escudo Reserva', repeatable:false,
    desc:'Concede +1 carga extra de Escudo de Emergência a cada onda.',
    sub:'Funciona mesmo sem o Escudo de Emergência — sozinho, já garante 1 carga por onda.',
    apply(){ ROGUE.mods.shieldChargesPerWave+=1; } },

    { id:"high_voltage", emoji:"⚡", title:"Alta Voltagem", repeatable:true, maxStacks:3, rarity:"raro",
    desc:"+35% de XP ganho de inimigos abatidos, mas aumenta o calor gerado ao disparar em 10%.",
    sub:"Mais energia residual convertida em dados. O radiador sofrerá um pouco.",
    apply(){
      ROGUE.mods.xpGainMult *= 1.35;
      ROGUE.mods.heatGainMult *= 1.10;
    } },

  // __ADD_CHIP_ANCHOR__ (não remova este comentário — scripts/add-chip.js insere novos chips logo acima dele)
];

// ─── Hooks chamados por game.js / biomes.js / ai-enemy.js ───────

function rogueOnWaveStart(){
  if(ROGUE.pickedIds.has('emergency_shield')) ROGUE.shieldCharges=1;
  if(ROGUE.mods.shieldChargesPerWave) ROGUE.shieldCharges=(ROGUE.shieldCharges||0)+ROGUE.mods.shieldChargesPerWave;
  if(ROGUE.pickedIds.has('second_wind')) ROGUE.secondWindReady=true;
}

// Sorteia até `n` chips do CHIP_POOL, ponderado por raridade e sem reposição,
// excluindo ids já escolhidos permanentemente (não-repetíveis já obtidos),
// chips repetíveis que já atingiram o maxStacks, e qualquer id em `excludeIds`
// (usado pelo reload para nunca repetir algo já mostrado nesta tela).
function _rogueDrawChoices(excludeIds, n){
  const pool = CHIP_POOL.filter(c => {
    if(excludeIds && excludeIds.has(c.id)) return false;
    if(!c.repeatable) return !ROGUE.pickedIds.has(c.id);
    if(c.maxStacks) return (ROGUE.pickedCounts[c.id]||0) < c.maxStacks;
    return true;
  });
  const remaining = pool.slice();
  const picked = [];
  const count = Math.min(n, remaining.length);
  for(let k=0;k<count;k++){
    const totalW = remaining.reduce((sum,c)=>sum+rogueRarityWeight(c),0);
    let r = Math.random()*totalW;
    let idx = 0;
    for(;idx<remaining.length;idx++){
      r -= rogueRarityWeight(remaining[idx]);
      if(r<=0) break;
    }
    if(idx>=remaining.length) idx=remaining.length-1;
    picked.push(remaining[idx]);
    remaining.splice(idx,1);
  }
  return picked;
}

// Chamado por updateWaves() quando a onda acaba de ser totalmente limpa.
// Retorna true se abriu a tela de escolha (e portanto pausou o jogo).
function rogueOnWaveClear(){
  ROGUE.seenIds = new Set();   // nova tela → histórico de reload zera
  ROGUE.rerollCount = 0;
  const picked = _rogueDrawChoices(ROGUE.seenIds, 3);
  if(picked.length===0) return false;
  for(const c of picked) ROGUE.seenIds.add(c.id);
  ROGUE.choices = picked;
  ROGUE.screenOpen = true;
  addPause('roguelike');
  return true;
}

// Custo em XP do próximo reload — cresce a cada uso na mesma tela para
// desencorajar reload infinito (o jogador ainda pode gastar todo o XP se quiser).
function rogueRerollCost(){
  return 40 + ROGUE.rerollCount * 25;
}

// Gasta XP para descartar as 3 opções atuais e sortear 3 novas, com 0% de
// chance de repetir qualquer chip já mostrado nesta tela (inicial ou reloads
// anteriores) — ver ROGUE.seenIds.
function rogueReroll(){
  if(!ROGUE.screenOpen) return;
  if(typeof evolution==='undefined') return;
  const cost = rogueRerollCost();
  if(evolution.xp < cost){
    if(typeof showAlert==='function') showAlert('⚠ XP insuficiente para recarregar');
    return;
  }
  const newChoices = _rogueDrawChoices(ROGUE.seenIds, 3);
  if(newChoices.length===0){
    if(typeof showAlert==='function') showAlert('⚠ Nenhum chip novo disponível');
    return;
  }
  evolution.xp -= cost;
  ROGUE.rerollCount++;
  ROGUE.choices = newChoices;
  for(const c of newChoices) ROGUE.seenIds.add(c.id);
  if(typeof spawnBurst==='function') spawnBurst(robot.x, robot.y, '#38bdf8', 14, 3);
  if(typeof showAlert==='function') showAlert(`🔄 Opções recarregadas (-${cost} XP)`);
}

function rogueChooseChip(idx){
  const chip = ROGUE.choices[idx];
  if(!chip) return;
  chip.apply();
  if(!chip.repeatable) ROGUE.pickedIds.add(chip.id);
  else ROGUE.pickedCounts[chip.id]=(ROGUE.pickedCounts[chip.id]||0)+1;
  ROGUE.history.push(chip.title);
  showAlert(`${chip.emoji} ${chip.title} adquirido!`);
  spawnBurst(robot.x, robot.y, '#4ade80', 16, 3);
  ROGUE.screenOpen = false;
  ROGUE.choices = [];
  ROGUE._chipBounds = [];
  ROGUE._rerollBounds = null;
  removePause('roguelike');
}

function rogueHandleClick(mx,my){
  const rb=ROGUE._rerollBounds;
  if(rb && mx>=rb.x&&mx<=rb.x+rb.w&&my>=rb.y&&my<=rb.y+rb.h){ rogueReroll(); return; }
  for(let i=0;i<ROGUE._chipBounds.length;i++){
    const b=ROGUE._chipBounds[i];
    if(b && mx>=b.x&&mx<=b.x+b.w&&my>=b.y&&my<=b.y+b.h){ rogueChooseChip(i); return; }
  }
}

// Frame a frame: expira o Overclock e os cooldowns de proc dos chips
function updateRogue(){
  if(ROGUE.overclock.active){
    ROGUE.overclock.timer--;
    if(ROGUE.overclock.timer<=0) ROGUE.overclock.active=false;
  }
  for(const id in ROGUE.procCooldowns){
    if(ROGUE.procCooldowns[id]>0) ROGUE.procCooldowns[id]--;
  }
  _updateRogueSecondWind();
}

// Protocolo Fênix: dispara quando a vida cai abaixo de 20% (não letal — a morte
// letal já é coberta pelo Escudo de Emergência, que roda antes disto em updateRobot()).
// robot.invTimer já é respeitado pelo dano de projétil e de contato corpo-a-corpo,
// então reutilizá-lo aqui concede invulnerabilidade real sem precisar de estado novo.
function _updateRogueSecondWind(){
  if(!ROGUE.secondWindReady) return;
  if(!ROGUE.pickedIds.has('second_wind')) return;
  if(typeof robot==='undefined' || robot.dead) return;
  if(robot.hp<=0 || robot.hp>=robot.maxHp*0.20) return;
  ROGUE.secondWindReady=false;
  robot.hp=Math.min(robot.maxHp, robot.hp+robot.maxHp*0.15);
  robot.invTimer=Math.max(robot.invTimer||0, 120); // 2s de invulnerabilidade a 60fps
  if(typeof showAlert==='function') showAlert('🌟 PROTOCOLO FÊNIX ATIVADO!');
  if(typeof spawnBurst==='function') spawnBurst(robot.x,robot.y,'#facc15',22,4);
}

// Chamado nos pontos de dano causado a inimigos (game.js). Aplica lifesteal
// dos chips "Nanites Vampíricos", se houver. Sem custo se lifestealPct===0.
function rogueOnEnemyDamaged(dmg){
  const pct=ROGUE.mods.lifestealPct;
  if(!pct || !dmg || dmg<=0) return;
  if(typeof robot==='undefined' || robot.dead) return;
  robot.hp=Math.min(robot.maxHp, robot.hp+dmg*pct);
}

// Chamado nos pontos de dano ao robô (game.js, biomes.js, ai-enemy.js).
// Verifica se algum chip do tipo "proc" deve disparar (ex: Overclock).
function rogueOnRobotDamage(amount){
  if(!amount || amount<=0) return;
  if(!ROGUE.mods.biomeProcs.length) return;
  const tx=Math.floor(robot.x/TILE), ty=Math.floor(robot.y/TILE);
  const tile=getTile(tx,ty);
  for(const proc of ROGUE.mods.biomeProcs){
    if(!_rogueTileMatches(proc, tile)) continue;
    if((ROGUE.procCooldowns[proc.id]||0) > 0) continue;
    if(proc.effect==='overclock'){
      ROGUE.overclock.active=true;
      ROGUE.overclock.timer=proc.duration;
      showAlert(`⚡ OVERCLOCK — ${proc.label}`);
      spawnBurst(robot.x,robot.y,'#facc15',14,3);
    }
    ROGUE.procCooldowns[proc.id]=proc.cooldown;
  }
}

// Consome 1 carga do Escudo de Emergência para evitar a morte, se disponível.
function rogueTryEmergencyShield(){
  if(ROGUE.shieldCharges<=0) return false;
  ROGUE.shieldCharges--;
  robot.hp = Math.max(1, Math.round(robot.maxHp*0.3));
  showAlert('🪖 ESCUDO DE EMERGÊNCIA ATIVADO!');
  spawnBurst(robot.x,robot.y,'#38bdf8',24,4);
  return true;
}

// Multiplicador de dano causado (arma) — soma bônus de bioma + Overclock
function rogueGetDamageMult(){
  let mult = ROGUE.mods.dmgMult;
  const tx=Math.floor(robot.x/TILE), ty=Math.floor(robot.y/TILE);
  const tile=getTile(tx,ty);
  for(const key in ROGUE.mods.biomeDmg){
    const bd=ROGUE.mods.biomeDmg[key];
    if(_rogueTileMatches(bd, tile)) mult *= bd.mult;
  }
  if(ROGUE.overclock.active) mult *= ROGUE.overclock.dmgMult;
  return mult;
}

// Multiplicador de cooldown de arma — chips fixos + Overclock temporário
function rogueGetCooldownMult(){
  let mult = ROGUE.mods.cooldownMult;
  if(ROGUE.overclock.active) mult *= ROGUE.overclock.cooldownMult;
  return mult;
}

// ─── Renderização da tela de escolha de chips ────────────────────
function _rogueWrap(ctx2,text,maxW){
  const words=text.split(' ');
  const lines=[]; let cur='';
  for(const w of words){
    const test=cur?cur+' '+w:w;
    if(ctx2.measureText(test).width>maxW && cur){ lines.push(cur); cur=w; }
    else cur=test;
  }
  if(cur) lines.push(cur);
  return lines;
}

function drawRogueChips(){
  if(!ROGUE.screenOpen || ROGUE.choices.length===0) return;

  ctx.save();
  ctx.fillStyle='rgba(2,6,14,0.88)';
  ctx.fillRect(0,0,W,H);

  ctx.textAlign='center';
  ctx.shadowColor='rgba(0,230,255,0.55)'; ctx.shadowBlur=12;
  ctx.fillStyle='#00e5ff'; ctx.font=`bold 18px 'Orbitron',sans-serif`;
  ctx.fillText(`🌊 ONDA ${wave} CONCLUÍDA`, W/2, H*0.5-170);
  ctx.shadowBlur=0;
  ctx.fillStyle='rgba(200,232,255,0.65)'; ctx.font=`10px 'Share Tech Mono',monospace`;
  ctx.fillText('Escolha 1 upgrade para UNIDADE-7', W/2, H*0.5-150);

  const n=ROGUE.choices.length;
  const cardW=Math.min(220, (W-80)/n-16);
  const cardH=Math.min(300, H-220);
  const gap=20;
  const totalW=n*cardW+(n-1)*gap;
  const startX=W/2-totalW/2;
  const cardY=H/2-cardH/2+20;

  ROGUE._chipBounds=[];

  ROGUE.choices.forEach((chip,i)=>{
    const cx2=startX+i*(cardW+gap);
    const cy2=cardY;

    // Card
    const rarityColors = { comum:'rgba(148,163,184,0.9)', raro:'rgba(56,189,248,0.9)', epico:'rgba(168,85,247,0.9)', lendario:'rgba(250,204,21,0.95)' };
    const rColor = rarityColors[chip.rarity] || rarityColors.comum;
    ctx.fillStyle='rgba(6,14,28,0.97)';
    roundRect(ctx,cx2,cy2,cardW,cardH,12); ctx.fill();
    ctx.strokeStyle = chip.rarity && chip.rarity!=='comum' ? rColor : (chip.sub ? 'rgba(250,204,21,0.55)' : 'rgba(0,230,255,0.45)');
    ctx.lineWidth=1.5;
    roundRect(ctx,cx2,cy2,cardW,cardH,12); ctx.stroke();

    // Selo de raridade (canto superior)
    if(chip.rarity && chip.rarity!=='comum'){
      const rLabels={raro:'RARO',epico:'ÉPICO',lendario:'LENDÁRIO'};
      ctx.fillStyle=rColor; ctx.font=`bold 8px 'Share Tech Mono',monospace`; ctx.textAlign='center';
      ctx.fillText(rLabels[chip.rarity]||'', cx2+cardW/2, cy2+16);
    }

    ROGUE._chipBounds[i] = {x:cx2,y:cy2,w:cardW,h:cardH};

    // Emoji grande
    ctx.font='38px sans-serif'; ctx.textAlign='center';
    ctx.fillText(chip.emoji, cx2+cardW/2, cy2+56);

    // Título
    ctx.fillStyle='#e6f6ff'; ctx.font=`bold 12px 'Orbitron',sans-serif`;
    const titleLines=_rogueWrap(ctx, chip.title, cardW-24);
    let ty2=cy2+82;
    for(const l of titleLines){ ctx.fillText(l, cx2+cardW/2, ty2); ty2+=15; }

    // Linha divisória
    ctx.strokeStyle='rgba(0,230,255,0.2)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(cx2+16,ty2+4); ctx.lineTo(cx2+cardW-16,ty2+4); ctx.stroke();
    ty2+=18;

    // Descrição principal
    ctx.fillStyle='rgba(210,230,255,0.85)'; ctx.font=`10px 'Share Tech Mono',monospace`;
    const descLines=_rogueWrap(ctx, chip.desc, cardW-24);
    for(const l of descLines){ ctx.fillText(l, cx2+cardW/2, ty2); ty2+=14; }

    // Explicação do atributo temporário (quando existir)
    if(chip.sub){
      ty2+=6;
      ctx.fillStyle='rgba(250,204,21,0.85)'; ctx.font=`italic 9px 'Share Tech Mono',monospace`;
      const subLines=_rogueWrap(ctx, chip.sub, cardW-28);
      for(const l of subLines){ ctx.fillText(l, cx2+cardW/2, ty2); ty2+=12; }
    }

    // Contador de pilha, para chips repetíveis já obtidos antes (mostra limite quando houver)
    if(chip.repeatable){
      const picked=ROGUE.pickedCounts[chip.id]||0;
      if(picked>0 || chip.maxStacks){
        const stackLabel=chip.maxStacks ? `obtido ${picked}/${chip.maxStacks}x` : `obtido ${picked}x`;
        ctx.fillStyle='rgba(74,222,128,0.75)'; ctx.font=`9px 'Share Tech Mono',monospace`;
        ctx.fillText(stackLabel, cx2+cardW/2, cy2+cardH-26);
      }
    }

    // Selo "NOVO" se ainda não escolhido antes / rodapé de clique
    ctx.fillStyle='rgba(0,230,255,0.55)'; ctx.font=`9px 'Share Tech Mono',monospace`;
    ctx.fillText('clique para escolher', cx2+cardW/2, cy2+cardH-14);
  });

  // ── Botão de reload: descarta as 3 opções e sorteia 3 novas, gastando XP ──
  // 0% de chance de repetir qualquer chip já mostrado nesta tela (ver ROGUE.seenIds).
  const rerollCost = rogueRerollCost();
  const xpNow = (typeof evolution!=='undefined') ? evolution.xp : 0;
  const canAfford = xpNow >= rerollCost;
  const btnW=210, btnH=32;
  const btnX=W/2-btnW/2, btnY=cardY+cardH+18;

  ctx.fillStyle = canAfford ? 'rgba(0,50,60,0.9)' : 'rgba(40,20,20,0.7)';
  roundRect(ctx,btnX,btnY,btnW,btnH,8); ctx.fill();
  ctx.strokeStyle = canAfford ? 'rgba(0,230,255,0.6)' : 'rgba(150,60,60,0.5)';
  ctx.lineWidth=1.5;
  roundRect(ctx,btnX,btnY,btnW,btnH,8); ctx.stroke();

  ctx.fillStyle = canAfford ? '#7dd3fc' : 'rgba(255,150,150,0.75)';
  ctx.font=`bold 11px 'Share Tech Mono',monospace`; ctx.textAlign='center';
  ctx.fillText(`🔄 Recarregar opções — ${rerollCost} XP`, btnX+btnW/2, btnY+btnH/2+4);

  ctx.fillStyle='rgba(200,232,255,0.5)'; ctx.font=`9px 'Share Tech Mono',monospace`;
  ctx.fillText(`XP disponível: ${Math.floor(xpNow)}`, btnX+btnW/2, btnY+btnH+14);

  ROGUE._rerollBounds = {x:btnX,y:btnY,w:btnW,h:btnH};

  ctx.restore();
}
