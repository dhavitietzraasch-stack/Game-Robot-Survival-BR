/* ============================================================
   SIGNAL LOST — daynight.js
   Ciclo dia/noite: só o essencial — passagem do tempo entre as
   duas fases (com transição suave de amanhecer/anoitecer) e o
   escurecimento visual do mundo em canvas. Sem efeitos em stats,
   spawn de inimigos ou biomas — isso fica para depois.

   Carregado ANTES de game.js (mesmo padrão de biomes.js/ai-survival.js):
   as funções só tocam `robot`/`time`/`ctx`/`W`/`H` dentro de seus
   corpos, chamadas de dentro de update()/draw() do game.js, quando
   tudo já está definido.
   ============================================================ */
'use strict';

const DAYNIGHT = {
  enabled: true,
  dayMinutes: 5,          // duração da fase de dia, em minutos reais (ajustável nas Configurações)
  nightMinutes: 3,        // duração da fase de noite, em minutos reais (ajustável nas Configurações)
  transitionSeconds: 40,  // duração fixa do amanhecer/anoitecer (não exposta na UI)

  elapsed: 0,       // ms acumulados desde o início da partida (só avança com o jogo rodando, não pausado)
  isDay: true,
  darkness: 0,      // 0 = dia pleno · 1 = noite plena — usado no overlay visual
  phaseLabel: 'DIA',
  timeLeftMs: 0,
};

function _dnDayMs(){ return Math.max(1,DAYNIGHT.dayMinutes)*60000; }
function _dnNightMs(){ return Math.max(1,DAYNIGHT.nightMinutes)*60000; }

function resetDayNight(){
  DAYNIGHT.elapsed=0; DAYNIGHT.isDay=true; DAYNIGHT.darkness=0; DAYNIGHT.phaseLabel='DIA'; DAYNIGHT.timeLeftMs=_dnDayMs();
}

function updateDayNight(dt){
  if(!DAYNIGHT.enabled) return;
  DAYNIGHT.elapsed += dt;

  const dayMs=_dnDayMs(), nightMs=_dnNightMs(), cycle=dayMs+nightMs;
  // Transição nunca passa de 45% de nenhuma das duas fases (evita
  // sobreposição em ciclos curtos configurados pelo jogador).
  const transMs=Math.max(1000, Math.min(DAYNIGHT.transitionSeconds*1000, dayMs*0.45, nightMs*0.45));
  const t=DAYNIGHT.elapsed % cycle;

  const duskStart=dayMs-transMs, dawnStart=cycle-transMs;
  let darkness,isDay,label;
  if(t<duskStart){               darkness=0;                        isDay=true;  label='DIA'; }
  else if(t<dayMs){               darkness=(t-duskStart)/transMs;    isDay=true;  label='ANOITECER'; }
  else if(t<dawnStart){           darkness=1;                        isDay=false; label='NOITE'; }
  else{                           darkness=1-(t-dawnStart)/transMs;  isDay=false; label='AMANHECER'; }

  const bounds=[duskStart,dayMs,dawnStart,cycle];
  let timeLeft=cycle-t;
  for(const b of bounds){ if(t<b){ timeLeft=b-t; break; } }

  DAYNIGHT.darkness=Math.max(0,Math.min(1,darkness));
  DAYNIGHT.isDay=isDay; DAYNIGHT.phaseLabel=label; DAYNIGHT.timeLeftMs=timeLeft;
}

// Cor-base do tingimento noturno conforme a fase (dá um pouco de
// "clima" à transição em vez de um preto liso subindo/descendo).
function _dnTintRGB(){
  switch(DAYNIGHT.phaseLabel){
    case 'ANOITECER': return [46,26,58];   // roxo/laranja de entardecer
    case 'AMANHECER': return [30,42,70];   // azul pálido de madrugada
    default:          return [6,10,22];    // noite fechada
  }
}

// Desenhado por cima do mundo/entidades, mas ANTES da UI em canvas
// (HUD, minimapa, painéis) — só o mundo escurece, a interface continua legível.
function drawDayNight(){
  if(!DAYNIGHT.enabled || DAYNIGHT.darkness<=0.01) return;
  if(typeof robot==='undefined'||typeof ctx==='undefined'||typeof W==='undefined') return;
  const d=DAYNIGHT.darkness;
  const [r,g,b]=_dnTintRGB();
  const rx=robot.x-cam.x+W/2, ry=robot.y-cam.y+H/2;
  const maxR=Math.max(W,H)*0.85;
  // Raio "iluminado" ao redor do robô — puramente visual (não é um raio de
  // visão/detecção real, não afeta spawn, IA, fog-of-war do minimapa etc.).
  // Encolhe conforme a noite fica mais fechada, dando a sensação de campo
  // de visão limitado sem de fato reduzir nenhuma variável de alcance —
  // é só a penumbra (gradiente suave) ficando mais apertada ao redor do jogador.
  const haloMax=260, haloMin=110;
  const haloR=haloMax-DAYNIGHT.darkness*(haloMax-haloMin);

  ctx.save();
  const grad=ctx.createRadialGradient(rx,ry,haloR*0.1, rx,ry,maxR);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(Math.min(0.9,haloR/maxR), `rgba(${r},${g},${b},${(d*0.55).toFixed(3)})`);
  grad.addColorStop(1, `rgba(${Math.round(r*0.6)},${Math.round(g*0.6)},${Math.round(b*0.7)},${(d*0.86).toFixed(3)})`);
  ctx.fillStyle=grad;
  ctx.fillRect(0,0,W,H);
  ctx.restore();
}

// ─── Wiring da UI (painel de Configurações, na tela de menu) ─────
const dnEnabledInput = document.getElementById('settingDayNightEnabled');
const dnDayInput     = document.getElementById('settingDayMin');
const dnNightInput   = document.getElementById('settingNightMin');
const dnDayVal       = document.getElementById('settingDayMinVal');
const dnNightVal     = document.getElementById('settingNightMinVal');

function _dnFmtMin(v){ return (Math.round(v*10)/10)+' min'; }

if(dnEnabledInput) dnEnabledInput.addEventListener('change',()=>{ DAYNIGHT.enabled=dnEnabledInput.checked; });
if(dnDayInput) dnDayInput.addEventListener('input',()=>{
  DAYNIGHT.dayMinutes=parseFloat(dnDayInput.value);
  if(dnDayVal) dnDayVal.textContent=_dnFmtMin(DAYNIGHT.dayMinutes);
});
if(dnNightInput) dnNightInput.addEventListener('input',()=>{
  DAYNIGHT.nightMinutes=parseFloat(dnNightInput.value);
  if(dnNightVal) dnNightVal.textContent=_dnFmtMin(DAYNIGHT.nightMinutes);
});
