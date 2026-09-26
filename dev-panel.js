/* ================================================================
   SIGNAL LOST — dev-panel.js
   Painel de desenvolvedor, ativado SOMENTE quando existe o arquivo
   assets/local.js. Se o arquivo não existir (404), este módulo
   inteiro fica inerte: nenhuma tecla é capturada, nenhum elemento é
   criado, nenhum intervalo roda — zero custo pro jogo em produção.

   IMPORTANTE: apesar da extensão ".js", o conteúdo de assets/local.js
   NÃO é JavaScript. É um mini-script no estilo "comando do Minecraft",
   com o interpretador implementado aqui embaixo (tokenizer → parser →
   executor, sem eval/Function — nada do arquivo roda como código real).
   A extensão .js é só convenção pra ficar fácil de reconhecer/ignorar
   no editor e no git (ex.: adicionar "assets/local.js" no .gitignore
   pra manter cheats fora do build de produção).

   ── SINTAXE ──────────────────────────────────────────────────────
     zone NOME = circle(cx, cy, raio);
     zone NOME = rect(x1, y1, x2, y2);
     effect NOME to @s;
     if CONDIÇÃO: AÇÃO, AÇÃO, ...;

     CONDIÇÃO := LIFE|ENERGY|HEAT (< > <= >= == !=) NÚMERO[%]
               | @s in NOME_DA_ZONA
     AÇÃO     := LIFE|ENERGY|HEAT (+|-) NÚMERO[%]
               | effect NOME to @s
               | tick(N)

   Palavras-chave reservadas — sempre MAIÚSCULAS: LIFE, ENERGY, HEAT.
   Todo o resto da sintaxe (if / effect / to / in / zone / tick / @s /
   circle / rect) é minúsculo. Comentários com "//" até o fim da linha.

   ── SEMÂNTICA (decisões de projeto, documentadas por não estarem
      100% especificadas no pedido original — fácil de ajustar) ──────
   • LIFE/ENERGY/HEAT mapeiam pra robot.hp, robot.energy, robot.heat
     (e seus respectivos max). "%" = porcentagem do valor máximo;
     sem "%" = valor absoluto.
   • Coordenadas de zone(...) são pixels do mundo — o mesmo sistema
     de robot.x/robot.y (não tiles). Pra converter de tile: pixel =
     tile*32 (+16 pro centro do tile).
   • "effect X to @s;" fora de um if roda 1x quando o script carrega
     (equivalente a "me dá esse efeito ao iniciar"). Dentro de um if,
     roda toda vez que a condição dispara.
   • Efeitos ficam ativos indefinidamente até serem removidos (não há
     duração na sintaxe) — o painel tem um botão "Limpar efeitos".
     Efeitos com nome desconhecido ainda são aceitos e aparecem no
     painel, só não têm comportamento embutido (dá pra registrar um
     handler custom via DevPanel.registerEffect, ver final do arquivo).
   • tick(N): cada regra "if" tem seu próprio cooldown, em "dev-ticks"
     (1 dev-tick = 500ms). tick(1) → depois de disparar, a regra espera
     1 dev-tick (500ms) antes de poder dispar novamente. Sem tick(N)
     explícito, o cooldown padrão é 1 dev-tick (evita reexecutar a
     mesma regra 60x/segundo).
   • As regras só rodam com uma partida em andamento e não pausada
     (mesma trava que o resto do jogo usa: running && !isPaused()).

   ── INTEGRAÇÃO ───────────────────────────────────────────────────
   Módulo 100% independente — não precisa de nenhuma alteração em
   game.js. Só requer <script src="dev-panel.js"></script> no
   index.html, carregado por último. Usa globais já expostos por
   game.js (robot, cam, running, isPaused, TILE) só leitura, exceto
   robot.hp/energy/heat, que são escritos do mesmo jeito que biomas,
   cogumelos etc. já fazem hoje.

   Tecla F3 alterna o painel (estilo "debug screen" do Minecraft).
   ================================================================ */
'use strict';

(function(){

  // ── Estado ──────────────────────────────────────────────────────
  let devEnabled  = false;   // true assim que assets/local.js é encontrado
  let devVisible  = false;   // painel visível (toggle F3 / clique no badge)
  let scriptText  = '';
  let rules       = [];      // { cond, actions, raw, cooldownTicks }
  let initEffects = [];      // "effect X to @s;" fora de if
  let zones       = Object.create(null);
  let parseError  = null;    // {message, line} | null
  let runtimeHalted = false; // true se um erro em runtime interrompeu as regras
  let logLines    = [];
  const LOG_MAX   = 40;
  const TICK_MS   = 500;     // 1 dev-tick = 500ms — ver nota de semântica acima

  const activeEffects = new Map(); // nome -> { appliedAt }
  const EFFECT_HANDLERS = Object.create(null);
  const STAT_FIELDS = { LIFE:['hp','maxHp'], ENERGY:['energy','maxEnergy'], HEAT:['heat','maxHeat'] };

  // Handlers embutidos — só mexem em hp/energy/heat, do mesmo jeito que
  // qualquer outro sistema do jogo (biomas, cogumelo, etc). Nomes novos
  // não listados aqui ainda funcionam como "tag" (aparecem no painel,
  // sem efeito automático) até alguém registrar um handler.
  function registerEffect(name, handler){ EFFECT_HANDLERS[name] = handler; }
  registerEffect('regen',       { onTick(dt){ mutateStatRaw('hp','maxHp', +0.05*dt/1000); } });
  registerEffect('burn',        { onTick(dt){ mutateStatRaw('hp','maxHp', -0.05*dt/1000); } });
  registerEffect('coolant',     { onTick(dt){ mutateStatRaw('heat','maxHeat', -0.10*dt/1000); } });
  registerEffect('overheat',    { onTick(dt){ mutateStatRaw('heat','maxHeat', +0.10*dt/1000); } });
  registerEffect('energize',    { onTick(dt){ mutateStatRaw('energy','maxEnergy', +0.10*dt/1000); } });
  registerEffect('energydrain', { onTick(dt){ mutateStatRaw('energy','maxEnergy', -0.10*dt/1000); } });

  function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
  function mutateStatRaw(curKey,maxKey,fracOfMaxPerSec){
    if(typeof robot==='undefined') return;
    const delta = fracOfMaxPerSec*robot[maxKey];
    robot[curKey]=clamp(robot[curKey]+delta,0,robot[maxKey]);
  }

  function log(msg){
    const t=new Date(); const hh=String(t.getHours()).padStart(2,'0'),mm=String(t.getMinutes()).padStart(2,'0'),ss=String(t.getSeconds()).padStart(2,'0');
    logLines.push(`[${hh}:${mm}:${ss}] ${msg}`);
    if(logLines.length>LOG_MAX) logLines.shift();
  }

  // ── Tokenizer ───────────────────────────────────────────────────
  function tokenize(src){
    const toks=[]; let i=0, line=1;
    const isDigit=c=>c>='0'&&c<='9';
    const isIdentStart=c=>/[A-Za-z_]/.test(c);
    const isIdentPart=c=>/[A-Za-z0-9_]/.test(c);
    while(i<src.length){
      const c=src[i];
      if(c==='\n'){ line++; i++; continue; }
      if(/\s/.test(c)){ i++; continue; }
      if(c==='/'&&src[i+1]==='/'){ while(i<src.length&&src[i]!=='\n') i++; continue; }
      if(isDigit(c)){
        let s=i; while(i<src.length&&isDigit(src[i])) i++;
        if(src[i]==='.'&&isDigit(src[i+1])){ i++; while(i<src.length&&isDigit(src[i])) i++; }
        toks.push({type:'NUM', value:parseFloat(src.slice(s,i)), line}); continue;
      }
      if(isIdentStart(c)){
        let s=i; while(i<src.length&&isIdentPart(src[i])) i++;
        toks.push({type:'IDENT', value:src.slice(s,i), line}); continue;
      }
      const two=src.slice(i,i+2);
      if(['<=','>=','==','!='].includes(two)){ toks.push({type:'PUNCT', value:two, line}); i+=2; continue; }
      if('<>+-:;,()@%='.includes(c)){ toks.push({type:'PUNCT', value:c, line}); i++; continue; }
      throw new DevScriptError(`caractere inesperado "${c}"`, line);
    }
    toks.push({type:'EOF', value:null, line});
    return toks;
  }

  class DevScriptError extends Error {
    constructor(message, line){ super(message); this.line=line; }
  }

  // ── Parser (recursive-descent) ─────────────────────────────────
  function parse(src){
    const toks=tokenize(src);
    let p=0;
    const peek=()=>toks[p];
    const next=()=>toks[p++];
    const err=(msg)=>{ throw new DevScriptError(msg, peek().line); };
    const expectPunct=(v)=>{ const t=next(); if(t.type!=='PUNCT'||t.value!==v) err(`esperado "${v}", encontrado "${t.value ?? 'fim do arquivo'}"`); return t; };
    const expectIdent=(v)=>{ const t=next(); if(t.type!=='IDENT'||(v&&t.value!==v)) err(`esperado "${v}", encontrado "${t.value ?? 'fim do arquivo'}"`); return t; };

    const localZones=Object.create(null);
    const topEffects=[];
    const topRules=[];

    function parseNumberMaybePercent(){
      let neg=false;
      if(peek().type==='PUNCT'&&peek().value==='-'){ next(); neg=true; }
      const t=next(); if(t.type!=='NUM') err(`esperado um número, encontrado "${t.value ?? 'fim do arquivo'}"`);
      let amount=neg?-t.value:t.value;
      let percent=false;
      if(peek().type==='PUNCT'&&peek().value==='%'){ next(); percent=true; }
      return {amount,percent};
    }

    function parseAtTarget(){
      expectPunct('@');
      const t=expectIdent();
      if(t.value!=='s') err(`alvo "@${t.value}" não suportado — por enquanto só existe "@s"`);
      return '@s';
    }

    // "effect NOME to @s" — sem consumir o ";" final (quem chama decide)
    function parseEffectBody(){
      expectIdent('effect');
      const name=expectIdent().value;
      expectIdent('to');
      parseAtTarget();
      return {kind:'effect', name};
    }

    function parseZoneStmt(){
      expectIdent('zone');
      const name=expectIdent().value;
      expectPunct('=');
      const shape=expectIdent();
      if(shape.value!=='circle'&&shape.value!=='rect') err(`forma de zona desconhecida "${shape.value}" (use circle ou rect)`);
      expectPunct('(');
      const args=[parseNumberMaybePercent().amount];
      while(peek().type==='PUNCT'&&peek().value===','){ next(); args.push(parseNumberMaybePercent().amount); }
      expectPunct(')');
      const need = shape.value==='circle'?3:4;
      if(args.length!==need) err(`${shape.value}() precisa de ${need} números, recebeu ${args.length}`);
      expectPunct(';');
      localZones[name]={type:shape.value,args};
    }

    function parseCondition(){
      if(peek().type==='PUNCT'&&peek().value==='@'){
        parseAtTarget();
        expectIdent('in');
        const zoneName=expectIdent().value;
        if(!localZones[zoneName]) err(`zona "${zoneName}" não foi definida antes (use "zone ${zoneName} = ...;" primeiro)`);
        return {kind:'zone', zone:zoneName};
      }
      const statTok=expectIdent();
      if(!STAT_FIELDS[statTok.value]) err(`palavra-chave de stat inválida "${statTok.value}" (use LIFE, ENERGY ou HEAT, sempre maiúsculo)`);
      const opTok=next();
      if(opTok.type!=='PUNCT'||!['<','>','<=','>=','==','!='].includes(opTok.value)) err(`esperado um comparador (< > <= >= == !=), encontrado "${opTok.value}"`);
      const value=parseNumberMaybePercent();
      return {kind:'stat', stat:statTok.value, op:opTok.value, value};
    }

    function parseAction(){
      if(peek().type==='IDENT'&&peek().value==='effect') return parseEffectBody();
      if(peek().type==='IDENT'&&peek().value==='tick'){
        next(); expectPunct('(');
        const n=next(); if(n.type!=='NUM') err('tick(N) precisa de um número');
        expectPunct(')');
        return {kind:'tick', n:n.value};
      }
      const statTok=expectIdent();
      if(!STAT_FIELDS[statTok.value]) err(`palavra-chave de stat inválida "${statTok.value}" (use LIFE, ENERGY ou HEAT, sempre maiúsculo)`);
      const opTok=next();
      if(opTok.type!=='PUNCT'||(opTok.value!=='+'&&opTok.value!=='-')) err(`esperado "+" ou "-" após ${statTok.value}, encontrado "${opTok.value}"`);
      const value=parseNumberMaybePercent();
      return {kind:'stat', stat:statTok.value, op:opTok.value, value};
    }

    function parseIfStmt(startLine){
      expectIdent('if');
      const cond=parseCondition();
      expectPunct(':');
      const actions=[parseAction()];
      while(peek().type==='PUNCT'&&peek().value===','){ next(); actions.push(parseAction()); }
      expectPunct(';');
      return {cond, actions, line:startLine};
    }

    while(peek().type!=='EOF'){
      const t=peek();
      if(t.type!=='IDENT') err(`esperado "zone", "effect" ou "if", encontrado "${t.value}"`);
      if(t.value==='zone'){ parseZoneStmt(); continue; }
      if(t.value==='effect'){ const startLine=t.line; const eff=parseEffectBody(); expectPunct(';'); topEffects.push(eff); continue; }
      if(t.value==='if'){ const startLine=t.line; topRules.push(parseIfStmt(startLine)); continue; }
      err(`palavra-chave desconhecida "${t.value}" (use "zone", "effect" ou "if")`);
    }

    return {zones:localZones, initEffects:topEffects, rules:topRules};
  }

  // ── Execução ────────────────────────────────────────────────────
  function getStatValue(stat, percent){
    const [cur,max]=STAT_FIELDS[stat];
    const v=robot[cur];
    return percent ? (v/robot[max]*100) : v;
  }
  function mutateStat(stat, op, value){
    const [cur,max]=STAT_FIELDS[stat];
    let delta = value.percent ? (value.amount/100)*robot[max] : value.amount;
    if(op==='-') delta=-delta;
    robot[cur]=clamp(robot[cur]+delta,0,robot[max]);
  }
  function evalCond(cond){
    if(cond.kind==='zone'){
      const z=zones[cond.zone]; if(!z) return false;
      if(z.type==='circle'){ const [cx,cy,r]=z.args; return Math.hypot(robot.x-cx,robot.y-cy)<=r; }
      const [x1,y1,x2,y2]=z.args;
      return robot.x>=Math.min(x1,x2)&&robot.x<=Math.max(x1,x2)&&robot.y>=Math.min(y1,y2)&&robot.y<=Math.max(y1,y2);
    }
    const cur=getStatValue(cond.stat, cond.value.percent);
    const val=cond.value.amount;
    switch(cond.op){
      case '<': return cur<val; case '>': return cur>val;
      case '<=': return cur<=val; case '>=': return cur>=val;
      case '==': return cur===val; case '!=': return cur!==val;
    }
    return false;
  }
  function applyEffect(name){
    activeEffects.set(name, {appliedAt:Date.now()});
    const h=EFFECT_HANDLERS[name];
    if(h&&h.onApply) h.onApply();
    log(`✚ efeito "${name}" aplicado a @s`);
  }
  function runActions(actions, rule){
    let cooldownTicks=1; // padrão: 1 dev-tick (500ms) — ver nota de semântica no topo
    for(const a of actions){
      if(a.kind==='stat') mutateStat(a.stat, a.op, a.value);
      else if(a.kind==='effect') applyEffect(a.name);
      else if(a.kind==='tick') cooldownTicks=a.n;
    }
    if(rule) rule._cooldown=cooldownTicks;
  }

  function loadScript(text){
    scriptText=text;
    try{
      const parsed=parse(text);
      zones=parsed.zones;
      initEffects=parsed.initEffects;
      rules=parsed.rules.map(r=>({...r,_cooldown:0}));
      parseError=null; runtimeHalted=false;
      logLines=[];
      log(`local.js carregado — ${rules.length} regra(s), ${Object.keys(zones).length} zona(s)`);
      for(const eff of initEffects) applyEffect(eff.name);
    }catch(e){
      parseError = e instanceof DevScriptError ? {message:e.message, line:e.line} : {message:String(e && e.message || e), line:'?'};
      rules=[]; zones=Object.create(null); initEffects=[];
      log(`✗ erro de sintaxe (linha ${parseError.line}): ${parseError.message}`);
    }
    renderPanel();
  }

  function tick(){
    if(typeof robot==='undefined' || typeof running==='undefined') return;
    if(!running || (typeof isPaused==='function' && isPaused())) return;
    if(parseError || runtimeHalted) return;
    try{
      for(const rule of rules){
        if(rule._cooldown>0){ rule._cooldown--; continue; }
        if(evalCond(rule.cond)) runActions(rule.actions, rule);
      }
      for(const [name] of activeEffects){
        const h=EFFECT_HANDLERS[name];
        if(h&&h.onTick) h.onTick(TICK_MS);
      }
    }catch(e){
      runtimeHalted=true;
      log(`✗ erro em tempo de execução, regras pausadas: ${e && e.message || e}`);
    }
    if(devVisible) renderPanel();
  }

  // ── UI ─────────────────────────────────────────────────────────
  let elBadge, elPanel, elBody;

  function injectStyles(){
    const css = `
      #devPanelBadge{
        position:fixed; left:10px; bottom:10px; z-index:90;
        font-family:var(--font-mono,monospace); font-size:10px; letter-spacing:.05em;
        color:var(--cyan,#00e5ff); background:var(--surface,rgba(6,16,30,.88));
        border:1px solid var(--border,rgba(0,230,255,.22)); border-radius:6px;
        padding:4px 8px; cursor:pointer; opacity:.55; transition:opacity .15s;
        user-select:none;
      }
      #devPanelBadge:hover{ opacity:1; }
      #devPanel{
        position:fixed; right:10px; bottom:10px; z-index:91;
        width:340px; max-height:70vh; overflow-y:auto;
        font-family:var(--font-mono,monospace); font-size:11px; line-height:1.45;
        color:var(--text,#cde8ff); background:var(--surface,rgba(6,16,30,.92));
        border:1px solid var(--border,rgba(0,230,255,.3)); border-radius:8px;
        box-shadow:0 8px 28px rgba(0,0,0,.5); backdrop-filter:blur(6px);
      }
      #devPanel.hidden{ display:none; }
      #devPanel .dp-head{
        display:flex; align-items:center; justify-content:space-between;
        padding:8px 10px; border-bottom:1px solid var(--border,rgba(0,230,255,.22));
        font-family:var(--font-ui,sans-serif); font-size:11px; color:var(--cyan,#00e5ff);
      }
      #devPanel .dp-head b{ letter-spacing:.06em; }
      #devPanel .dp-dot{ width:7px; height:7px; border-radius:50%; display:inline-block; margin-right:6px; }
      #devPanel .dp-close{ cursor:pointer; opacity:.6; }
      #devPanel .dp-close:hover{ opacity:1; }
      #devPanel .dp-section{ padding:8px 10px; border-bottom:1px solid rgba(0,230,255,.1); }
      #devPanel .dp-section:last-child{ border-bottom:none; }
      #devPanel .dp-section h4{ font-size:9px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted,rgba(205,232,255,.45)); margin-bottom:5px; font-weight:400; }
      #devPanel .dp-stat-row{ display:flex; justify-content:space-between; }
      #devPanel .dp-err{ color:var(--red,#ef4444); white-space:pre-wrap; }
      #devPanel .dp-rule{ margin-bottom:4px; opacity:.85; }
      #devPanel .dp-rule.on-cd{ opacity:.4; }
      #devPanel .dp-log{ max-height:110px; overflow-y:auto; color:var(--muted,rgba(205,232,255,.5)); }
      #devPanel .dp-log div{ white-space:pre-wrap; word-break:break-word; }
      #devPanel .dp-btns{ display:flex; gap:6px; flex-wrap:wrap; }
      #devPanel button{
        font-family:var(--font-mono,monospace); font-size:10px; cursor:pointer;
        background:rgba(0,230,255,.08); color:var(--cyan,#00e5ff);
        border:1px solid var(--border,rgba(0,230,255,.3)); border-radius:5px; padding:4px 8px;
      }
      #devPanel button:hover{ background:rgba(0,230,255,.18); }
    `;
    const style=document.createElement('style');
    style.textContent=css;
    document.head.appendChild(style);
  }

  function fmt(n){ return Math.round(n*10)/10; }

  function renderPanel(){
    if(!elBody) return;
    const statusColor = parseError ? 'var(--red,#ef4444)' : runtimeHalted ? 'var(--orange,#fb923c)' : 'var(--green,#22c55e)';
    let statsHtml='';
    if(typeof robot!=='undefined'){
      statsHtml = `
        <div class="dp-stat-row"><span>LIFE</span><span>${fmt(robot.hp)}/${robot.maxHp} (${fmt(robot.hp/robot.maxHp*100)}%)</span></div>
        <div class="dp-stat-row"><span>ENERGY</span><span>${fmt(robot.energy)}/${robot.maxEnergy} (${fmt(robot.energy/robot.maxEnergy*100)}%)</span></div>
        <div class="dp-stat-row"><span>HEAT</span><span>${fmt(robot.heat)}/${robot.maxHeat} (${fmt(robot.heat/robot.maxHeat*100)}%)</span></div>`;
    } else {
      statsHtml = `<div class="dp-stat-row"><span>—</span><span>partida não iniciada</span></div>`;
    }

    let rulesHtml = rules.length
      ? rules.map(r=>`<div class="dp-rule${r._cooldown>0?' on-cd':''}">${r._cooldown>0?'⏳':'▸'} ${escapeHtml(condToStr(r.cond))} → ${r.actions.map(actionToStr).join(', ')}</div>`).join('')
      : '<div style="opacity:.5">nenhuma regra</div>';

    let zonesHtml = Object.keys(zones).length
      ? Object.entries(zones).map(([n,z])=>`<div>${escapeHtml(n)}: ${z.type}(${z.args.join(', ')})</div>`).join('')
      : '<div style="opacity:.5">nenhuma zona</div>';

    let effectsHtml = activeEffects.size
      ? [...activeEffects.entries()].map(([n,info])=>`<div>${escapeHtml(n)} <span style="opacity:.5">· ${Math.round((Date.now()-info.appliedAt)/1000)}s</span></div>`).join('')
      : '<div style="opacity:.5">nenhum efeito ativo</div>';

    const errHtml = parseError ? `<div class="dp-section"><h4>Erro de sintaxe (linha ${parseError.line})</h4><div class="dp-err">${escapeHtml(parseError.message)}</div></div>` : '';
    const haltedHtml = runtimeHalted ? `<div class="dp-section"><div class="dp-err">Execução pausada por erro — corrija e clique em Recarregar.</div></div>` : '';

    elBody.innerHTML = `
      <div class="dp-section">
        <h4>Stats</h4>
        ${statsHtml}
      </div>
      ${errHtml}${haltedHtml}
      <div class="dp-section">
        <h4>Regras (${rules.length})</h4>
        ${rulesHtml}
      </div>
      <div class="dp-section">
        <h4>Zonas (${Object.keys(zones).length})</h4>
        ${zonesHtml}
      </div>
      <div class="dp-section">
        <h4>Efeitos ativos (${activeEffects.size})</h4>
        ${effectsHtml}
      </div>
      <div class="dp-section">
        <h4>Log</h4>
        <div class="dp-log">${logLines.slice().reverse().map(l=>`<div>${escapeHtml(l)}</div>`).join('')}</div>
      </div>
      <div class="dp-section dp-btns">
        <button id="dpReload">↺ Recarregar local.js</button>
        <button id="dpClearFx">✕ Limpar efeitos</button>
      </div>
    `;
    const dot=elPanel.querySelector('.dp-dot'); if(dot) dot.style.background=statusColor;
    const btnReload=document.getElementById('dpReload'); if(btnReload) btnReload.onclick=fetchAndLoad;
    const btnClear=document.getElementById('dpClearFx'); if(btnClear) btnClear.onclick=()=>{ activeEffects.clear(); log('efeitos limpos manualmente'); renderPanel(); };
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function condToStr(c){
    if(c.kind==='zone') return `@s in ${c.zone}`;
    return `${c.stat} ${c.op} ${c.value.amount}${c.value.percent?'%':''}`;
  }
  function actionToStr(a){
    if(a.kind==='effect') return `effect ${a.name} to @s`;
    if(a.kind==='tick') return `tick(${a.n})`;
    return `${a.stat}${a.op}${a.value.amount}${a.value.percent?'%':''}`;
  }

  function buildDom(){
    elBadge=document.createElement('div');
    elBadge.id='devPanelBadge';
    elBadge.textContent='🛠 DEV (F3)';
    elBadge.onclick=toggleVisible;
    document.body.appendChild(elBadge);

    elPanel=document.createElement('div');
    elPanel.id='devPanel';
    elPanel.className='hidden';
    elPanel.innerHTML = `
      <div class="dp-head">
        <b><span class="dp-dot"></span>DEV PAINEL — local.js</b>
        <span class="dp-close" id="dpClose">✕</span>
      </div>
      <div id="dpBody"></div>
    `;
    document.body.appendChild(elPanel);
    elBody=document.getElementById('dpBody');
    document.getElementById('dpClose').onclick=toggleVisible;
  }

  function toggleVisible(){
    devVisible=!devVisible;
    elPanel.classList.toggle('hidden', !devVisible);
    if(devVisible) renderPanel();
  }

  function onKeydown(e){
    const tag=(e.target&&e.target.tagName)||'';
    if(tag==='INPUT'||tag==='TEXTAREA') return;
    if(e.key==='F3'){ e.preventDefault(); toggleVisible(); }
  }

  // ── Bootstrap ─────────────────────────────────────────────────
  function fetchAndLoad(){
    return fetch('assets/local.js', {cache:'no-store'})
      .then(res=>{
        if(!res.ok) throw new Error('not found');
        return res.text();
      })
      .then(text=>{
        if(!devEnabled){
          devEnabled=true;
          injectStyles();
          buildDom();
          window.addEventListener('keydown', onKeydown);
          setInterval(tick, TICK_MS);
        }
        loadScript(text);
      })
      .catch(()=>{ /* sem assets/local.js — painel dev fica desativado */ });
  }

  function init(){ fetchAndLoad(); }
  if(document.readyState==='loading') window.addEventListener('DOMContentLoaded', init);
  else init();

  // Ponto de extensão pra registrar efeitos custom a partir de outro
  // script local (ex.: console do navegador, ou outro arquivo carregado
  // depois deste): DevPanel.registerEffect('meuEfeito', { onApply(){...}, onTick(dtMs){...}, onExpire(){...} })
  window.DevPanel = { registerEffect };

})();
