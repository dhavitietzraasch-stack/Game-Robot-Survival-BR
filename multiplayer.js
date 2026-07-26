/* ============================================================
   SIGNAL LOST — multiplayer.js  v2.0
   Camada de conexão P2P (WebRTC via Trystero, estratégia BitTorrent —
   ver trystero-torrent.min.js, vendorizado localmente a partir do pacote
   @trystero-p2p/torrent, sem servidor próprio: os navegadores se acham
   via trackers públicos de BitTorrent e depois falam direto um com o
   outro, criptografado).

   FASE 1 (este arquivo): modo COMPETITIVO. Cada peer roda sua própria
   simulação inteira e independente (mundos separados) e só troca
   placar/status em baixa frequência pra alimentar o painel de jogadores
   no HUD e o modal próprio de Multiplayer. Não há estado de jogo
   compartilhado nem host autoritativo — isso significa que, por design,
   um peer mal-intencionado pode mentir sobre o próprio placar (não tem
   como impedir isso 100% sem um servidor confiável). O que dá pra fazer
   — e este arquivo faz — é (a) validar/sanitizar tudo que chega pela
   rede antes de usar, pra dados malformados não quebrarem a UI, e
   (b) sincronizar automaticamente seed/modo/tamanho de mapa do host pro
   convidado, pra pelo menos garantir que as duas simulações competem no
   mesmo mundo em vez de um jogar num mapa mais fácil sem querer.

   Sala agora suporta qualquer número de jogadores (não só 1v1) — ver
   MP.peers, um mapa peerId → status, em vez de um único MP.opponent.

   FASE 2 (ainda não implementada): modo CO-OP, mundo compartilhado —
   exige generalizar o `robot` único do game.js pra suportar múltiplos
   jogadores na mesma simulação (câmera, colisões, XP e ondas
   compartilhados). É um passo bem maior, deixado pra depois desta base
   de conexão estar validada.

   Carregado DEPOIS de game.js (usa score/wave/evolution/robot/running/
   showAlert/seedInput/_selectedMode/_selectedMapW/_selectedMapH/startGame
   como globais, e trystero-torrent.min.js pra window.TRYSTERO).
   ============================================================ */
'use strict';

const MP_APP_ID = 'signal-lost-unidade7-v1';
const MP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I — evita confusão ao ditar o código
const MP_JOIN_TIMEOUT_MS = 20000; // aviso (não erro) se ninguém entrar na sala nesse tempo

const MP = {
  room: null,
  connected: false,       // true assim que ≥1 peer está com WebRTC aberto
  roomCode: null,
  isHost: false,
  myName: 'Jogador-' + Math.floor(100 + Math.random() * 900),
  sendStatus: null,
  sendWorldInfo: null,
  connectedPeerIds: new Set(),
  peers: {},              // peerId -> {peerId,name,score,wave,level,hp,maxHp,alive,result}
  hostWorld: null,        // {seed,mode,mapW,mapH} recebido do host (só relevante se !isHost)
  syncWorld: true,        // aplicar automaticamente hostWorld ao receber
  _broadcastTimer: 0,
  _joinTimeoutId: null,
};

function mpGenerateCode(){
  let s='';
  for(let i=0;i<6;i++) s+=MP_CODE_ALPHABET[Math.floor(Math.random()*MP_CODE_ALPHABET.length)];
  return s;
}

function mpSetStatus(msg,cls){
  const el=document.getElementById('mpStatus');
  if(!el) return;
  el.textContent=msg;
  el.className='mp-status'+(cls?' '+cls:'');
}

// Escapa texto vindo da rede (nome de outro jogador) antes de injetar via
// innerHTML — sem isso, um peer poderia colocar HTML no próprio nome e
// afetar a tela de quem estiver na mesma sala.
function _mpEsc(s){
  const d=document.createElement('div');
  d.textContent = (s==null? '' : String(s));
  return d.innerHTML;
}

// ─── Validação de dados vindos da rede ─────────────────────────
// Tudo que chega por MP.sendStatus/MP.sendWorldInfo é controlado pelo
// OUTRO peer, então nunca confiamos direto nos tipos/valores — só depois
// de passar por aqui é que os dados entram em MP.peers / MP.hostWorld.
function _mpSanitizeStatus(data){
  data = data || {};
  return {
    name:  typeof data.name==='string' ? data.name.slice(0,16) : 'Jogador',
    score: Number.isFinite(data.score) && data.score>=0 ? Math.floor(data.score) : 0,
    wave:  Number.isFinite(data.wave)  && data.wave>=0  ? Math.floor(data.wave)  : 0,
    level: Number.isFinite(data.level) && data.level>=1 ? Math.floor(data.level) : 1,
    hp:    Number.isFinite(data.hp) ? Math.max(0,data.hp) : 0,
    maxHp: Number.isFinite(data.maxHp) && data.maxHp>0 ? data.maxHp : 100,
    alive: !!data.alive,
    result: (data.result==='win'||data.result==='lose') ? data.result : null,
  };
}
function _mpSanitizeWorldInfo(data){
  data = data || {};
  const mode = (data.mode==='finite'||data.mode==='infinite'||data.mode==='creative') ? data.mode : 'finite';
  return {
    seed: typeof data.seed==='string' && data.seed.trim() ? data.seed.trim().slice(0,28) : 'signal',
    mode,
    mapW: Number.isFinite(data.mapW) && data.mapW>=100 && data.mapW<=4000 ? Math.floor(data.mapW) : 800,
    mapH: Number.isFinite(data.mapH) && data.mapH>=100 && data.mapH<=4000 ? Math.floor(data.mapH) : 600,
  };
}

function mpPeerCount(){ return Object.keys(MP.peers).length; }

function mpLeaveCurrentRoom(){
  if(MP._joinTimeoutId){ clearTimeout(MP._joinTimeoutId); MP._joinTimeoutId=null; }
  if(MP.room){ try{ MP.room.leave(); }catch(err){ /* sala já pode ter caído */ } }
  MP.room=null; MP.connected=false; MP.sendStatus=null; MP.sendWorldInfo=null;
  MP.connectedPeerIds=new Set(); MP.peers={}; MP.hostWorld=null;
  MP.roomCode=null; MP.isHost=false;
  mpUpdateHudPanel();
  mpUpdateModalUI();
}

function mpJoin(code, isHost){
  if(typeof TRYSTERO==='undefined' || !TRYSTERO.joinRoom){
    mpSetStatus('❌ Módulo de rede não carregou (trystero-torrent.min.js).','mp-error');
    return;
  }
  mpLeaveCurrentRoom();
  MP.roomCode=code; MP.isHost=isHost;

  let room;
  try{
    room = TRYSTERO.joinRoom({appId:MP_APP_ID}, 'sl-'+code);
  }catch(err){
    mpSetStatus('❌ Falha ao entrar na sala: '+err.message,'mp-error');
    return;
  }
  MP.room=room;

  const statusAction = room.makeAction('status');
  MP.sendStatus = statusAction.send;
  statusAction.onMessage = (data, {peerId}={})=>{
    if(!peerId) return;
    const prevResult = MP.peers[peerId] ? MP.peers[peerId].result : null;
    const clean = _mpSanitizeStatus(data);
    MP.peers[peerId] = Object.assign({peerId}, clean);
    mpUpdateHudPanel();
    mpUpdateModalUI();
    if(clean.result==='win'  && prevResult!=='win')  showAlert2(`🏆 ${clean.name} foi resgatado!`);
    else if(clean.result==='lose' && prevResult!=='lose') showAlert2(`💥 ${clean.name} foi destruído!`);
  };

  // Ação separada (não some no meio do placar) usada só pelo host, uma vez
  // por convidado que entra, pra sincronizar seed/modo/tamanho de mapa.
  const worldAction = room.makeAction('worldinfo');
  MP.sendWorldInfo = worldAction.send;
  worldAction.onMessage = (data)=>{
    if(MP.isHost) return; // só o convidado aplica o mundo do host
    const clean=_mpSanitizeWorldInfo(data);
    MP.hostWorld=clean;
    if(MP.syncWorld) mpApplyHostWorld(clean);
    mpUpdateModalUI();
  };

  room.onPeerJoin = (peerId)=>{
    MP.connectedPeerIds.add(peerId);
    MP.connected = true;
    if(MP._joinTimeoutId){ clearTimeout(MP._joinTimeoutId); MP._joinTimeoutId=null; }
    const n=MP.connectedPeerIds.size;
    mpSetStatus(`✅ Conectado! Sala ${code} · ${n} jogador${n>1?'es':''} junto${n>1?'s':''}`,'mp-ok');
    if(MP.isHost) mpSendWorldInfoTo(peerId);
    mpUpdateHudPanel();
    mpUpdateModalUI();
  };
  room.onPeerLeave = (peerId)=>{
    MP.connectedPeerIds.delete(peerId);
    delete MP.peers[peerId];
    MP.connected = MP.connectedPeerIds.size>0;
    mpSetStatus(MP.connected
      ? `⚠ Um jogador saiu. ${MP.connectedPeerIds.size} restante(s) na sala ${code}.`
      : `⚠ Todos saíram da sala ${code} — aguardando alguém entrar...`, 'mp-warn');
    mpUpdateHudPanel();
    mpUpdateModalUI();
  };

  mpSetStatus(isHost
    ? `📡 Sala ${code} — compartilhe o código. Aguardando jogadores...`
    : `📡 Entrando na sala ${code}...`, 'mp-wait');
  mpUpdateModalUI();

  // Aviso (não erro) se ninguém entrar depois de um tempo — não dá pra
  // detectar com certeza uma falha de rede numa conexão P2P sem servidor,
  // então isso é só uma dica pro jogador conferir o código/a conexão.
  MP._joinTimeoutId = setTimeout(()=>{
    if(MP.room===room && !MP.connected){
      mpSetStatus(`⌛ Ninguém entrou na sala ${code} ainda. Confira o código com quem vai jogar.`,'mp-warn');
    }
  }, MP_JOIN_TIMEOUT_MS);
}

function mpSendWorldInfoTo(peerId){
  if(!MP.sendWorldInfo) return;
  const info = {
    seed: (typeof seedInput!=='undefined' && seedInput) ? seedInput.value.trim() : 'signal',
    mode: (typeof _selectedMode!=='undefined') ? _selectedMode : 'finite',
    mapW: (typeof _selectedMapW!=='undefined') ? _selectedMapW : 800,
    mapH: (typeof _selectedMapH!=='undefined') ? _selectedMapH : 600,
  };
  try{ MP.sendWorldInfo(info, {target:peerId}); }
  catch(err){ try{ MP.sendWorldInfo(info); }catch(err2){ /* sem sorte, convidado começa sem sync */ } }
}

// Aplica seed/modo/tamanho de mapa recebidos do host nos controles da
// tela de menu — mesma UI que o jogador usaria manualmente, só que
// preenchida sozinha pra evitar erro de digitação e mundos diferentes.
function mpApplyHostWorld(data){
  if(!data) return;
  if(typeof seedInput!=='undefined' && seedInput) seedInput.value = data.seed;
  if(typeof _selectedMode!=='undefined'){
    _selectedMode = data.mode;
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active', b.dataset.mode===data.mode));
  }
  if(typeof _selectedMapW!=='undefined'){
    _selectedMapW = data.mapW; _selectedMapH = data.mapH;
    document.querySelectorAll('.mapsize-btn').forEach(b=>{
      b.classList.toggle('active', parseInt(b.dataset.w)===data.mapW && parseInt(b.dataset.h)===data.mapH);
    });
  }
  mpSetStatus('🔄 Mundo sincronizado com o host (seed/modo/mapa).','mp-ok');
}

// showAlert() já existe em game.js pro HUD principal; isolado aqui só pra
// não quebrar se este arquivo algum dia carregar antes dele.
function showAlert2(msg){ if(typeof showAlert==='function') showAlert(msg); }

function mpCreateRoom(){ mpJoin(mpGenerateCode(), true); }
function mpJoinRoomByCode(rawCode){
  const code=(rawCode||'').trim().toUpperCase();
  if(code.length<4){ mpSetStatus('Digite um código válido (mínimo 4 caracteres).','mp-error'); return; }
  mpJoin(code, false);
}

// Chamado uma vez por frame pelo loop principal (mesmo padrão de
// typeof-guard usado por updateARIA/updateRogue). O envio de fato é
// limitado a ~2x/segundo — é só pro HUD/modal, não precisa de mais.
function mpUpdate(){
  if(!MP.room || !MP.connected || !MP.sendStatus) return;
  if(typeof running==='undefined' || !running) return;
  MP._broadcastTimer++;
  if(MP._broadcastTimer<30) return;
  MP._broadcastTimer=0;
  MP.sendStatus({
    name: MP.myName, score, wave,
    level: (typeof evolution!=='undefined') ? evolution.level : 1,
    hp: Math.ceil(robot.hp), maxHp: robot.maxHp,
    alive: !robot.dead,
    result: null,
  });
}

// Disparo imediato (fora do throttle) quando a partida termina, pra os
// outros jogadores saberem na hora em vez de esperar o próximo tick.
function mpNotifyGameEnd(win){
  if(!MP.room || !MP.connected || !MP.sendStatus) return;
  MP.sendStatus({
    name: MP.myName, score, wave,
    level: (typeof evolution!=='undefined') ? evolution.level : 1,
    hp: Math.ceil(Math.max(0,robot.hp)), maxHp: robot.maxHp,
    alive: win ? true : false,
    result: win ? 'win' : 'lose',
  });
}

// ─── Painel no HUD (durante a partida) ─────────────────────────
function mpUpdateHudPanel(){
  const panel=document.getElementById('mpPeersPanel');
  const list=document.getElementById('mpPeersList');
  if(!panel||!list) return;
  const ids=Object.keys(MP.peers);
  panel.classList.toggle('show', ids.length>0);
  if(ids.length===0){ list.innerHTML=''; return; }
  // Ordena por score (maior primeiro) — dá o clima de "quem está ganhando"
  const sorted=ids.map(id=>MP.peers[id]).sort((a,b)=>(b.score||0)-(a.score||0));
  list.innerHTML = sorted.map(p=>{
    const hpPct = p.maxHp ? Math.max(0,Math.min(100,(p.hp||0)/p.maxHp*100)) : 0;
    const status = p.result==='win' ? '🏆' : p.result==='lose' ? '💥' : (!p.alive ? '💀' : '');
    return `<div class="mp-peer-row">
      <div class="mp-peer-top">
        <span class="mp-peer-name">${_mpEsc(p.name)}</span>
        <span class="mp-peer-status">${status}</span>
      </div>
      <div class="bar-track mp-opp-track"><div class="bar-fill health" style="width:${hpPct}%"></div></div>
      <div class="mp-peer-stats">ONDA ${p.wave} · NÍVEL ${p.level} · SCORE ${p.score}</div>
    </div>`;
  }).join('');
}

// ─── UI do modal (tela de menu) ────────────────────────────────
function mpUpdateModalUI(){
  const noRoom=document.getElementById('mpNoRoomSection');
  const inRoom=document.getElementById('mpInRoomSection');
  if(noRoom) noRoom.classList.toggle('hidden', !!MP.room);
  if(inRoom) inRoom.classList.toggle('hidden', !MP.room);
  const codeText=document.getElementById('mpCodeText');
  if(codeText) codeText.textContent = MP.roomCode || '------';
  const dot=document.getElementById('mpBtnDot');
  if(dot) dot.classList.toggle('show', MP.connected);

  const list=document.getElementById('mpModalPeerList');
  if(!list) return;
  const ids=Object.keys(MP.peers);
  if(ids.length===0){
    list.innerHTML='<div class="mp-empty-hint">Ninguém conectado ainda.</div>';
    return;
  }
  const sorted=ids.map(id=>MP.peers[id]).sort((a,b)=>(b.score||0)-(a.score||0));
  list.innerHTML = sorted.map(p=>{
    const status = p.result==='win' ? '🏆 Resgatado' : p.result==='lose' ? '💥 Destruído' : (!p.alive ? '💀 Caído' : '🎮 Jogando');
    return `<div class="mp-modal-peer-row">
      <span>${_mpEsc(p.name)}</span>
      <span>${status} · Onda ${p.wave} · Score ${p.score}</span>
    </div>`;
  }).join('');
}

// ─── Integração com o início de partida (sem editar game.js) ───
// Envolve startGame numa função "wrapper": ela roda ANTES da função
// original toda vez que uma partida começa ou reinicia, pra (a) limpar
// o resultado da partida anterior dos outros jogadores da sala (senão o
// troféu/caveira de quem já tinha sido resgatado/destruído continuaria
// aparecendo até a próxima mensagem chegar) e (b) avisar se o modo
// escolhido não rende pontuação nenhuma (Criativo) enquanto conectado.
if(typeof startGame==='function'){
  const _mpOrigStartGame = startGame;
  startGame = function(seed, mode){
    mpOnLocalGameStart(mode);
    return _mpOrigStartGame(seed, mode);
  };
}
function mpOnLocalGameStart(mode){
  for(const id in MP.peers){ MP.peers[id].result=null; MP.peers[id].alive=true; }
  mpUpdateHudPanel();
  mpUpdateModalUI();
  const effectiveMode = mode || (typeof gameMode!=='undefined' ? gameMode : 'finite');
  if(MP.connected && effectiveMode==='creative'){
    showAlert2('⚠ Modo Criativo não tem inimigos nem pontuação — não é ideal pra competir na sala');
  }
}

// ─── Wiring da UI ───────────────────────────────────────────────
const btnMpCreate=document.getElementById('btnMpCreate');
const btnMpJoin=document.getElementById('btnMpJoin');
const btnMpLeave=document.getElementById('btnMpLeave');
const btnMpCopyCode=document.getElementById('btnMpCopyCode');
const mpJoinCodeInput=document.getElementById('mpJoinCode');
const mpNicknameInput=document.getElementById('mpNickname');
const mpSyncWorldInput=document.getElementById('mpSyncWorld');
const btnMpOpen=document.getElementById('btnMpOpen');
const btnCloseMp=document.getElementById('btnCloseMp');
const mpScreenEl=document.getElementById('mpScreen');

if(btnMpCreate) btnMpCreate.onclick=()=>mpCreateRoom();
if(btnMpJoin)   btnMpJoin.onclick=()=>mpJoinRoomByCode(mpJoinCodeInput?mpJoinCodeInput.value:'');
if(mpJoinCodeInput) mpJoinCodeInput.addEventListener('keydown', e=>{ if(e.key==='Enter') mpJoinRoomByCode(mpJoinCodeInput.value); });

if(btnMpLeave) btnMpLeave.onclick=()=>{
  mpLeaveCurrentRoom();
  mpSetStatus('Você saiu da sala.', '');
};

if(btnMpCopyCode) btnMpCopyCode.onclick=()=>{
  if(!MP.roomCode) return;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(MP.roomCode)
      .then(()=>mpSetStatus('📋 Código copiado!','mp-ok'))
      .catch(()=>mpSetStatus('Não foi possível copiar — código: '+MP.roomCode,'mp-warn'));
  }else{
    mpSetStatus('Copie manualmente o código: '+MP.roomCode,'mp-warn');
  }
};

if(mpNicknameInput){
  mpNicknameInput.value=MP.myName;
  mpNicknameInput.addEventListener('input',()=>{
    MP.myName = mpNicknameInput.value.trim().slice(0,16) || 'Jogador';
  });
}
if(mpSyncWorldInput){
  mpSyncWorldInput.checked = MP.syncWorld;
  mpSyncWorldInput.addEventListener('change',()=>{ MP.syncWorld = mpSyncWorldInput.checked; });
}

if(btnMpOpen) btnMpOpen.onclick=()=>{ if(mpScreenEl) mpScreenEl.classList.add('show'); mpUpdateModalUI(); };
if(btnCloseMp) btnCloseMp.onclick=()=>{ if(mpScreenEl) mpScreenEl.classList.remove('show'); };

mpUpdateModalUI();
