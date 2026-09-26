/* ============================================================
   SIGNAL LOST — ai-survival.js  v2.1
   IA ARIA: alertas de status/ameaça, SEM glitches por corrupção
   (a navegação holográfica até antena foi removida junto com o
   sistema de resgate — o loop agora é só sobrevivência)
   Carregado ANTES de game.js
   ============================================================ */
'use strict';

const ARIA = {
  corruption:0, corruptionRate:0.000055,
  lastAlert:0, alertCD:200, queue:[],
  _wHp:false,_wEn:false,_wHeat:false,_prevBiome:'',
};

const ARIA_LINES={
  hpCrit:   ['Integridade estrutural comprometida.','Destruição iminente.','UNIDADE-7: status crítico.','Dano severo. Retire-se.'],
  hpLow:    ['Armadura abaixo do limiar seguro.','Reparos imediatos recomendados.','Estrutura danificada.'],
  enCrit:   ['FALHA DE ENERGIA IMINENTE.','Sistemas principais offline em breve.','Energia crítica.'],
  enLow:    ['Reservas energéticas reduzidas.','Bateria abaixo de 20%.','Consumo excede recarga.'],
  heatCrit: ['SUPERAQUECIMENTO CRÍTICO.','Fusão do núcle iminente','Temperatura letal. Resfrie já.'],
  heatHigh: ['Superaquecimento detectado.','Temperatura dos núcleos elevada.','Dissipação insuficiente.'],
  enemy:    ['Inimigos convergindo.','Ameaças detectadas no perímetro.','Contatos hostis próximos.'],
  enemyMass:['ALERTA: força inimiga massiva.','Recalculando... fuga recomendada.','Colapso do perímetro iminente.'],
  bossWarning:['Assinatura energética massiva se aproximando.','Ameaça de grande porte detectada — alerta máximo.','Recomendo cautela extrema. Algo grande vem por aí.'],
  biomeWat: ['Água detectada. Temperatura estabilizando.','Resfriamento via imersão.'],
  biomeLav: ['Zona vulcânica. Temperatura crítica iminente.','PERIGO: lava corrói sistemas.'],
  glitch:   ['enviando mensagem de ajuda... ERRO','planeta desconhecido','onde estamos?',
             'SINAL PERDIDO — sistema parcialmente off.'],
  idle:     ['Monitorando ambiente.','Sistemas operacionais.','Nenhuma ameaça imediata.','Coletando dados de terreno.'],
};

function _glitchText(s,intensity){
  const gc='@#$%&!?Ø01';
  return s.split('').map(c=>c===' '?c:Math.random()<intensity*.14?gc[Math.floor(Math.random()*gc.length)]:c).join('');
}

// ─── Alerta dedicado da ARIA ───────────────────────────────────
// Antes as falas passavam pelo showAlert() genérico (game.js) e disputavam
// espaço/atenção com avisos de level-up, chefe destruído, mapa exportado etc.
// Agora têm cartão próprio (#ariaAlert, ver index.html/style.css), com um
// timer e visual independentes — inclusive um estado "corrupted" que reflete
// ARIA.corruption, reaproveitando o mesmo tema visual do restante do arquivo.
const ariaAlertEl = document.getElementById('ariaAlert');
const ariaAlertTextEl = ariaAlertEl ? ariaAlertEl.querySelector('.aria-alert-text') : null;
let ariaAlertTimer = 0;
function showARIAAlert(msg){
  if(!ariaAlertEl) return;
  if(ariaAlertTextEl) ariaAlertTextEl.textContent = msg;
  ariaAlertEl.classList.add('show');
  ariaAlertEl.classList.toggle('corrupted', ARIA.corruption>0.5);
  ariaAlertTimer = 220;
}

function ariaSpeak(cat,force=false){
  const lines=ARIA_LINES[cat]; if(!lines) return;
  let line;
  if(ARIA.corruption>.6&&Math.random()<ARIA.corruption*.5)
    line=ARIA_LINES.glitch[Math.floor(Math.random()*ARIA_LINES.glitch.length)];
  else{
    line=lines[Math.floor(Math.random()*lines.length)];
    if(ARIA.corruption>.35) line=_glitchText(line,ARIA.corruption);
  }
  if(force){showARIAAlert(line);ARIA.lastAlert=time;}
  else ARIA.queue.push(line);
}

function updateARIA(){
  // Decrementa o timer do cartão da ARIA independente do resto (fora do
  // early-return abaixo) para a fala sempre sumir com a duração correta.
  if(ariaAlertTimer>0){ariaAlertTimer--;}
  else if(ariaAlertEl){ariaAlertEl.classList.remove('show');}
  if(!running||robot.dead) return;
  ARIA.corruption=Math.min(1,ARIA.corruption+ARIA.corruptionRate);

  // Flush queue
  if(ARIA.queue.length>0&&time-ARIA.lastAlert>ARIA.alertCD){
    showARIAAlert(ARIA.queue.shift()); ARIA.lastAlert=time;
  }

  const can=time-ARIA.lastAlert>ARIA.alertCD;
  if(can){
    // HP
    if(robot.hp<15&&!ARIA._wHp){ARIA._wHp=true;ariaSpeak('hpCrit',true);}
    else if(robot.hp>=15)ARIA._wHp=false;
    if(robot.hp<35&&robot.hp>=15&&Math.random()<.007)ariaSpeak('hpLow');
    // Energia
    if(robot.energy<8&&!ARIA._wEn){ARIA._wEn=true;ariaSpeak('enCrit',true);}
    else if(robot.energy>=8)ARIA._wEn=false;
    if(robot.energy<22&&robot.energy>=8&&Math.random()<.006)ariaSpeak('enLow');
    // Calor
    if(robot.heat>85&&!ARIA._wHeat){ARIA._wHeat=true;ariaSpeak('heatCrit',true);}
    else if(robot.heat<=85)ARIA._wHeat=false;
    if(robot.heat>60&&robot.heat<=85&&Math.random()<.005)ariaSpeak('heatHigh');
    // Inimigos
    let minD=Infinity,cnt=0;
    for(const e of enemies){const d=Math.hypot(e.x-robot.x,e.y-robot.y);if(d<minD)minD=d;if(d<420)cnt++;}
    if(cnt>8&&Math.random()<.004)ariaSpeak('enemyMass');
    else if(minD<300&&Math.random()<.004)ariaSpeak('enemy');
    // Glitch
    if(ARIA.corruption>.5&&Math.random()<ARIA.corruption*.0025)ariaSpeak('glitch',true);
    if(Math.random()<.001)ariaSpeak('idle');
  }
}

function drawARIACorruption(){
  if(ARIA.corruption<.3) return;
  const c=ARIA.corruption;
  ctx.save();
  if(Math.sin(time*.25)>.7){
    ctx.fillStyle=`rgba(255,50,50,${(c-.3)*.06})`;ctx.fillRect(0,0,W,H);
  }
  ctx.font='7px "Share Tech Mono",monospace';ctx.textAlign='left';
  ctx.fillStyle=`rgba(239,68,68,${.3+c*.4})`;
  const lbl=c>.8?'A.R.I.A [CORROMPIDA]':c>.5?'A.R.I.A [INSTÁVEL]':'A.R.I.A [DEGRADANDO]';
  ctx.fillText(lbl,14,H-8);
  ctx.restore();
}

function resetARIA(){
  ARIA.corruption=0;ARIA.lastAlert=0;ARIA.queue=[];
  ARIA._wHp=false;ARIA._wEn=false;ARIA._wHeat=false;ARIA._prevBiome='';
  ariaAlertTimer=0;
  if(ariaAlertEl){ariaAlertEl.classList.remove('show','corrupted');}
}
function ariaOnBiome(name){
  if(ARIA._prevBiome===name) return; ARIA._prevBiome=name;
  if(name==='Água Rasa'||name==='Mar Profundo') ariaSpeak('biomeWat');
  else if(name==='Vulcânico') ariaSpeak('biomeLav');
}
