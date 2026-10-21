#!/usr/bin/env node
/* ============================================================
   SIGNAL LOST — scripts/add-chip.js
   Assistente de terminal para cadastrar novos chips roguelike
   sem precisar mexer direto no roguelike.js na mão.

   Uso:
     node scripts/add-chip.js

   O script pergunta os dados do chip, valida tudo (incluindo
   sintaxe real do código da função apply()), mostra uma
   animaçãozinha de "processando" e insere o chip pronto,
   formatado, no CHIP_POOL do roguelike.js.
   ============================================================ */
'use strict';

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const ROGUELIKE_PATH = path.join(__dirname, '..', 'roguelike.js');
const ANCHOR = '// __ADD_CHIP_ANCHOR__';

// Arquivos que rodam no MESMO escopo global do navegador que roguelike.js —
// tudo que é declarado no "nível raiz" (coluna 0) deles fica visível dentro
// do apply() de um chip, exatamente como se apply() estivesse escrito à mão
// dentro do roguelike.js. É esse conjunto que usamos pra validar de verdade
// se o código do usuário só referencia coisas que existem.
const GAME_FILES = [
  'game.js','biomes.js','ai-enemy.js','ai-survival.js',
  'world-gen.js','scanner.js','roguelike.js',
];

// ─── Cores ANSI (sem dependências externas) ────────────────────
const c = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  cyan:'\x1b[36m', green:'\x1b[32m', red:'\x1b[31m',
  yellow:'\x1b[33m', magenta:'\x1b[35m', gray:'\x1b[90m',
};
const paint = (col, s) => `${c[col]}${s}${c.reset}`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Node fecha a interface do readline sozinho assim que o stdin não-TTY
// (pipe/redirecionamento) chega ao EOF, mesmo com perguntas ainda por vir.
// Em um terminal de verdade (TTY) isso nunca acontece, então detectamos
// os dois casos: TTY usa question() normalmente; entrada não-TTY é lida
// inteira de uma vez e servida linha a linha de uma fila.
const isTTY = !!process.stdin.isTTY;
let inputQueue = null;
if(!isTTY){
  const all = fs.readFileSync(0, 'utf8'); // lê todo o stdin de uma vez
  inputQueue = all.split('\n');
  if(inputQueue.length && inputQueue[inputQueue.length-1]==='') inputQueue.pop();
}

function ask(question){
  if(isTTY){
    return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
  }
  process.stdout.write(question);
  const line = inputQueue.length ? inputQueue.shift() : '';
  process.stdout.write(line + '\n');
  return Promise.resolve(line.trim());
}

// Pergunta obrigatória: repete até vir algo não-vazio
async function askRequired(question){
  let answer = '';
  while(!answer){
    answer = await ask(question);
    if(!answer) console.log(paint('red', '  ⚠ Esse campo não pode ficar vazio.'));
  }
  return answer;
}

// Pergunta sim/não
async function askYesNo(question, def='n'){
  const suf = def==='s' ? ' [S/n] ' : ' [s/N] ';
  const answer = (await ask(question+suf)).toLowerCase();
  if(!answer) return def==='s';
  return answer.startsWith('s');
}

// ─── Animação de spinner (\, |, /, -) ───────────────────────────
function spinner(label){
  const frames = ['\\','|','/','-'];
  let i = 0;
  process.stdout.write('  ');
  const timer = setInterval(() => {
    process.stdout.write(`\r  ${paint('cyan', frames[i])} ${label}`);
    i = (i+1) % frames.length;
  }, 90);
  return {
    stop(finalMsg, ok=true){
      clearInterval(timer);
      const icon = ok ? paint('green','✔') : paint('red','✘');
      process.stdout.write(`\r  ${icon} ${finalMsg}${' '.repeat(20)}\n`);
    }
  };
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// ─── Utilitários ────────────────────────────────────────────────
function slugify(str){
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .replace(/_+/g,'_') || 'chip';
}

function readPool(){
  return fs.readFileSync(ROGUELIKE_PATH, 'utf8');
}

function existingIds(source){
  const ids = new Set();
  const re = /id:\s*'([^']+)'/g;
  let m;
  while((m = re.exec(source))) ids.add(m[1]);
  return ids;
}

// Indenta cada linha do corpo da função digitada pelo usuário
function indentCode(code, spaces){
  const pad = ' '.repeat(spaces);
  return code
    .split('\n')
    .map(l => l.trim().length ? pad+l : '')
    .join('\n');
}

// ─── Escopo real do jogo (pra validar de verdade, não só sintaxe) ─
// Lê os arquivos que rodam junto com roguelike.js e extrai todo
// identificador declarado NA COLUNA 0 (topo do arquivo) — isso é
// exatamente o que fica "global" e visível de dentro do apply() de
// um chip. Uma variável local de outra função (ex.: `mult` dentro
// de rogueGetDamageMult, que fica indentada) nunca entra nessa
// lista — de propósito, porque de dentro do apply() ela realmente
// não existe.
function extractGlobalIdentifiers(){
  const names = new Set();
  const declRe = /^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/;
  for(const file of GAME_FILES){
    const p = path.join(__dirname, '..', file);
    if(!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    for(const line of lines){
      const m = declRe.exec(line);
      if(m) names.add(m[1] || m[2]);
    }
  }
  return names;
}

// Extrai os nomes dos campos de ROGUE.mods diretamente do roguelike.js,
// pra mostrar um "cardápio" sempre atualizado (se alguém adicionar um
// mod novo no arquivo, o script já aprende sozinho na próxima vez).
function extractModsFields(source){
  const start = source.indexOf('mods: {');
  if(start===-1) return [];
  let i = source.indexOf('{', start), depth = 0, end = i;
  for(; i<source.length; i++){
    if(source[i]==='{') depth++;
    else if(source[i]==='}'){ depth--; if(depth===0){ end=i; break; } }
  }
  const block = source.slice(i+1, end);
  const fields = [];
  const re = /^\s*([A-Za-z_$][\w$]*)\s*:/gm;
  let m;
  while((m = re.exec(block))) fields.push(m[1]);
  return fields;
}

// Armadilhas conhecidas: nomes que alguém pode "achar" que existem
// porque aparecem em funções vizinhas do roguelike.js, mas que são
// variáveis LOCAIS daquelas funções e não chegam até o apply() do chip.
const KNOWN_PITFALLS = {
  mult: 'É a variável local de dentro de rogueGetDamageMult()/rogueGetCooldownMult() — não existe fora delas.\n    Pra afetar dano use  ROGUE.mods.dmgMult *= X;   pra cooldown use  ROGUE.mods.cooldownMult *= X;',
  dmg:  'É o parâmetro local de rogueOnRobotDamage(amount)/rogueOnEnemyDamaged(dmg) — não existe aqui.\n    O dano causado pelo robô não fica disponível dentro do apply() de um chip.',
  amount: 'É o parâmetro local de rogueOnRobotDamage(amount) — não existe aqui.',
  tile: 'É uma variável local calculada dentro de outras funções (ex.: rogueGetDamageMult) — não existe aqui.\n    Se precisar do tile do robô, calcule você mesmo:  getTile(Math.floor(robot.x/TILE), Math.floor(robot.y/TILE))',
  fx:   'É a variável local de applyBiomeEffects() no biomes.js — não existe aqui.',
  e:    'É o nome da variável de loop usado dentro de funções de inimigos (ex.: updateEnemiesAI) — não existe aqui, pois o apply() do chip não roda dentro desse loop.',
};

function explainReferenceError(message){
  const m = /([A-Za-z_$][\w$]*) is not defined/.exec(message);
  if(!m) return null;
  const varName = m[1];
  const hint = KNOWN_PITFALLS[varName];
  return { varName, hint };
}

// ─── Fluxo principal ─────────────────────────────────────────────
async function main(){
  console.log('');
  console.log(paint('cyan', paint('bold', '╔══════════════════════════════════════════════════╗')));
  console.log(paint('cyan', paint('bold', '║   SIGNAL LOST — Cadastro de novo chip roguelike   ║')));
  console.log(paint('cyan', paint('bold', '╚══════════════════════════════════════════════════╝')));
  console.log(paint('gray', '  (Ctrl+C a qualquer momento cancela sem salvar nada)\n'));

  if(!fs.existsSync(ROGUELIKE_PATH)){
    console.log(paint('red', `✘ Não encontrei roguelike.js em: ${ROGUELIKE_PATH}`));
    process.exit(1);
  }

  // ── 1. Nome do chip ──────────────────────────────────────────
  const title = await askRequired('qual o nome do chip: ');

  // ── id (gerado automaticamente, mas editável) ────────────────
  const source = readPool();
  const usedIds = existingIds(source);
  let suggestedId = slugify(title);
  if(usedIds.has(suggestedId)){
    let n = 2;
    while(usedIds.has(`${suggestedId}_${n}`)) n++;
    suggestedId = `${suggestedId}_${n}`;
  }
  let id = await ask(`id interno [${suggestedId}]: `);
  if(!id) id = suggestedId;
  while(usedIds.has(id)){
    console.log(paint('red', `  ⚠ Já existe um chip com id "${id}". Escolha outro.`));
    id = await askRequired('id interno: ');
  }

  // ── 2. Emoji ──────────────────────────────────────────────────
  const emoji = await askRequired('emoji: ');

  // ── 3. Características (descrição mostrada na carta) ─────────
  const desc = await askRequired('caracteristicas (texto que aparece na carta do chip): ');
  const sub = await ask('texto secundário/efeito temporário (opcional, Enter p/ pular): ');

  // ── 4. Repetível? ────────────────────────────────────────────
  const repeatable = await askYesNo('esse chip pode ser escolhido várias vezes (repetível)?', 'n');
  let maxStacks = null;
  if(repeatable){
    const ms = await ask('limite de vezes que pode ser escolhido (Enter = sem limite): ');
    if(ms && !isNaN(parseInt(ms,10)) && parseInt(ms,10)>0) maxStacks = parseInt(ms,10);
  }

  // ── 5. Raridade ──────────────────────────────────────────────
  console.log('');
  console.log('raridade:');
  console.log(`  1) ${paint('gray','Comum')}    (peso 10 — mais provável de aparecer)`);
  console.log(`  2) ${paint('cyan','Raro')}     (peso 5)`);
  console.log(`  3) ${paint('magenta','Épico')}    (peso 2)`);
  console.log(`  4) ${paint('yellow','Lendário')} (peso 1 — mais raro)`);
  let rarityChoice = await ask('escolha [1-4] (padrão 1): ');
  const rarityMap = { '1':'comum', '2':'raro', '3':'epico', '4':'lendario' };
  const rarity = rarityMap[rarityChoice] || 'comum';

  // ── 6. Código da função apply() ──────────────────────────────
  const modsFields = extractModsFields(source);
  console.log('');
  console.log(paint('gray', '  código em uma função — o que o chip faz de verdade (JavaScript).'));
  console.log(paint('gray', '  O código roda dentro de apply(), no MESMO escopo global do jogo —'));
  console.log(paint('gray', '  então funções e variáveis do topo de qualquer arquivo (robot, T, TILE,'));
  console.log(paint('gray', '  getTile, showAlert, spawnBurst, spawnParticle, getUpgradeValue...) funcionam.'));
  console.log(paint('yellow','  ⚠ MAS: variáveis LOCAIS de dentro de outras funções (ex.: `mult` dentro de'));
  console.log(paint('yellow','    rogueGetDamageMult) NÃO existem aqui — são internas daquela função.'));
  console.log(paint('gray', '  Pra efeitos de chip, o jeito certo é sempre mexer em ROGUE.mods:'));
  if(modsFields.length){
    const cols = modsFields.map(f=>`ROGUE.mods.${f}`);
    for(let i=0;i<cols.length;i+=3) console.log(paint('cyan','    '+cols.slice(i,i+3).join('   ')));
  }
  console.log(paint('gray', '  Exemplo:  ROGUE.mods.armorMult *= 0.9;   (não  armorMult *= 0.9  nem  mult *= 0.9)'));
  console.log(paint('gray', '  Digite o código (pode ser várias linhas). Termine com uma linha só com: FIM\n'));
  let codeLines = [];
  while(true){
    const line = await ask(codeLines.length===0 ? '> ' : '> ');
    if(line.trim().toUpperCase()==='FIM') break;
    codeLines.push(line);
  }
  const rawCode = codeLines.join('\n').trim();
  if(!rawCode){
    console.log(paint('red', '✘ Nenhum código foi digitado. Cancelando — nada foi salvo.'));
    process.exit(1);
  }

  // ── Validação: sintaxe E escopo real (pega o caso do "mult") ──
  const sp1 = spinner('validando sintaxe e escopo do código...');
  await sleep(600);

  const globalNames = Array.from(extractGlobalIdentifiers());
  // Valores realistas pros nomes mais usados por chips; os demais
  // (centenas de outras funções do jogo) entram como `undefined` —
  // não importa pro que estamos testando aqui, que é só "essa
  // variável existe no escopo ou não existe em lugar nenhum".
  const stubs = {
    ROGUE: { mods: Object.fromEntries(extractModsFields(source).map(f=>[f, (f==='biomeDmg')?{}:(f==='biomeProcs')?[]:1])),
             pickedIds:new Set(), pickedCounts:{}, shieldCharges:0, secondWindReady:false,
             overclock:{active:false,dmgMult:1,cooldownMult:1}, procCooldowns:{}, choices:[] },
    robot: { x:0,y:0,hp:100,maxHp:100,energy:100,maxEnergy:100,heat:0,maxHeat:100,
              radius:14,angle:0,vx:0,vy:0,invTimer:0,dead:false },
    T: new Proxy({}, { get:()=>1 }), // qualquer T.ALGUMA_COISA vira 1, sem quebrar
    TILE: 32, W:800, H:600, time: 0, wave: 1, score: 0,
    enemies: [], ownedWeapons: new Set(['LASER']), ownedAbilities: new Set(), evolution: { level:1, points:0 },
    getTile: ()=>0, inBounds: ()=>true,
    getUpgradeValue: ()=>1, applyPassiveBonuses: ()=>{},
    showAlert: ()=>{}, spawnBurst: ()=>{}, spawnParticle: ()=>{}, spawnXPOrb: ()=>{},
    ROGUE_BIOMES: ()=>({}), rogueRarityWeight: ()=>1,
  };
  const values = globalNames.map(n => (n in stubs) ? stubs[n] : undefined);

  try{
    // eslint-disable-next-line no-new-func
    const factory = new Function(...globalNames, `return { apply(){\n${rawCode}\n} };`);
    const testChip = factory(...values);
    testChip.apply(); // executa de verdade — é isso que pega "mult is not defined"
    sp1.stop('código válido (sintaxe e escopo conferidos)', true);
  }catch(err){
    sp1.stop(err instanceof ReferenceError ? 'variável inexistente no código' : 'erro ao testar o código', false);
    if(err instanceof SyntaxError){
      console.log(paint('red', `  Erro de sintaxe: ${err.message}`));
      console.log(paint('yellow', '  Nada foi salvo. Rode o script de novo e revise o código.'));
      process.exit(1);
    }
    if(err instanceof ReferenceError){
      const info = explainReferenceError(err.message);
      console.log(paint('red', `  ${err.message}`));
      if(info && info.hint){
        console.log(paint('yellow', `  💡 ${info.hint}`));
      } else {
        console.log(paint('yellow', `  💡 "${info?info.varName:'?'}" não é uma função/variável global do jogo — confira o nome (maiúsculas/minúsculas incluídas).`));
      }
      console.log(paint('yellow', '  Nada foi salvo. Rode o script de novo e revise o código.'));
      process.exit(1);
    }
    // Outros erros (TypeError etc.) podem ser falso-positivo: os valores usados
    // no teste são só placeholders, não o estado real do jogo. Avisa e deixa
    // a pessoa decidir se quer confiar no código mesmo assim.
    console.log(paint('yellow', `  ⚠ O teste encontrou um erro, mas pode ser falso-positivo (os dados do teste são fictícios):`));
    console.log(paint('yellow', `  ${err.constructor.name}: ${err.message}`));
    const proceedAnyway = await askYesNo('  quer inserir o chip mesmo assim?', 'n');
    if(!proceedAnyway){
      console.log(paint('yellow', '  Nada foi salvo.'));
      process.exit(1);
    }
  }

  // ── Montar o objeto do chip ──────────────────────────────────
  const indented = indentCode(rawCode, 6);
  const subLine = sub ? `\n    sub:${JSON.stringify(sub)},` : '';
  const maxStacksLine = maxStacks ? ` maxStacks:${maxStacks},` : '';
  const chipSrc =
`  { id:${JSON.stringify(id)}, emoji:${JSON.stringify(emoji)}, title:${JSON.stringify(title)}, repeatable:${repeatable},${maxStacksLine} rarity:${JSON.stringify(rarity)},
    desc:${JSON.stringify(desc)},${subLine}
    apply(){
${indented}
    } },
`;

  console.log('');
  console.log(paint('gray', '  Pré-visualização do chip que será inserido:'));
  console.log(paint('dim', chipSrc));

  const confirm = await askYesNo('confirma a inserção no roguelike.js?', 's');
  if(!confirm){
    console.log(paint('yellow', 'Cancelado. Nada foi salvo.'));
    process.exit(0);
  }

  // ── Inserir no arquivo, com backup e validação final ─────────
  const sp2 = spinner('inserindo chip no roguelike.js...');
  await sleep(500);

  if(!source.includes(ANCHOR)){
    sp2.stop(`não encontrei o marcador ${ANCHOR} no roguelike.js`, false);
    console.log(paint('red', '  O arquivo pode ter sido editado manualmente. Inserção abortada — nada foi alterado.'));
    process.exit(1);
  }

  const backup = source;
  const newSource = source.replace(ANCHOR, `${chipSrc}\n  ${ANCHOR}`);
  fs.writeFileSync(ROGUELIKE_PATH, newSource, 'utf8');

  sp2.stop('chip inserido no arquivo', true);

  // Validação final: o arquivo inteiro ainda precisa ser um JS válido
  const sp3 = spinner('validando roguelike.js completo (node --check)...');
  await sleep(500);
  try{
    execFileSync(process.execPath, ['--check', ROGUELIKE_PATH], { stdio: 'pipe' });
    sp3.stop('roguelike.js válido — tudo certo!', true);
  }catch(err){
    // Reverte para não deixar o jogo quebrado
    fs.writeFileSync(ROGUELIKE_PATH, backup, 'utf8');
    sp3.stop('roguelike.js ficou inválido após a inserção — revertido', false);
    console.log(paint('red', '  ' + err.stderr.toString().split('\n').slice(0,4).join('\n  ')));
    console.log(paint('yellow', '  O arquivo original foi restaurado. Nenhuma alteração ficou salva.'));
    process.exit(1);
  }

  console.log('');
  console.log(paint('green', paint('bold', `✔ Chip "${title}" ${emoji} adicionado com sucesso! (id: ${id}, raridade: ${rarity})`)));
  console.log(paint('gray', '  Recarregue o jogo no navegador para ver o novo chip no pool.\n'));

  rl.close();
}

main().catch(err => {
  console.log(paint('red', `\n✘ Erro inesperado: ${err.message}`));
  process.exit(1);
});
