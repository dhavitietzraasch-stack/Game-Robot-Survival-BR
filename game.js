/* ============================================================
   SIGNAL LOST — game.js  v6.0 (beta)
   ============================================================ */
'use strict';

// ─── Tamanho do mapa (configurável pelo menu) ─────────────────
let WORLD_W = 800;
let WORLD_H = 600;

// ─── Constants ───────────────────────────────────────────────
const TILE        = 32;
const LASER_RANGE = 520;
const BUILD_RANGE = 160;

let   playerSpawnShip  = null; // { cx, cy, rx, ry } — nave de início do jogador

// Chunk system (dinâmico — atualizado ao mudar tamanho do mapa)
const CHUNK_SIZE = 16;
let CHUNKS_X = Math.ceil(WORLD_W / CHUNK_SIZE);
let CHUNKS_Y = Math.ceil(WORLD_H / CHUNK_SIZE);

const FLOW_UPDATE_INTERVAL = 45;
let   flowTimer = 0;

// ─── Modos de Jogo ───────────────────────────────────────────
// SURVIVAL: sobreviver o máximo possível às ondas — a partida só termina
// com a destruição de UNIDADE-7 (não há mais condição de vitória por resgate).
// CREATIVE: sem inimigos, construção livre.
const GAME_MODES = { SURVIVAL:'survival', CREATIVE:'creative' };
let gameMode = GAME_MODES.SURVIVAL;

// ─── Importação de mapa personalizado ────────────────────────
let _importedMapData = null; // dados JSON de mapa importado

// ─── Tile IDs ────────────────────────────────────────────────
const T = {
  AIR:0, DEEP_WATER:1, WATER:2, SAND:3, GRASS:4, FOREST:5,
  ROCK:6, SNOW:7, LAVA:8, ICE:9, DESERT:10,
  DIRT:11, STONE:12, IRON:13, CRYSTAL:14, OBSIDIAN:15,
  BUILT_BLOCK:16, CAVE_WALL:17, CAVE_FLOOR:18, MUSHROOM:19,
  SWAMP:20, TOXIC:21, VOLCANIC_ASH:22, CORAL:23, TUNDRA:24, SAVANNA:25,
  REINFORCED:26, TRAP_SLOW:27, TRAP_DAMAGE:28, SPIKE_BLOCK:29,
  VOID_FLOOR:30, VOID_WALL:31, PORTAL:32, MAGMA_ROCK:33, CRYSTAL_FLOOR:34,
  GHOST_GRASS:35, RUNE_STONE:36,
  // Novos blocos de construção
  GLASS_BLOCK:37, COPPER_BLOCK:38, CRYSTAL_WALL:39,
};

const TILE_COST = {
  [T.AIR]:Infinity,
  [T.WATER]:2.5, [T.DEEP_WATER]:5, [T.SAND]:1.2, [T.GRASS]:1, [T.FOREST]:1.5,
  [T.SNOW]:1.4, [T.ICE]:1.0, [T.DESERT]:1.3, [T.MUSHROOM]:1.8,
  [T.LAVA]:8, [T.SWAMP]:2.5, [T.TOXIC]:2, [T.VOLCANIC_ASH]:1.5,
  [T.CORAL]:2.5, [T.TUNDRA]:1.4, [T.SAVANNA]:1.1,
  [T.ROCK]:Infinity, [T.DIRT]:Infinity, [T.STONE]:Infinity, [T.IRON]:Infinity,
  [T.CRYSTAL]:Infinity, [T.OBSIDIAN]:Infinity, [T.BUILT_BLOCK]:Infinity,
  [T.CAVE_WALL]:Infinity, [T.CAVE_FLOOR]:1,
  [T.REINFORCED]:Infinity, [T.TRAP_SLOW]:1, [T.TRAP_DAMAGE]:1, [T.SPIKE_BLOCK]:Infinity,
  [T.VOID_FLOOR]:1.2, [T.VOID_WALL]:Infinity, [T.PORTAL]:1,
  [T.MAGMA_ROCK]:Infinity, [T.CRYSTAL_FLOOR]:1.1, [T.GHOST_GRASS]:1.3, [T.RUNE_STONE]:Infinity,
  [T.GLASS_BLOCK]:Infinity, [T.COPPER_BLOCK]:Infinity, [T.CRYSTAL_WALL]:Infinity,
};
function tileCost(id){ const c=TILE_COST[id]; return (c===undefined)?Infinity:c; }

const SOLID = new Set([
  T.ROCK, T.DIRT, T.STONE, T.IRON, T.CRYSTAL, T.OBSIDIAN,
  T.BUILT_BLOCK, T.CAVE_WALL, T.REINFORCED, T.SPIKE_BLOCK,
  T.VOID_WALL, T.MAGMA_ROCK,
  // RUNE_STONE removido de SOLID: é interativo (cura), não deve bloquear passagem
  T.GLASS_BLOCK, T.COPPER_BLOCK, T.CRYSTAL_WALL,
]);
const DESTROYABLE = new Set([
  T.ROCK, T.BUILT_BLOCK, T.TRAP_SLOW, T.TRAP_DAMAGE, T.SPIKE_BLOCK, T.RUNE_STONE,
  T.CAVE_WALL, T.STONE, T.IRON, T.CRYSTAL, T.OBSIDIAN, T.DIRT,
  T.GLASS_BLOCK, T.COPPER_BLOCK, T.CRYSTAL_WALL,
]);

const BLOCK_INTEGRITY = {
  [T.BUILT_BLOCK]:100,   [T.REINFORCED]:400,
  [T.TRAP_SLOW]:60,      [T.TRAP_DAMAGE]:60,   [T.SPIKE_BLOCK]:80,   [T.RUNE_STONE]:200,
  [T.CAVE_WALL]:80,      [T.STONE]:120,        [T.IRON]:200,
  [T.CRYSTAL]:150,       [T.OBSIDIAN]:350,     [T.DIRT]:60,
  [T.GLASS_BLOCK]:60,    [T.COPPER_BLOCK]:150, [T.CRYSTAL_WALL]:200,
};

// Blocos raros: ao serem destruídos, soltam orbs de XP
const RARE_BLOCK_XP = {
  [T.IRON]:         20,
  [T.CRYSTAL]:      30,
  [T.OBSIDIAN]:     45,
  [T.COPPER_BLOCK]: 18,
  [T.CRYSTAL_WALL]: 35,
  [T.RUNE_STONE]:   40,
  [T.REINFORCED]:   12,
};

/** Chamado quando um bloco é completamente destruído.
 *  Garante score + burst + XP (se for raro). */
function onBlockBroken(tx, ty, oldTile, opts={}){
  const wx = tx*TILE + TILE/2;
  const wy = ty*TILE + TILE/2;
  if(opts.burst !== false){
    spawnBurst(wx, wy, opts.burstColor || '#fbbf24', opts.burstN || 6, opts.burstSpeed || 2);
  }
  if(opts.score !== false && !opts.isEnemy){
    score += (opts.scoreAmt != null ? opts.scoreAmt : 2);
  }
  const xpAmt = RARE_BLOCK_XP[oldTile];
  if(xpAmt && typeof spawnXPOrb === 'function'){
    spawnXPOrb(wx, wy, xpAmt);
  }
}

const BIOME_INFO = {
  surface:{
    [T.GRASS]:       {name:'Pradaria',          drag:.984},
    [T.FOREST]:      {name:'Floresta',          drag:.982},
    [T.SAND]:        {name:'Praia',             drag:.980},
    [T.ROCK]:        {name:'Montanha',          drag:.984},
    [T.SNOW]:        {name:'Neve',              drag:.981},
    [T.ICE]:         {name:'Glacial',           drag:.975},
    [T.DESERT]:      {name:'Deserto',           drag:.979},
    [T.LAVA]:        {name:'Vulcânico',         drag:.900},
    [T.MUSHROOM]:    {name:'Fungal',            drag:.983},
    [T.DEEP_WATER]:  {name:'Mar Profundo',      drag:.880},
    [T.WATER]:       {name:'Água Rasa',         drag:.940},
    [T.SWAMP]:       {name:'Pântano',           drag:.970},
    [T.TOXIC]:       {name:'Zona Tóxica',       drag:.930},
    [T.VOLCANIC_ASH]:{name:'Cinzas Vulcânicas', drag:.982},
    [T.CORAL]:       {name:'Recife de Coral',   drag:.890},
    [T.TUNDRA]:      {name:'Tundra',            drag:.982},
    [T.SAVANNA]:     {name:'Savana',            drag:.981},
    [T.PORTAL]:      {name:'Antena',            drag:.984},
    [T.DIRT]:        {name:'Terra',             drag:.984},
    [T.STONE]:       {name:'Pedra',             drag:.984},
    [T.IRON]:        {name:'Minério de Ferro',  drag:.984},
    [T.CRYSTAL]:     {name:'Cristal',           drag:.984},
    [T.OBSIDIAN]:    {name:'Obsidiana',         drag:.984},
    [T.CAVE_WALL]:   {name:'Estrutura',         drag:.984},
    [T.CAVE_FLOOR]:  {name:'Chão de Estrutura', drag:.984},
    [T.CRYSTAL_FLOOR]:{name:'Chão de Cristal',  drag:.985},
    [T.VOID_FLOOR]:  {name:'Assoalho Anômalo',  drag:.990},
    [T.GHOST_GRASS]: {name:'Grama Fantasma',    drag:.985},
  },
};

// ── Qualidade "batata" = zero animação ────────────────────────
const IS_POTATO = () => (typeof QUALITY !== 'undefined' && (
  QUALITY.level === 'batata' || QUALITY.level === 'potato' ||
  QUALITY.particleScale === 0 || QUALITY.particleCap <= 5
));

// ─── Mundo (dimensão única — Superfície) ──────────────────────
const DIM = { SURFACE:0 };

// Grids alocados dinamicamente em initWorldBuffers()
let worldGrids = {};
let integrities = {};
let currentDim = DIM.SURFACE;
function worldGrid(){ return worldGrids[currentDim]; }
function integrity(){ return integrities[currentDim]; }

let chunkDirtyBuffers = {};
let chunkDirty;
function chunkIdx(cx,cy){return cy*CHUNKS_X+cx;}
function markChunkDirty(tx,ty){
  const cx=tx>>4, cy=ty>>4;
  if(cx>=0&&cx<CHUNKS_X&&cy>=0&&cy<CHUNKS_Y) chunkDirty[chunkIdx(cx,cy)]=1;
}

// ─── Flow Fields ─────────────────────────────────────────────
let flowFields = {};
let dirFields  = {};
let flowField, dirField;

// ─── PERF: cache de cores de tile ────────────────────────────
// Tiles "estáticos" (cor não depende de `time`, só de tx/ty) têm sua
// string hsl(...) calculada uma vez e reaproveitada, em vez de recriar
// a string (e recalcular sin/cos) a cada tile visível em TODO frame.
// Invalidado por setTile() quando o tile daquele índice muda.
let tileColorCacheBuffers = {};
function initWorldBuffers(){
  CHUNKS_X = Math.ceil(WORLD_W / CHUNK_SIZE);
  CHUNKS_Y = Math.ceil(WORLD_H / CHUNK_SIZE);
  const sz = WORLD_W * WORLD_H;
  const chunkSz = CHUNKS_X * CHUNKS_Y;
  for(const d of [DIM.SURFACE]){
    worldGrids[d]      = new Uint8Array(sz);
    integrities[d]     = new Uint16Array(sz);
    chunkDirtyBuffers[d] = new Uint8Array(chunkSz).fill(1);
    flowFields[d]      = new Float32Array(sz).fill(Infinity);
    dirFields[d]       = new Uint8Array(sz);
    tileColorCacheBuffers[d] = new Array(sz).fill(null);
  }
  chunkDirty = chunkDirtyBuffers[DIM.SURFACE];
  flowField  = flowFields[DIM.SURFACE];
  dirField   = dirFields[DIM.SURFACE];
}
initWorldBuffers(); // inicializar com tamanho padrão
function wi(tx,ty){return ty*WORLD_W+tx;}
function inBounds(tx,ty){return tx>=0&&tx<WORLD_W&&ty>=0&&ty<WORLD_H;}
function getTile(tx,ty){if(!inBounds(tx,ty))return T.STONE;return worldGrid()[wi(tx,ty)];}

function setTile(tx,ty,id,integ){
  if(!inBounds(tx,ty))return;
  const idx=wi(tx,ty);
  worldGrid()[idx]=id;
  const defaultInteg = BLOCK_INTEGRITY[id] !== undefined ? BLOCK_INTEGRITY[id] : 0;
  integrity()[idx]=integ!==undefined?integ:defaultInteg;
  const colorCache=tileColorCacheBuffers[currentDim];
  if(colorCache) colorCache[idx]=null; // PERF: invalida cor cacheada (tile mudou)
  markChunkDirty(tx,ty);
  minimapDirty=true;
}

// ─── Flow Field ──────────────────────────────────────────────

class MinHeap {
  constructor(){this.data=[];}
  push(item){
    this.data.push(item);
    let i=this.data.length-1;
    while(i>0){
      const p=(i-1)>>1;
      if(this.data[p][0]<=this.data[i][0])break;
      [this.data[p],this.data[i]]=[this.data[i],this.data[p]];
      i=p;
    }
  }
  pop(){
    const top=this.data[0];
    const last=this.data.pop();
    if(this.data.length){
      this.data[0]=last;
      let i=0;
      while(true){
        let s=i,l=2*i+1,r=2*i+2;
        if(l<this.data.length&&this.data[l][0]<this.data[s][0])s=l;
        if(r<this.data.length&&this.data[r][0]<this.data[s][0])s=r;
        if(s===i)break;
        [this.data[s],this.data[i]]=[this.data[i],this.data[s]];
        i=s;
      }
    }
    return top;
  }
  get size(){return this.data.length;}
}

const DIRS = [
  [0,-1,1],[1,0,2],[0,1,3],[-1,0,4],
  [1,-1,5],[1,1,6],[-1,1,7],[-1,-1,8]
];
const DIR_DIAG_COST = Math.SQRT2;

// Raio máximo do flow field — limita o BFS para evitar lag em mundos grandes.
// 80 tiles × 32px = 2560px (~4 telas). Inimigos além disso não precisam de path.
const FLOW_RADIUS = 80;

function rebuildFlowField(playerTX, playerTY){
  // Reset apenas na janela ao redor do player (muito mais rápido que fill() total)
  const x0=Math.max(0,playerTX-FLOW_RADIUS), x1=Math.min(WORLD_W-1,playerTX+FLOW_RADIUS);
  const y0=Math.max(0,playerTY-FLOW_RADIUS), y1=Math.min(WORLD_H-1,playerTY+FLOW_RADIUS);
  for(let ty=y0;ty<=y1;ty++)
    for(let tx=x0;tx<=x1;tx++){
      const i=wi(tx,ty); flowField[i]=Infinity; dirField[i]=0;
    }

  const heap = new MinHeap();
  const start = wi(playerTX, playerTY);
  flowField[start] = 0;
  heap.push([0, playerTX, playerTY]);
  const MAX_STEPS = (FLOW_RADIUS*2+1)*(FLOW_RADIUS*2+1)*2;
  let steps = 0;
  const wg = worldGrid();
  while(heap.size > 0 && steps++ < MAX_STEPS){
    const [cost, tx, ty] = heap.pop();
    const idx = wi(tx,ty);
    if(cost > flowField[idx]) continue;
    // Não expandir além do raio
    if(Math.abs(tx-playerTX)>FLOW_RADIUS || Math.abs(ty-playerTY)>FLOW_RADIUS) continue;
    for(let d=0;d<8;d++){
      const [ddx,ddy,dirCode]=DIRS[d];
      const nx=tx+ddx, ny=ty+ddy;
      if(!inBounds(nx,ny)) continue;
      if(Math.abs(nx-playerTX)>FLOW_RADIUS || Math.abs(ny-playerTY)>FLOW_RADIUS) continue;
      const nt=wg[wi(nx,ny)];
      const tc=tileCost(nt);
      if(tc===Infinity) continue;
      if(d>=4){
        if(tileCost(wg[wi(tx+ddx,ty)])===Infinity && tileCost(wg[wi(tx,ty+ddy)])===Infinity) continue;
      }
      const extra = (d>=4)?DIR_DIAG_COST:1;
      const nc = cost + tc * extra;
      const nw = wi(nx,ny);
      if(nc < flowField[nw]){
        flowField[nw]=nc;
        dirField[nw]=dirCode;
        heap.push([nc, nx, ny]);
      }
    }
  }
}

function flowDir(ex, ey){
  const tx=Math.floor(ex/TILE), ty=Math.floor(ey/TILE);
  if(!inBounds(tx,ty)) return {dx:0,dy:0};
  let bestCost=Infinity, bdx=0, bdy=0;
  for(let d=0;d<8;d++){
    const [ddx,ddy]=DIRS[d];
    const nx=tx+ddx, ny=ty+ddy;
    if(!inBounds(nx,ny)) continue;
    const c=flowField[wi(nx,ny)];
    if(c<bestCost){ bestCost=c; bdx=ddx; bdy=ddy; }
  }
  if(bestCost===Infinity) return {dx:0,dy:0};
  const m=Math.hypot(bdx,bdy)||1;
  return {dx:bdx/m, dy:bdy/m};
}

// ─── Seeded PRNG ─────────────────────────────────────────────
function xmur3(str){
  let h=1779033703^str.length;
  for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=h<<13|h>>>19;}
  return()=>{h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return(h^=h>>>16)>>>0;};
}
function mulberry32(a){
  return()=>{let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
}
function createNoise(prng){
  // v3.1 — FIX CRÍTICO: esta tabela tinha 34 valores (faltavam 2) e a cauda
  // estava fora de ordem. O algoritmo indexa até grad[33+1]=grad[34], então
  // com só 34 valores (índices 0-33) essa leitura vinha `undefined` → NaN.
  // Isso corrompia ~1/3 dos lookups de gradiente (3 por chamada de noise()),
  // o que tornava ~86% de TODAS as amostras de ruído NaN — e como `NaN > x`
  // é sempre falso, a cascata de classificação de bioma falhava em todo
  // teste de umidade/temperatura e caía no branch final (deserto). Isso
  // explica tanto o excesso de deserto quanto a água só nas bordas (a única
  // água "real" era a máscara elíptica geométrica do passo 9, que não
  // depende deste ruído). Tabela correta: 12 vetores de gradiente × 3
  // componentes = 36 valores.
  const grad=new Float32Array([1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1]);
  const p=new Uint8Array(256);for(let i=0;i<256;i++)p[i]=i;
  for(let i=255;i>0;i--){const r=Math.floor(prng()*(i+1));[p[i],p[r]]=[p[r],p[i]];}
  const perm=new Uint8Array(512);for(let i=0;i<512;i++)perm[i]=p[i&255];
  return function(xin,yin){
    const F2=0.5*(Math.sqrt(3)-1),G2=(3-Math.sqrt(3))/6;let n0=0,n1=0,n2=0;
    const s=(xin+yin)*F2,i=Math.floor(xin+s),j=Math.floor(yin+s);
    const t2=(i+j)*G2,X0=i-t2,Y0=j-t2,x0=xin-X0,y0=yin-Y0;
    const i1=x0>y0?1:0,j1=x0>y0?0:1;
    const x1=x0-i1+G2,y1=y0-j1+G2,x2=x0-1+2*G2,y2=y0-1+2*G2;
    const ii=i&255,jj=j&255;
    const gi0=perm[ii+perm[jj]]%12*3,gi1=perm[ii+i1+perm[jj+j1]]%12*3,gi2=perm[ii+1+perm[jj+1]]%12*3;
    let t0=0.5-x0*x0-y0*y0;if(t0>=0){t0*=t0;n0=t0*t0*(grad[gi0]*x0+grad[gi0+1]*y0);}
    let t1=0.5-x1*x1-y1*y1;if(t1>=0){t1*=t1;n1=t1*t1*(grad[gi1]*x1+grad[gi1+1]*y1);}
    let t3=0.5-x2*x2-y2*y2;if(t3>=0){t3*=t3;n2=t3*t3*(grad[gi2]*x2+grad[gi2+1]*y2);}
    return 70*(n0+n1+n2);
  };
}

// ─── World Generation — Superfície ───────────────────────────
// (a geração real é definida em world-gen.js, que sobrescreve
//  window.generateSurface — sistema de dimensões extras removido)

// Não há portais entre dimensões
const portalMap = {
  [DIM.SURFACE]: [],
};

// ─── Macro-Structures ─────────────────────────────────────────
// Gera estruturas no mapa da superfície: bunkers, fábricas, torres, naves
function placeStructures(wg, ig, rand){
  const structures = [];

  // ── Bunker (retângulo de pedra com corredor interno)
  function placeBunker(cx, cy, w, h){
    for(let ty=cy;ty<cy+h;ty++){
      for(let tx=cx;tx<cx+w;tx++){
        if(!inBounds(tx,ty)) continue;
        const isWall = tx===cx||tx===cx+w-1||ty===cy||ty===cy+h-1;
        const tile = isWall ? T.STONE : T.CAVE_FLOOR;
        wg[wi(tx,ty)] = tile;
        ig[wi(tx,ty)] = isWall ? (BLOCK_INTEGRITY[T.STONE]||0) : 0;
      }
    }
    // Porta (abertura na parede sul)
    const doorX = cx + Math.floor(w/2);
    wg[wi(doorX, cy+h-1)] = T.CAVE_FLOOR;
    wg[wi(doorX-1, cy+h-1)] = T.CAVE_FLOOR;
    structures.push({type:'bunker', cx, cy, w, h});
  }

  // ── Torre de vigia (pequena base com símbolo de rune)
  function placeTower(cx, cy){
    const r = 5;
    for(let ty=cy-r;ty<=cy+r;ty++){
      for(let tx=cx-r;tx<=cx+r;tx++){
        if(!inBounds(tx,ty)) continue;
        const d = Math.hypot(tx-cx, ty-cy);
        if(d <= r){
          const tile = d>r-1 ? T.ROCK : T.CAVE_FLOOR;
          wg[wi(tx,ty)] = tile;
          ig[wi(tx,ty)] = 0;
        }
      }
    }
    wg[wi(cx,cy)] = T.RUNE_STONE;
    structures.push({type:'tower', cx, cy});
  }

  // ── Fábrica (bloco grande de obsidiana com interior)
  function placeFactory(cx, cy, w, h){
    for(let ty=cy;ty<cy+h;ty++){
      for(let tx=cx;tx<cx+w;tx++){
        if(!inBounds(tx,ty)) continue;
        const dist = Math.min(tx-cx, cx+w-1-tx, ty-cy, cy+h-1-ty);
        let tile;
        if(dist===0) tile = T.OBSIDIAN;
        else if(dist===1) tile = T.IRON;
        else tile = T.CAVE_FLOOR;
        wg[wi(tx,ty)] = tile;
        ig[wi(tx,ty)] = BLOCK_INTEGRITY[tile]||0;
      }
    }
    // Aberturas nas 4 direções
    const mx=cx+Math.floor(w/2), my=cy+Math.floor(h/2);
    wg[wi(mx, cy)] = T.CAVE_FLOOR;
    wg[wi(mx, cy+h-1)] = T.CAVE_FLOOR;
    wg[wi(cx, my)] = T.CAVE_FLOOR;
    wg[wi(cx+w-1, my)] = T.CAVE_FLOOR;
    structures.push({type:'factory', cx, cy, w, h});
  }

  // ── Nave caída (forma oval irregular com blocos especiais)
  function placeCrashedShip(cx, cy, rx, ry){
    for(let ty=cy-ry-2;ty<=cy+ry+2;ty++){
      for(let tx=cx-rx-2;tx<=cx+rx+2;tx++){
        if(!inBounds(tx,ty)) continue;
        const d = Math.hypot((tx-cx)/rx, (ty-cy)/ry);
        if(d<=1.0){
          const tile = d>0.85 ? T.REINFORCED : d>0.65 ? T.BUILT_BLOCK : T.CAVE_FLOOR;
          wg[wi(tx,ty)] = tile;
          ig[wi(tx,ty)] = BLOCK_INTEGRITY[tile]||100;
        }
      }
    }
    // Crystal no centro (loot/especial)
    wg[wi(cx,cy)] = T.CRYSTAL;
    structures.push({type:'ship', cx, cy, rx, ry});
  }

  // ── Nave destruída de spawn (onde o jogador acorda) — corpo maior com detalhes
  function placePlayerSpawnShip(cx, cy){
    const rx = 14, ry = 9;
    // Casco externo: REINFORCED
    for(let ty=cy-ry-1;ty<=cy+ry+1;ty++){
      for(let tx=cx-rx-1;tx<=cx+rx+1;tx++){
        if(!inBounds(tx,ty)) continue;
        const d = Math.hypot((tx-cx)/rx, (ty-cy)/ry);
        if(d>1.0) continue;
        let tile;
        if(d>0.88)      tile = T.OBSIDIAN;    // borda externa — casco carbonizado
        else if(d>0.72) tile = T.REINFORCED;  // camada estrutural
        else if(d>0.55) tile = T.BUILT_BLOCK; // interior danificado
        else            tile = T.CAVE_FLOOR;  // chão interno
        wg[wi(tx,ty)] = tile;
        ig[wi(tx,ty)] = BLOCK_INTEGRITY[tile]||100;
      }
    }
    // "Buracos" de impacto: aberturas no casco (2-3 furos aleatórios, mas fixos via posição)
    const holeOffsets = [[-rx+2, -1], [rx-2, 2], [1, ry-1], [-2, -ry+2]];
    for(const [hox, hoy] of holeOffsets){
      const htx = cx+hox, hty = cy+hoy;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
        if(!inBounds(htx+dx,hty+dy)) continue;
        wg[wi(htx+dx,hty+dy)] = T.VOLCANIC_ASH; // cinzas ao redor do buraco
      }
      if(inBounds(htx,hty)) wg[wi(htx,hty)] = T.LAVA; // núcleo do buraco com lava
    }
    // Interior: alguns blocos de cristal como equipamento danificado
    const eqOffsets = [[-4,-2],[4,-2],[0,3],[-6,0],[6,1]];
    for(const [ox,oy] of eqOffsets){
      const etx=cx+ox, ety=cy+oy;
      if(!inBounds(etx,ety)) continue;
      const d2=Math.hypot(ox/rx,oy/ry);
      if(d2<0.55) { wg[wi(etx,ety)]=T.CRYSTAL; ig[wi(etx,ety)]=BLOCK_INTEGRITY[T.CRYSTAL]||150; }
    }
    // Centro: posição livre garantida para o spawn do jogador
    for(let dy=-2;dy<=2;dy++) for(let dx=-3;dx<=3;dx++){
      if(!inBounds(cx+dx,cy+dy)) continue;
      const d3=Math.hypot(dx/rx,dy/ry);
      if(d3<0.35){ wg[wi(cx+dx,cy+dy)]=T.CAVE_FLOOR; ig[wi(cx+dx,cy+dy)]=0; }
    }
    structures.push({type:'player_spawn_ship', cx, cy, rx, ry});
    return {cx, cy, rx, ry};
  }

  // ─ Espalhar N estruturas de cada tipo ─
  const usedCenters = [];
  function clearSpot(cx, cy, minDist=60){
    for(const [ux,uy] of usedCenters){
      if(Math.hypot(cx-ux,cy-uy)<minDist) return false;
    }
    return true;
  }
  function randPos(margin=40){
    return [margin+Math.floor(rand()*(WORLD_W-margin*2)),
            margin+Math.floor(rand()*(WORLD_H-margin*2))];
  }

  // ── NAVE DE SPAWN DO JOGADOR — REMOVIDA (pedido do usuário)
  // O jogador ainda nasce no centro via findClearSpawn em startGame().
  // const spawnShipCX = Math.floor(WORLD_W/2);
  // const spawnShipCY = Math.floor(WORLD_H/2);
  // const spawnShipData = placePlayerSpawnShip(spawnShipCX, spawnShipCY);
  // usedCenters.push([spawnShipCX, spawnShipCY]);
  // playerSpawnShip = spawnShipData;
  playerSpawnShip = null;

  // 8–12 Bunkers
  const numBunkers = 8 + Math.floor(rand()*5);
  for(let i=0;i<numBunkers;i++){
    for(let attempt=0;attempt<30;attempt++){
      const w=12+Math.floor(rand()*10), h=10+Math.floor(rand()*8);
      const [cx,cy] = randPos(30);
      if(!clearSpot(cx,cy,30)) continue;
      if(!inBounds(cx,cy)||!inBounds(cx+w,cy+h)) continue;
      placeBunker(cx,cy,w,h);
      usedCenters.push([cx+w/2, cy+h/2]);
      break;
    }
  }

  // 6–10 Torres
  const numTowers = 6 + Math.floor(rand()*5);
  for(let i=0;i<numTowers;i++){
    for(let attempt=0;attempt<30;attempt++){
      const [cx,cy] = randPos(20);
      if(!clearSpot(cx,cy,20)) continue;
      placeTower(cx,cy);
      usedCenters.push([cx,cy]);
      break;
    }
  }

  // 4–6 Fábricas
  const numFactories = 4 + Math.floor(rand()*3);
  for(let i=0;i<numFactories;i++){
    for(let attempt=0;attempt<30;attempt++){
      const w=16+Math.floor(rand()*12), h=14+Math.floor(rand()*10);
      const [cx,cy] = randPos(40);
      if(!clearSpot(cx,cy,50)) continue;
      if(!inBounds(cx,cy)||!inBounds(cx+w,cy+h)) continue;
      placeFactory(cx,cy,w,h);
      usedCenters.push([cx+w/2, cy+h/2]);
      break;
    }
  }

  // 3–5 Naves caídas
  const numShips = 3 + Math.floor(rand()*3);
  for(let i=0;i<numShips;i++){
    for(let attempt=0;attempt<30;attempt++){
      const rx=10+Math.floor(rand()*8), ry=6+Math.floor(rand()*6);
      const [cx,cy] = randPos(30);
      if(!clearSpot(cx,cy,40)) continue;
      placeCrashedShip(cx,cy,rx,ry);
      usedCenters.push([cx,cy]);
      break;
    }
  }

  return structures;
}

function generateWorld(seedStr){
  // Reinicializar buffers com o tamanho atual do mapa
  initWorldBuffers();

  if(_importedMapData){
    _loadImportedMap(_importedMapData);
    return;
  }

  const rng0 = xmur3(seedStr);
  const rand = mulberry32(rng0());
  // A geração de superfície é definida em world-gen.js (window.generateSurface)
  portalMap[DIM.SURFACE] = window.generateSurface(rand, rng0);
  playerSpawnShip = null;
  placeStructures(worldGrids[DIM.SURFACE], integrities[DIM.SURFACE], rand);
  for(const d of [DIM.SURFACE]){
    chunkDirtyBuffers[d].fill(1);
    flowFields[d].fill(Infinity);
  }
  minimapDirty = true;
  if(typeof resizeMinimapBuffer==='function') resizeMinimapBuffer();
}

// ─── Importar mapa JSON ───────────────────────────────────────
function _loadImportedMap(data){
  try{
    if(data.worldW) WORLD_W=data.worldW;
    if(data.worldH) WORLD_H=data.worldH;
    initWorldBuffers();
    for(const d of [DIM.SURFACE]){
      if(data.grids&&data.grids[d]){
        const arr=new Uint8Array(data.grids[d]);
        worldGrids[d].set(arr.slice(0,worldGrids[d].length));
      }
    }
    for(const d of [DIM.SURFACE]){
      chunkDirtyBuffers[d].fill(1);
      flowFields[d].fill(Infinity);
    }
    minimapDirty=true;
    showAlert('📂 Mapa importado!');
  }catch(err){
    console.error('Erro ao carregar mapa:',err);
    showAlert('❌ Erro ao carregar mapa');
    _importedMapData=null;
    generateWorld(seedStr||'signal');
  }
}

function exportCurrentMap(){
  const data={
    version:1, worldW:WORLD_W, worldH:WORLD_H,
    seed:seedStr, mode:gameMode,
    grids:{
      [DIM.SURFACE]: Array.from(worldGrids[DIM.SURFACE]),
    },
  };
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`signal-lost-map-${seedStr}.json`; a.click();
  URL.revokeObjectURL(url);
  showAlert('⬇ Mapa exportado!');
}

// ─── Salvar/Continuar partida (localStorage) ──────────────────
// Diferente do exportCurrentMap() acima (que só guarda o mapa, pra
// compartilhar/reaproveitar), isto guarda a PARTIDA inteira — mundo,
// robô, progresso — pra poder continuar de onde parou. Só roda no
// navegador de quem está jogando (localStorage), não é upload/download.
//
// Não é salvo (de propósito, pra manter simples): inimigos, partículas
// e projéteis em voo (regeneram sozinhos pela fila de onda ao continuar),
// e o estado das telas do roguelike/ARIA que só fazem sentido durante o
// frame atual (cooldown de proc, overclock ativo etc.).
const SAVE_KEY = 'signalLostSave_v1';

function hasSavedGame(){
  try{ return !!localStorage.getItem(SAVE_KEY); }
  catch(err){ return false; }
}

function clearSavedGame(){
  try{ localStorage.removeItem(SAVE_KEY); }catch(err){ /* ignora */ }
  _refreshContinueButton();
}

function saveGame(){
  if(!worldGrids[DIM.SURFACE]) return; // nada gerado ainda
  try{
    const data = {
      version:1, savedAt:Date.now(),
      seed:seedStr, mode:gameMode, worldW:WORLD_W, worldH:WORLD_H,
      grid: Array.from(worldGrids[DIM.SURFACE]),
      integrity: Array.from(integrities[DIM.SURFACE]),
      robot:{
        x:robot.x, y:robot.y, vx:robot.vx, vy:robot.vy, angle:robot.angle,
        hp:robot.hp, maxHp:robot.maxHp,
        energy:robot.energy, maxEnergy:robot.maxEnergy,
        heat:robot.heat, maxHeat:robot.maxHeat,
        prevBiome:robot.prevBiome, inCave:robot.inCave,
      },
      time, score, wave, waveTimer, waveSpawnLeft, autoWaveTimer,
      currentWeapon, currentTool, currentBuildType,
      ownedWeapons: Array.from(ownedWeapons), ownedAbilities: Array.from(ownedAbilities),
      disabledItems: Array.from(disabledItems),
      evolution:{
        xp:evolution.xp, level:evolution.level, xpToNext:evolution.xpToNext,
        totalXP:evolution.totalXP, points:evolution.points,
        unlocked:Array.from(evolution.unlocked),
        effectCounts:evolution.effectCounts, resets:evolution.resets,
      },
      rogue: (typeof ROGUE!=='undefined') ? {
        mods: ROGUE.mods,
        pickedIds: Array.from(ROGUE.pickedIds),
        pickedCounts: ROGUE.pickedCounts,
        history: ROGUE.history,
      } : null,
      scanned: (typeof ScannedDB!=='undefined') ? Array.from(ScannedDB) : [],
      dayNightElapsed: (typeof DAYNIGHT!=='undefined') ? DAYNIGHT.elapsed : 0,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    _refreshContinueButton();
  }catch(err){
    console.error('Erro ao salvar partida:', err);
  }
}

function loadGame(){
  let data;
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return false;
    data = JSON.parse(raw);
  }catch(err){
    console.error('Save corrompido:', err);
    return false;
  }

  seedStr = data.seed || seedStr;
  gameMode = data.mode || gameMode;
  WORLD_W = data.worldW || WORLD_W;
  WORLD_H = data.worldH || WORLD_H;
  initWorldBuffers();
  worldGrids[DIM.SURFACE].set(new Uint8Array(data.grid).slice(0, worldGrids[DIM.SURFACE].length));
  if(data.integrity){
    integrities[DIM.SURFACE].set(new Uint16Array(data.integrity).slice(0, integrities[DIM.SURFACE].length));
  }

  currentDim = DIM.SURFACE;
  flowField  = flowFields[currentDim];
  dirField   = dirFields[currentDim];
  chunkDirty = chunkDirtyBuffers[currentDim];
  minimapDirty = true; minimapUpdateTimer = 0;
  chunkDirty.fill(1);
  flowFields[DIM.SURFACE].fill(Infinity);

  const r = data.robot || {};
  robot.x = r.x||0; robot.y = r.y||0; robot.vx = r.vx||0; robot.vy = r.vy||0; robot.angle = r.angle||0;
  robot.hp = r.hp!==undefined ? r.hp : 100;
  robot.energy = r.energy!==undefined ? r.energy : 100;
  robot.heat = r.heat!==undefined ? r.heat : 0;
  robot.dead = false;
  robot.prevBiome = r.prevBiome || '';
  robot.inCave = !!r.inCave;

  time = data.time || 0; last = 0;
  score = data.score || 0;
  wave = data.wave || 0; waveTimer = data.waveTimer || 300; waveSpawnLeft = data.waveSpawnLeft || 0;
  autoWaveTimer = data.autoWaveTimer || 0;
  currentWeapon = data.currentWeapon || 'LASER';
  currentTool = (data.currentTool && data.currentTool!=='laser') ? data.currentTool : 'build';
  currentBuildType = (data.currentBuildType!==undefined) ? data.currentBuildType : T.BUILT_BLOCK;
  ownedWeapons = new Set(data.ownedWeapons && data.ownedWeapons.length ? data.ownedWeapons : ['LASER']);
  ownedAbilities = new Set(data.ownedAbilities || []);
  disabledItems = new Set(data.disabledItems || []);
  fireDisabled = false;
  weaponCooldowns = {};

  const e = data.evolution || {};
  evolution.xp = e.xp||0; evolution.level = e.level||1; evolution.xpToNext = e.xpToNext||xpForLevel(2);
  evolution.totalXP = e.totalXP||0; evolution.points = e.points||0;
  evolution.unlocked = new Set(e.unlocked||[]);
  evolution.effectCounts = e.effectCounts||{}; evolution.resets = e.resets||0;

  if(typeof resetRogue==='function') resetRogue();
  if(data.rogue && typeof ROGUE!=='undefined'){
    Object.assign(ROGUE.mods, data.rogue.mods||{});
    ROGUE.pickedIds = new Set(data.rogue.pickedIds||[]);
    ROGUE.pickedCounts = data.rogue.pickedCounts||{};
    ROGUE.history = data.rogue.history||[];
  }
  // maxHp/maxEnergy/maxHeat dependem de evolution+ROGUE.mods — recalcula
  // DEPOIS de restaurar os dois, senão usaria os valores padrão de novo jogo.
  applyPassiveBonuses();
  robot.maxHp = r.maxHp!==undefined ? r.maxHp : robot.maxHp;
  robot.maxEnergy = r.maxEnergy!==undefined ? r.maxEnergy : robot.maxEnergy;
  robot.maxHeat = r.maxHeat!==undefined ? r.maxHeat : robot.maxHeat;

  if(typeof resetScanner==='function') resetScanner();
  if(typeof ScannedDB!=='undefined' && data.scanned) for(const t of data.scanned) ScannedDB.add(t);

  if(typeof resetDayNight==='function') resetDayNight();
  if(typeof DAYNIGHT!=='undefined' && data.dayNightElapsed) DAYNIGHT.elapsed = data.dayNightElapsed;

  cam.x = robot.x; cam.y = robot.y;
  particles.length=0; projectiles.length=0; enemies.length=0; spawnQueue.length=0;
  bossWarningTimer=0; bossWarningWave=0; activeBoss=null; _lastBossArchetypeIdx=-1;
  buildCooldown=0; flowTimer=0; portalCooldown=0; teleportCooldown=0; upgradeOpen=false; weaponCooldowns={};
  pauseReasons.clear();
  teleportTargeting=false; teleportAim=null; inventoryOpen=false;
  if(inventoryScreen) inventoryScreen.classList.remove('show');

  rebuildFlowField(Math.floor(robot.x/TILE), Math.floor(robot.y/TILE));

  menuScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  if(endScreen) endScreen.classList.remove('show');
  _applyGameModeUI();
  running = true;
  if(!loopStarted){ loopStarted=true; requestAnimationFrame(loop); }
  showAlert('💾 Partida continuada!');
  return true;
}

// Mostra/esconde o botão "Continuar" no menu conforme existe (ou não) save.
function _refreshContinueButton(){
  const b = document.getElementById('btnContinue');
  if(!b) return;
  b.style.display = hasSavedGame() ? '' : 'none';
}

// ─── Particle System ─────────────────────────────────────────
const particles = [];
function spawnParticle(x,y,vx,vy,life,col,size=3,glow=false){
  if(IS_POTATO()) return;
  if(particles.length>QUALITY.particleCap) particles.splice(0,1); // remover a mais antiga
  particles.push({x,y,vx,vy,life,max:life,col,size,glow});
}
function spawnBurst(x,y,col,n=8,speed=2){
  n=Math.max(1,Math.round(n*QUALITY.particleScale)); // reduz partículas por explosão conforme a qualidade gráfica
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2;
    const s=speed*(0.5+Math.random());
    spawnParticle(x,y,Math.cos(a)*s,Math.sin(a)*s,18+Math.random()*12,col,2+Math.random()*2);
  }
}
// Raio (px) a partir do qual um orb de XP começa a ser puxado em direção ao
// jogador. Fora dele o orb fica parado no chão — a atração deixou de ser
// instantânea/global, agora exige aproximação real. Chips e nós de evolução
// podem estender esse raio (ver xpRadiusBonus / getUpgradeValue('xpMagnet')).
const XP_MAGNET_BASE=190;

function spawnXPOrb(x,y,amount){
  const count=Math.min(amount,5);
  const perOrb=Math.max(1,Math.floor(amount/count));
  for(let i=0;i<count;i++){
    const a=Math.random()*Math.PI*2;
    // life=99999: orbs não expiram, ficam até serem coletados
    // xpAge controla o ciclo de velocidade de atração: 0.5s→1 → 0.5s→3 → 0.5s→4 → ...
    particles.push({x,y,vx:Math.cos(a)*1.5,vy:Math.sin(a)*1.5,
      life:99999,max:99999,col:'#facc15',size:4,isXP:true,xpVal:perOrb,col2:'#fbbf24',
      xpAge:0});
  }
}

// Retorna a velocidade de atração do XP baseada na idade do orb (em frames a 60fps)
// Ciclo: 0.5s pausa → burst 1 → 0.5s pausa → burst 3 → 0.5s pausa → burst 4 → repete último
function xpPullSpeed(xpAge){
  const fps=30; // 60 ( mudei teste )
  const half=fps*0.5; // 30 frames = 0.5s
  // Sequência de bursts: 1, 3, 4, 4, 4, ...
  const bursts=[1,3,4];
  // Cada ciclo: half frames de pausa + 1 frame de burst label (usamos janela de 5 frames pra burst)
  const cycleLen=half+5; // ~35 frames por ciclo
  const cycle=Math.floor(xpAge/cycleLen);
  const phaseInCycle=xpAge%cycleLen;
  // Nos primeiros 5 frames do ciclo: burst ativo
  if(phaseInCycle<5){
    const bIdx=Math.min(cycle,bursts.length-1);
    return bursts[bIdx]*6; // multiplicador de força
  }
  return 0.5; // leve atração de fundo sempre
}

// ─── Explosion ───────────────────────────────────────────────
function doExplosion(wx, wy, radius, dmg, isEnemy){
  spawnBurst(wx,wy,'#f97316',22,4);
  spawnBurst(wx,wy,'#fbbf24',12,6);
  const r2=radius*radius;
  if(!isEnemy){
    for(const e of enemies){
      if(e.dead) continue;
      if(dist2(e.x,e.y,wx,wy)<r2){
        const falloff=1-Math.hypot(e.x-wx,e.y-wy)/radius;
        const explDmg=dmg*falloff;
        e.hp-=explDmg; e.flashTimer=12;
        if(typeof rogueOnEnemyDamaged==='function') rogueOnEnemyDamaged(explDmg);
        if(e.hp<=0&&!e.dead){
          e.dead=true;
          // XP vem apenas dos orbs
          score+=e.score; enemiesKilled++;
          spawnBurst(e.x,e.y,e.col,12,3);
          spawnXPOrb(e.x,e.y,e.score);
        }
      }
    }
    const tr=Math.ceil(radius/TILE);
    const btx=Math.floor(wx/TILE), bty=Math.floor(wy/TILE);
    for(let dx=-tr;dx<=tr;dx++){
      for(let dy=-tr;dy<=tr;dy++){
        const ntx=btx+dx, nty=bty+dy;
        if(!inBounds(ntx,nty)) continue;
        if(dist2(ntx*TILE+TILE/2,nty*TILE+TILE/2,wx,wy)>r2*1.1) continue;
        const t=getTile(ntx,nty);
        if(DESTROYABLE.has(t)){
          const floorTile = T.GRASS;
          setTile(ntx,nty,floorTile);
          onBlockBroken(ntx, nty, t, {scoreAmt:1, burst:false, isEnemy:false});
        }
      }
    }
  } else {
    if(robot.invTimer<=0 && dist2(robot.x,robot.y,wx,wy)<r2){
      robot.hp=Math.max(0, robot.hp-dmg*0.7);
      robot.invTimer=30;
    }
  }
}

// ─── Utility ─────────────────────────────────────────────────
function lerp(a,b,t){return a+(b-a)*t;}
function lerpAngle(a,b,t){let d=((b-a+Math.PI*3)%(Math.PI*2))-Math.PI;return a+d*t;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function dist2(ax,ay,bx,by){const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy;}

// ─── Enemy Types ─────────────────────────────────────────────
const ENEMY_TYPES = {
  SCOUT:   {hp:30,  speed:1.9, dmg:8,  color:'#ef4444', size:10, score:10, flying:false, xp:15},
  TANK:    {hp:150, speed:0.9, dmg:25, color:'#7f1d1d', size:18, score:30, flying:false, xp:45},
  FLYER:   {hp:25,  speed:3.0, dmg:5,  color:'#f97316', size:8,  score:15, flying:true,  xp:20},
  TURRET:  {hp:80,  speed:0,   dmg:16, color:'#b91c1c', size:14, score:25, flying:false, xp:35},
  SPECTER: {hp:55,  speed:2.2, dmg:10, color:'#a855f7', size:11, score:20, flying:true,  xp:30},
  BOMBER:  {hp:45,  speed:1.3, dmg:35, color:'#f59e0b', size:12, score:35, flying:false, xp:50},
  SWARM:   {hp:12,  speed:2.5, dmg:4,  color:'#22d3ee', size:6,  score:5,  flying:true,  xp:8},
  ELITE:   {hp:300, speed:1.2, dmg:35, color:'#dc2626', size:20, score:100,flying:false, xp:200, elite:true},
  NECRO:   {hp:60,  speed:1.5, dmg:8,  color:'#6d28d9', size:12, score:40, flying:false, xp:60, summoner:true},
};

// ─── Chefes (a cada BOSS_WAVE_INTERVAL ondas) ─────────────────
// Cada arquétipo tem uma cor, um padrão de ataque especial (ver
// bossSpecialAttack em ai-enemy.js) e um perfil de comportamento (role)
// reaproveitado do sistema de grupo em ai-enemy.js.
const BOSS_ARCHETYPES = [
  { type:'BOSS_SENTINEL', name:'SENTINELA PRIMÁRIA', color:'#dc2626', pattern:'charge', role:'tank',   flying:false },
  { type:'BOSS_REAPER',   name:'CEIFADOR DO VAZIO',   color:'#a855f7', pattern:'ring',   role:'leader', flying:true  },
  { type:'BOSS_COLOSSUS', name:'COLOSSO DE FERRO',    color:'#b45309', pattern:'summon', role:'leader', flying:false },
];
let activeBoss = null;          // referência ao chefe vivo atual (para o HUD de vida no topo)
let _lastBossArchetypeIdx = -1; // evita repetir o mesmo arquétipo duas vezes seguidas

// ─── Weapon Types ────────────────────────────────────────────
// Combate automático: cada arma POSSUÍDA (ver `ownedWeapons`) atira sozinha
// no inimigo mais próximo, com seu próprio cooldown (ver updateAutoWeapons()).
// UNIDADE-7 começa só com o LASER (arma padrão, grátis); as demais — e a
// habilidade de Teleporte — só ficam disponíveis compradas na LOJA (tecla L),
// pagas com `score`. Ver SHOP_ITEMS mais abaixo.
const WEAPONS = {
  LASER:   {name:'Laser',        key:'1', icon:'⚡', energyCost:2,  heatGain:1.5, cooldown:8,  cost:0},
  SHOTGUN: {name:'Escopeta',     key:'2', icon:'💥', energyCost:5,  heatGain:3.5, cooldown:30, cost:300},
  PLASMA:  {name:'Plasma',       key:'3', icon:'🔵', energyCost:2,  heatGain:2.2, cooldown:96, cost:450}, // cooldown = ciclo da rajada: 96 frames = 1.6s a 60fps
  ROCKET:  {name:'Foguete',      key:'4', icon:'🚀', energyCost:20, heatGain:5,   cooldown:80, cost:700},
  GRENADE: {name:'Granada',      key:'5', icon:'💣', energyCost:12, heatGain:2,   cooldown:60, cost:1000},
  RAILGUN: {name:'Railgun',      key:'6', icon:'⚙', energyCost:40, heatGain:30,  cooldown:120,cost:1600},
  CHAIN:   {name:'Corrente',     key:'7', icon:'⛓', energyCost:6,  heatGain:2,   cooldown:15, cost:2200},
};

// Armas que UNIDADE-7 já possui nesta partida (começa só com o padrão).
// Um Set em vez de array pra checagem O(1) em updateAutoWeapons() a cada frame.
let ownedWeapons = new Set(['LASER']);
// Habilidades compráveis fora do combate (hoje só o Teleporte).
let ownedAbilities = new Set();
// Cooldown individual por arma (chave = nome da arma em WEAPONS), em frames.
let weaponCooldowns = {};

// Detecção de mobile é feita em mobile-controls.js (window.IS_MOBILE_DEVICE),
// carregado logo depois deste arquivo — checagem via typeof porque esse
// arquivo é opcional (o jogo roda normalmente sem ele, sem D-pad).
// Usado só pra afastar o HUD de armas/teleporte do D-pad na tela.
function isMobileUI(){ return typeof IS_MOBILE_DEVICE!=='undefined' && IS_MOBILE_DEVICE; }
const MOBILE_HUD_LIFT = 160; // px — o quanto subir o HUD inferior-esquerdo pra não ficar embaixo do D-pad

// Tiro manual (opção em Configurações, OFF por padrão): quando ligado, as
// armas só disparam com o botão esquerdo segurado e mirando no cursor — em
// vez de sozinhas contra o inimigo mais próximo. Ver updateAutoWeapons().
let manualFireMode = false;

// Tiro ON/OFF (tecla Q no PC · botão 🔫 à direita no mobile): quando desligado,
// NENHUMA arma dispara, nem no modo automático nem no manual.
let fireDisabled = false;

// Inventário (tecla I · botão 🎒 ao lado da Loja): armas e habilidades
// possuídas que o jogador desligou de propósito. Guarda os ids
// (chaves de WEAPONS ou id da habilidade, ex: 'TELEPORT').
let disabledItems = new Set();

// ─── Loja ──────────────────────────────────────────────────────
// Itens compráveis com `score`. `type:'weapon'` referencia uma entrada de
// WEAPONS (soma-se a ownedWeapons); `type:'ability'` referencia uma entrada
// solta (soma-se a ownedAbilities). Preço sobe naturalmente pela ordem —
// não precisa ser exatamente igual ao tier de dano da arma.
const SHOP_ITEMS = [
  { id:'SHOTGUN',  type:'weapon',  icon:'💥', name:'Escopeta',  desc:'Rajada de 7 projéteis em cone.',      cost:300  },
  { id:'PLASMA',   type:'weapon',  icon:'🔵', name:'Plasma',    desc:'Disparo rápido, dano constante.',     cost:450  },
  { id:'TELEPORT', type:'ability', icon:'🌀', name:'Teleporte', desc:'Tecla F/T — pisca até o cursor.',     cost:500  },
  { id:'ROCKET',   type:'weapon',  icon:'🚀', name:'Foguete',   desc:'Explosão em área, dano alto.',        cost:700  },
  { id:'GRENADE',  type:'weapon',  icon:'💣', name:'Granada',   desc:'Arco explosivo de curto alcance.',    cost:1000 },
  { id:'RAILGUN',  type:'weapon',  icon:'⚙',  name:'Railgun',   desc:'Perfura vários inimigos em linha.',   cost:1600 },
  { id:'CHAIN',    type:'weapon',  icon:'⛓',  name:'Corrente',  desc:'Rebate entre até 3 inimigos próximos.',cost:2200 },
];
function isOwned(item){ return item.type==='ability' ? ownedAbilities.has(item.id) : ownedWeapons.has(item.id); }
function buyShopItem(id){
  const item = SHOP_ITEMS.find(i=>i.id===id);
  if(!item || isOwned(item)) return false;
  if(score < item.cost) return false;
  score -= item.cost;
  if(item.type==='ability') ownedAbilities.add(item.id);
  else { ownedWeapons.add(item.id); currentWeapon = item.id; }
  spawnBurst(robot.x, robot.y, '#4ade80', 16, 4);
  return true;
}

// ─── Sistema de Evolução — Árvore Genealógica ────────────────
// Estrutura: cada nó tem parent (null = raiz). Para comprar,
// o pai precisa estar no nível máximo (ou ser null).
// TUDO custa 1 ponto. max=1 por default (compra única).
//
//  CORE                COMBATE              SUPORTE            ESPECIAL
//  Vida ────┐          Dano ────┐           Regen ──┐          Scanner+ ─┐
//           Vida+ ──┐          DanoMax ──┐          RegenMax              Scanner++
//                   Vida++     Crit ───┐  Energia+ ─┐
//                              CritMax  EnergyMax
//                   Armadura
//                   Resistência Calor

const SKILL_TREE = {
  // ══ CORE ══════════════════════════════════════════════════
  maxHp:      { label:'❤ Vida+25',      icon:'❤', parent:null,       category:'core',    effect:'maxHp' },
  maxHp2:     { label:'❤ Vida+25',      icon:'❤', parent:'maxHp',    category:'core',    effect:'maxHp' },
  maxHp3:     { label:'❤ Vida+25',      icon:'❤', parent:'maxHp2',   category:'core',    effect:'maxHp' },
  maxEnergy:  { label:'⚡ Energia+20',  icon:'⚡', parent:null,       category:'core',    effect:'maxEnergy' },
  maxEnergy2: { label:'⚡ Energia+20',  icon:'⚡', parent:'maxEnergy',category:'core',    effect:'maxEnergy' },
  maxEnergy3: { label:'⚡ Energia+20',  icon:'⚡', parent:'maxEnergy2',category:'core',   effect:'maxEnergy' },
  speed:      { label:'💨 Velocidade',  icon:'💨', parent:null,       category:'core',    effect:'speed' },
  speed2:     { label:'💨 Velocidade',  icon:'💨', parent:'speed',    category:'core',    effect:'speed' },
  heatRes:    { label:'🔥 Resist. Calor',icon:'🔥',parent:null,       category:'core',    effect:'heatRes' },
  heatRes2:   { label:'🔥 Resist. Calor',icon:'🔥',parent:'heatRes',  category:'core',    effect:'heatRes' },
  // ══ COMBATE ═══════════════════════════════════════════════
  laserDmg:   { label:'⚡ Dano+20%',   icon:'⚡', parent:null,       category:'combat',  effect:'laserDmg' },
  laserDmg2:  { label:'⚡ Dano+20%',   icon:'⚡', parent:'laserDmg', category:'combat',  effect:'laserDmg' },
  laserDmg3:  { label:'⚡ Dano+20%',   icon:'⚡', parent:'laserDmg2',category:'combat',  effect:'laserDmg' },
  armor:      { label:'🛡 Armadura-10%',icon:'🛡', parent:null,       category:'combat',  effect:'armor' },
  armor2:     { label:'🛡 Armadura-10%',icon:'🛡', parent:'armor',    category:'combat',  effect:'armor' },
  armor3:     { label:'🛡 Armadura-10%',icon:'🛡', parent:'armor2',   category:'combat',  effect:'armor' },
  critChance: { label:'🎯 Crítico+5%', icon:'🎯', parent:'laserDmg', category:'combat',  effect:'critChance' },
  critChance2:{ label:'🎯 Crítico+5%', icon:'🎯', parent:'critChance',category:'combat', effect:'critChance' },
  critMult:   { label:'💥 DanoCrit+25%',icon:'💥',parent:'critChance',category:'combat', effect:'critMult' },
  critMult2:  { label:'💥 DanoCrit+25%',icon:'💥',parent:'critMult',  category:'combat', effect:'critMult' },
  blastRadius:{ label:'💣 Explosão+20%',icon:'💣',parent:'laserDmg2',category:'combat',  effect:'blastRadius' },
  // ══ SUPORTE ═══════════════════════════════════════════════
  regen:      { label:'💉 Regen+0.05/s',icon:'💉',parent:null,       category:'support', effect:'regen' },
  regen2:     { label:'💉 Regen+0.05/s',icon:'💉',parent:'regen',    category:'support', effect:'regen' },
  regen3:     { label:'💉 Regen+0.05/s',icon:'💉',parent:'regen2',   category:'support', effect:'regen' },
  energyRegen:{ label:'🔋 EnerRegen+50%',icon:'🔋',parent:'maxEnergy',category:'support',effect:'energyRegen' },
  energyRegen2:{label:'🔋 EnerRegen+50%',icon:'🔋',parent:'energyRegen',category:'support',effect:'energyRegen' },
  buildRange: { label:'🔧 Alcance+40px',icon:'🔧',parent:null,       category:'support', effect:'buildRange' },
  buildRange2:{ label:'🔧 Alcance+40px',icon:'🔧',parent:'buildRange',category:'support',effect:'buildRange' },
  // ══ ESPECIAL ══════════════════════════════════════════════
  scannerRange:{ label:'🔍 Scanner+2',  icon:'🔍',parent:null,       category:'special', effect:'scannerRange' },
  scannerRange2:{label:'🔍 Scanner+2',  icon:'🔍',parent:'scannerRange',category:'special',effect:'scannerRange' },
  lootBonus:  { label:'🧲 Ímã de XP+40px',icon:'🧲', parent:null,       category:'special', effect:'xpMagnet' },
  lootBonus2: { label:'🧲 Ímã de XP+40px',icon:'🧲', parent:'lootBonus',category:'special', effect:'xpMagnet' },
  xpBonus:    { label:'📚 XP+10%',     icon:'📚', parent:null,       category:'special', effect:'xpBonus' },
  xpBonus2:   { label:'📚 XP+10%',     icon:'📚', parent:'xpBonus',  category:'special', effect:'xpBonus' },
};

const evolution = {
  xp: 0, level: 1, xpToNext: 100, totalXP: 0, points: 0,
  unlocked: new Set(), // IDs dos nós "disponíveis/comprados" no ciclo ATUAL da árvore
  // Contagem TOTAL de compras por efeito, através de todos os ciclos — nunca é
  // decrementada quando a árvore reabastece (ver _checkUpgradeTreeRefill).
  // É esta contagem, e não `unlocked`, que alimenta countEffect()/os bônus reais.
  effectCounts: {},
  resets: 0, // quantas vezes a árvore já reabasteceu (compra completa de todos os nós)
};

// Verifica se um nó pode ser comprado
function canUnlockNode(id){
  if(evolution.unlocked.has(id)) return false;      // já comprado
  if(evolution.points < 1) return false;            // sem pontos
  const node = SKILL_TREE[id]; if(!node) return false;
  if(node.parent === null) return true;             // raiz: sempre disponível
  return evolution.unlocked.has(node.parent);       // pai desbloqueado
}

// Compra o nó
function buyNode(id){
  if(!canUnlockNode(id)) return false;
  evolution.unlocked.add(id);
  const eff = SKILL_TREE[id].effect;
  evolution.effectCounts[eff] = (evolution.effectCounts[eff]||0) + 1;
  evolution.points--;
  applyPassiveBonuses();
  spawnBurst(robot.x, robot.y, '#facc15', 8, 3);
  _checkUpgradeTreeRefill();
  return true;
}

// Quando o último nó da árvore é comprado, a loja "reabastece": o Set de nós
// obtidos é limpo para que todos voltem a ficar disponíveis (raízes liberadas,
// resto exige recomprar o caminho de novo, como no início). O que NUNCA é
// tocado aqui é evolution.effectCounts — é ele quem alimenta countEffect(), e
// por isso os bônus/status já conquistados pelo jogador permanecem intactos;
// comprar de novo apenas soma bônus adicionais em cima dos que já existem.
function _checkUpgradeTreeRefill(){
  const allIds = Object.keys(SKILL_TREE);
  if(allIds.every(id => evolution.unlocked.has(id))){
    evolution.unlocked.clear();
    evolution.resets = (evolution.resets||0) + 1;
    showAlert('🧬 Árvore de evolução reabastecida! Upgrades disponíveis de novo — bônus mantidos.');
    spawnBurst(robot.x, robot.y, '#00e5ff', 20, 5);
  }
}

// Quantos nós com effect=key já foram comprados NO TOTAL (todos os ciclos).
// Usa o ledger persistente evolution.effectCounts, não evolution.unlocked,
// para que um reabastecimento da árvore (ver _checkUpgradeTreeRefill) nunca
// derrube os bônus que o jogador já tem.
function countEffect(eff){
  return evolution.effectCounts[eff] || 0;
}

const XP_CURVE = [0,100,200,350,550,800,1100,1500,2000,2600,3300,4200,5500,7000,9000];
function xpForLevel(lvl){ return XP_CURVE[Math.min(lvl-1, XP_CURVE.length-1)] || lvl*800; }

function gainXP(amount){
  // Bônus de upgrade XP
  const xpBonus = getUpgradeValue('xpBonus');
  amount = Math.floor(amount * xpBonus);

  // Bônus de chip roguelike (ver 'xp_gain_up' em roguelike.js)
  const rm=(typeof ROGUE!=='undefined' && ROGUE.mods) ? ROGUE.mods : null;
  if(rm) amount = Math.floor(amount * (rm.xpGainMult||1));

  evolution.xp += amount;
  evolution.totalXP += amount;
  // Verificar level up em loop (pode ganhar vários níveis de uma vez)
  while(evolution.xp >= evolution.xpToNext){
    evolution.xp -= evolution.xpToNext;
    evolution.level++;
    evolution.xpToNext = xpForLevel(evolution.level+1);
    evolution.points++;
    applyPassiveBonuses();
    showAlert(`NÍVEL ${evolution.level}! +1 Ponto de Upgrade`);
    spawnBurst(robot.x, robot.y, '#facc15', 25, 5);
    showUpgradePanel();
  }
  minimapDirty=true;
}

function applyPassiveBonuses(){
  const rm = (typeof ROGUE!=='undefined' && ROGUE.mods) ? ROGUE.mods : null;
  robot.maxHp     = 100 + countEffect('maxHp')     * 25 + (rm ? rm.maxHpBonus     : 0);
  robot.maxEnergy = 100 + countEffect('maxEnergy') * 20 + (rm ? rm.maxEnergyBonus : 0);
  robot.maxHeat   = 100 + countEffect('heatRes')   * 20 + (rm ? rm.maxHeatBonus   : 0);
  if(typeof SCANNER !== 'undefined'){
    SCANNER.scanRange = 3 + countEffect('scannerRange') * 2;
  }
}

function getUpgradeValue(key){
  const n = countEffect(key);
  // Modificadores concedidos pelos chips do sistema roguelike (ver roguelike.js).
  // Ficam sempre em 1 (neutro) / 0 (neutro) quando nenhum chip relevante foi escolhido.
  const rm = (typeof ROGUE!=='undefined' && ROGUE.mods) ? ROGUE.mods : null;
  switch(key){
    case 'laserDmg':    return (1 + n * 0.20) * (rm ? rm.dmgMult : 1);
    case 'energyRegen': return 0.18 * (1 + n * 0.50) * (rm ? rm.energyRegenMult : 1);
    case 'armor':       return (1 - n * 0.10) * (rm ? rm.armorMult : 1);
    case 'buildRange':  return BUILD_RANGE + n * 40;
    case 'blastRadius': return (1 + n * 0.20) * (rm ? rm.blastMult : 1);
    case 'regen':       return n * 0.05 + (rm ? rm.regenBonus : 0);
    case 'speed':       return (1 + n * 0.10) * (rm ? rm.speedMult : 1);
    case 'critChance':  return n * 0.05 + (rm ? rm.critChanceBonus : 0);
    case 'critMult':    return 1 + n * 0.25 + (rm ? rm.critMultBonusAdd : 0);
    case 'xpMagnet':    return n * 40; // px extras no raio de atração magnética dos orbs de XP
    case 'xpBonus':     return 1 + n * 0.10;
    default: return 1;
  }
}

// ─── Find Clear Spawn ────────────────────────────────────────
function isClearTile(t){
  return !SOLID.has(t) && t!==T.AIR && t!==T.DEEP_WATER && t!==T.LAVA;
}
// Verifica se uma posição de pixel está completamente fora de blocos sólidos
function isPixelClear(px, py, radius){
  const r = radius || 14;
  const offsets = [[-r,-r],[0,-r],[r,-r],[-r,0],[r,0],[-r,r],[0,r],[r,r]];
  for(const [ox,oy] of offsets){
    const tx = Math.floor((px+ox)/TILE);
    const ty = Math.floor((py+oy)/TILE);
    if(inBounds(tx,ty) && SOLID.has(getTile(tx,ty))) return false;
  }
  return true;
}
function findClearSpawn(startTX, startTY, doCarve){
  // Busca em espiral crescente por tile livre
  for(let r=0;r<=40;r++){
    for(let dx=-r;dx<=r;dx++){
      for(let dy=-r;dy<=r;dy++){
        if(Math.abs(dx)!==r && Math.abs(dy)!==r) continue;
        const tx=clamp(startTX+dx,2,WORLD_W-3);
        const ty=clamp(startTY+dy,2,WORLD_H-3);
        if(isClearTile(getTile(tx,ty))){
          // Verificar também os tiles vizinhos para garantir espaço ao redor
          let spaceOk = true;
          for(let ndx=-1;ndx<=1&&spaceOk;ndx++){
            for(let ndy=-1;ndy<=1&&spaceOk;ndy++){
              const nt = getTile(tx+ndx,ty+ndy);
              if(SOLID.has(nt)) spaceOk = false;
            }
          }
          if(spaceOk) return{tx,ty};
          if(r>5) return{tx,ty}; // aceitar parcial se estiver longe do centro
        }
      }
    }
  }
  // Emergência: escavar espaço 3×3 ao redor do ponto de spawn
  const etx=clamp(startTX,2,WORLD_W-3), ety=clamp(startTY,2,WORLD_H-3);
  const floorTile = T.GRASS;
  for(let dx=-1;dx<=1;dx++)
    for(let dy=-1;dy<=1;dy++)
      if(inBounds(etx+dx,ety+dy) && SOLID.has(getTile(etx+dx,ety+dy)))
        setTile(etx+dx,ety+dy,floorTile);
  return{tx:etx,ty:ety};
}

// ─── Enemy System ────────────────────────────────────────────
const enemies = [];
function spawnEnemy(type,tx,ty,scaleMult=1){
  const {tx:ctx,ty:cty}=findClearSpawn(tx,ty);
  const def=ENEMY_TYPES[type];
  if(!def) return;
  const e = {
    id: _nextEnemyId++,  // BUG FIX: ID estável para pierce tracking
    type, x:ctx*TILE+TILE/2, y:cty*TILE+TILE/2,
    vx:0, vy:0,
    hp:def.hp*scaleMult, maxHp:def.hp*scaleMult,
    speed:def.speed, dmg:def.dmg*scaleMult,
    col:def.color, size:def.size, score:Math.ceil(def.score*scaleMult),
    xp: Math.ceil((def.xp||def.score)*scaleMult),
    flying:def.flying, elite:def.elite||false,
    summoner:def.summoner||false, summonTimer:0,
    shootCooldown:Math.random()*60|0,
    angle:0, flashTimer:0, dead:false,
    slowTimer:0, stuckTimer:0,
    lastTX:-1, lastTY:-1,
  };
  // BUG FIX: atribuir role de grupo (estava nunca sendo chamado)
  if(typeof assignEnemyRole === 'function') assignEnemyRole(e);
  enemies.push(e);
}

// ─── Boss System ─────────────────────────────────────────────
// Chamado por startWave() a cada BOSS_WAVE_INTERVAL ondas. Constrói o chefe
// diretamente (não usa ENEMY_TYPES/spawnEnemy — precisa de ajuste fino próprio)
// e o insere no array `enemies`, reaproveitando toda a pipeline existente de
// movimento, tiro, colisão e desenho.
function spawnBoss(waveNum){
  const tier = Math.max(1, Math.floor(waveNum / BOSS_WAVE_INTERVAL)); // 1,2,3...

  let idx;
  do{ idx = Math.floor(Math.random()*BOSS_ARCHETYPES.length); }
  while(idx===_lastBossArchetypeIdx && BOSS_ARCHETYPES.length>1);
  _lastBossArchetypeIdx = idx;
  const arch = BOSS_ARCHETYPES[idx];

  // Chefes escalam mais forte que mobs comuns (ver "profundidade" em startWave)
  const scaleMult = 1 + (tier-1)*0.55;
  // XP do chefe cresce também com o nível atual do jogador (além do tier da
  // onda), para o drop continuar valendo a pena mesmo em níveis altos.
  const bossLevelMult = 1 + evolution.level*0.18;

  const robTX=Math.floor(robot.x/TILE), robTY=Math.floor(robot.y/TILE);
  const ang=Math.random()*Math.PI*2, dist=22;
  const tx=clamp(Math.round(robTX+Math.cos(ang)*dist),2,WORLD_W-3);
  const ty=clamp(Math.round(robTY+Math.sin(ang)*dist),2,WORLD_H-3);
  const {tx:ctx2,ty:cty2}=findClearSpawn(tx,ty);

  const baseHp = 650 + tier*380;
  const e = {
    id:_nextEnemyId++, type:arch.type, x:ctx2*TILE+TILE/2, y:cty2*TILE+TILE/2,
    vx:0, vy:0,
    hp:baseHp*scaleMult, maxHp:baseHp*scaleMult,
    speed: arch.pattern==='ring' ? 1.7 : 1.05,
    dmg:(26+tier*4)*scaleMult,
    col:arch.color, size:34+Math.min(tier,6)*2,
    score:Math.ceil(350*scaleMult), xp:Math.ceil(420*scaleMult*bossLevelMult),
    flying:!!arch.flying, elite:true, boss:true,
    bossName:arch.name, bossPattern:arch.pattern, role:arch.role,
    shootCooldown:70, angle:0, flashTimer:0, dead:false,
    slowTimer:0, stuckTimer:0, lastTX:-1, lastTY:-1,
    _bossSpecialTimer:0, bossSpecialCD: Math.max(150, 300-tier*12),
  };
  enemies.push(e);
  activeBoss = e;

  showAlert(`☠ ${arch.name} APARECEU!`);
  if(typeof ariaSpeak==='function') ariaSpeak('bossWarning', true);
  spawnBurst(e.x,e.y,'#ef4444',30,5);
  spawnBurst(e.x,e.y,arch.color,20,4);
  return e;
}

// Chamado por ai-enemy.js no exato frame em que um chefe é removido do array
// `enemies` (já com e.dead=true). Dá a recompensa/celebração EXTRA — a recompensa
// base (score/xp do inimigo) já foi concedida por quem o matou (projétil, bioma,
// armadilha etc.), então aqui só somamos o bônus e disparamos a comemoração.
function onBossDefeated(e){
  score += 500;
  showAlert(`☠ ${e.bossName||'CHEFE'} DERROTADO! +500 pontos`);
  spawnBurst(e.x,e.y,'#facc15',40,6);
  spawnBurst(e.x,e.y,e.col,30,5);
  spawnBurst(e.x,e.y,'#fff',16,4);
  if(activeBoss===e) activeBoss=null;
}

// ─── Game State ──────────────────────────────────────────────
const robot = {
  x:0, y:0, vx:0, vy:0,
  angle:0,
  hp:100, maxHp:100,
  energy:100, maxEnergy:100,
  heat:0, maxHeat:100,
  dead:false, radius:14,
  prevBiome:'', invTimer:0,
  inCave:false,
};

const cam  = {x:0,y:0};
const keys = {};

let time=0, last=0, running=false;

// ─── Sistema de Pause ──────────────────────────────────────────
// Motivos empilháveis (Set): 'manual' (botão/tecla P),
// 'upgrade', 'roguelike' (tela de escolha de chip pós-onda).
// O jogo só executa update() quando pauseReasons está vazio; draw()
// continua rodando para manter a cena visível (congelada) atrás dos
// painéis. Usar um Set em vez de um boolean evita que fechar um painel
// "destrave" o pause aberto por outro motivo (ex: pausar manualmente
// e depois abrir/fechar a árvore de evolução não deve despausar o jogo).
const pauseReasons = new Set();
function addPause(reason){ pauseReasons.add(reason); }
function removePause(reason){ pauseReasons.delete(reason); }
function isPaused(){ return pauseReasons.size>0; }
function togglePause(){
  if(!running) return;
  if(pauseReasons.has('manual')) removePause('manual');
  else addPause('manual');
}

let wave=0, waveTimer=0, waveSpawnLeft=0;

// ── Aviso de Chefe (a cada 5 ondas) ────────────────────────────
// O banner/fala da ARIA dispara aqui; a entidade do chefe em si é criada por
// spawnBoss() (ver "Boss System" acima), enfileirada em startWave() para
// aparecer logo após o banner terminar (ver BOSS_WARNING_DURATION abaixo).
const BOSS_WAVE_INTERVAL = 5;
const BOSS_WARNING_DURATION = 260; // ~4.3s a 60fps
let bossWarningTimer = 0;   // >0 enquanto o banner de aviso está visível
let bossWarningWave  = 0;   // número da onda que disparou o aviso atual
let score=0;
let enemiesKilled=0; // contador de inimigos abatidos nesta partida (tela de Game Over)
let mouseWorld={x:0,y:0};
let mouseDown=false;
let currentTool='build';
let currentWeapon='LASER';
let currentBuildType=T.BUILT_BLOCK;
let seedStr='nebulosa';
let buildCooldown=0;
let portalCooldown=0; // evita teletransporte infinito
let teleportCooldown=0; // cooldown do teleporte manual
let upgradeOpen=false;
let loopStarted=false; // garante que requestAnimationFrame é chamado uma só vez
let _nextEnemyId=0;   // BUG FIX: ID único por inimigo para pierce tracking estável
const spawnQueue = []; // fila de spawn por frames (substitui setTimeout)

// ─── Canvas & Resize ─────────────────────────────────────────
const canvas=document.getElementById('gameCanvas');
const ctx=canvas.getContext('2d',{alpha:false});
const minimapCanvas=document.getElementById('minimapCanvas');
const mctx=minimapCanvas?minimapCanvas.getContext('2d'):null;
let W=0,H=0,DPR=Math.min(window.devicePixelRatio||1,2);

// ─── Sprites (aparência de UNIDADE-7, nave de resgate e antenas) ──
const SPRITES = {
  player:  Object.assign(new Image(), {src:'assets/player.png'}),
  ship:    Object.assign(new Image(), {src:'assets/ship.png'}),
  antenna: Object.assign(new Image(), {src:'assets/antenna.png'}),
};
function spriteReady(img){ return img && img.complete && img.naturalWidth>0; }

function resize(){
  W=canvas.clientWidth; H=canvas.clientHeight;
  canvas.width=Math.floor(W*DPR); canvas.height=Math.floor(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  if(minimapCanvas){
    minimapCanvas.width=minimapCanvas.clientWidth||120;
    minimapCanvas.height=minimapCanvas.clientHeight||80;
  }
}
window.addEventListener('resize',resize);resize();

// ─── Input ───────────────────────────────────────────────────
window.addEventListener('keydown',e=>{
  keys[e.key.toLowerCase()]=true;
  if([' ','arrowup','arrowdown'].includes(e.key.toLowerCase())) e.preventDefault();

  // Pause manual — funciona mesmo com outros painéis abertos/fechados
  if(e.key==='p'||e.key==='P'){ togglePause(); return; }

  // Painéis / menus: sempre respondem, mesmo em pause, pois são eles
  // mesmos que controlam o motivo 'upgrade'/'roguelike' do pause.
  if(e.key==='u') showUpgradePanel();
  if(e.key==='l'||e.key==='L') { shopOpen ? closeShopPanel() : showShopPanel(); }
  if(e.key==='i'||e.key==='I') { inventoryOpen ? closeInventoryPanel() : showInventoryPanel(); }
  if(e.key==='Escape'){ closeUpgradePanel(); closeShopPanel(); closeInventoryPanel(); cancelTeleportTargeting(); }

  // Tiro ON/OFF — vale mesmo pausado (é só um interruptor, igual ao botão mobile)
  if(e.key==='q'||e.key==='Q'){ toggleFire(); return; }

  // Ações de gameplay (mundo) — bloqueadas enquanto o jogo estiver
  // pausado por qualquer motivo (manual, upgrade, roguelike, loja).
  if(isPaused()) return;
  if(e.key==='e') setTool('build');
  if(e.key==='r') setTool('destroy');
  if(e.key==='b') cycleBuildType();
  if(e.key==='f'||e.key==='t') tryTeleport();
});
window.addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; });

canvas.addEventListener('mousemove',e=>{
  const r=canvas.getBoundingClientRect();
  mouseWorld.x=(e.clientX-r.left-W/2)+cam.x;
  mouseWorld.y=(e.clientY-r.top -H/2)+cam.y;
});
canvas.addEventListener('mousedown',e=>{ if(e.button===0 && !isPaused()) mouseDown=true; });
canvas.addEventListener('mouseup',  e=>{ if(e.button===0) mouseDown=false; });
canvas.addEventListener('contextmenu',e=>{ e.preventDefault(); if(!isPaused()) cycleBuildType(); });

// ─── Desktop only — mobile removido ──────────────────────────

const BUILD_TYPES = [T.BUILT_BLOCK, T.REINFORCED, T.GLASS_BLOCK, T.COPPER_BLOCK, T.CRYSTAL_WALL, T.TRAP_SLOW, T.TRAP_DAMAGE, T.SPIKE_BLOCK];
const BUILD_NAMES = {
  [T.BUILT_BLOCK]:'Bloco Normal',    [T.REINFORCED]:'Bloco Reforçado',
  [T.GLASS_BLOCK]:'Bloco de Vidro',  [T.COPPER_BLOCK]:'Bloco de Cobre',
  [T.CRYSTAL_WALL]:'Parede Cristal', [T.TRAP_SLOW]:'Armadilha Lenta',
  [T.TRAP_DAMAGE]:'Armadilha Dano',  [T.SPIKE_BLOCK]:'Espinhos',
};
const BUILD_COSTS = {
  [T.BUILT_BLOCK]:5,   [T.REINFORCED]:15,  [T.GLASS_BLOCK]:3,
  [T.COPPER_BLOCK]:8,  [T.CRYSTAL_WALL]:12, [T.TRAP_SLOW]:8,
  [T.TRAP_DAMAGE]:10,  [T.SPIKE_BLOCK]:12,
};
// Custo de inventário para blocos (modos não-criativo)
const BUILD_ITEM_COST = {
  [T.GLASS_BLOCK]:  { id:'glass',       qty:1 },
  [T.COPPER_BLOCK]: { id:'copper_ingot',qty:1 },
  [T.CRYSTAL_WALL]: { id:'crystal_dust',qty:2 },
  [T.TRAP_SLOW]:    { id:'trap_slow_kit',qty:1 },
  [T.TRAP_DAMAGE]:  { id:'trap_dmg_kit', qty:1 },
  [T.SPIKE_BLOCK]:  { id:'spike_kit',   qty:1 },
  [T.REINFORCED]:   { id:'block_reinforced', qty:1 },
};

function cycleBuildType(){
  const start = BUILD_TYPES.indexOf(currentBuildType);
  let idx = (start + 1) % BUILD_TYPES.length;
  // Percorre a lista até encontrar um bloco disponível (max 1 volta completa)
  for(let i = 0; i < BUILD_TYPES.length; i++){
    const candidate = BUILD_TYPES[idx];
    if(typeof isBlockDiscovered === 'function' ? isBlockDiscovered(candidate) : true){
      currentBuildType = candidate;
      showAlert('🧱 ' + BUILD_NAMES[currentBuildType]);
      return;
    }
    idx = (idx + 1) % BUILD_TYPES.length;
  }
  // Fallback: se nenhum disponível (impossível em condições normais), mantém atual
  showAlert('🧱 ' + BUILD_NAMES[currentBuildType]);
}

function setTool(t){
  currentTool=t;
  document.querySelectorAll('.tool-btn-hud').forEach(b=>{
    b.classList.toggle('active',b.dataset.tool===t);
  });
}
document.querySelectorAll('.tool-btn-hud').forEach(b=>{
  b.addEventListener('click',()=>setTool(b.dataset.tool));
});

// Ordem de exibição das armas no HUD/loja (não controla mais troca manual —
// todas as armas POSSUÍDAS atiram sozinhas; ver updateAutoWeapons()).
const WEAPON_ORDER=['LASER','SHOTGUN','PLASMA','ROCKET','GRENADE','RAILGUN','CHAIN'];

// ─── HUD refs ────────────────────────────────────────────────
const hud         = document.getElementById('hud');
const menuScreen  = document.getElementById('menuScreen');
const endScreen   = document.getElementById('endScreen');
const biomeTag    = document.getElementById('biomeTag');
const seedInput   = document.getElementById('seedInput');
const barHealth   = document.getElementById('barHealth');
const barEnergy   = document.getElementById('barEnergy');
const barHeat     = document.getElementById('barHeat');
const valHealth   = document.getElementById('valHealth');
const valEnergy   = document.getElementById('valEnergy');
const valHeat     = document.getElementById('valHeat');
const hudScore    = document.getElementById('hudScore');
const hudWaveNum  = document.getElementById('hudWaveNum');
const hudAlert    = document.getElementById('hudAlert');
const endTitle    = document.getElementById('endTitle');
const endScore    = document.getElementById('endScore');
let biomeTimer=0,alertTimer=0;

function showBiome(name){
  if(biomeTag){biomeTag.textContent=name;biomeTag.classList.add('show');biomeTimer=200;}
}
function showAlert(msg){
  if(hudAlert){hudAlert.textContent=msg;hudAlert.classList.add('show');alertTimer=180;}
}
function updateHUD(){
  const hp=Math.ceil(robot.hp),en=Math.ceil(robot.energy),ht=Math.ceil(robot.heat);
  if(barHealth) barHealth.style.width=(hp/robot.maxHp*100)+'%';
  if(barEnergy) barEnergy.style.width=(en/robot.maxEnergy*100)+'%';
  if(barHeat)   barHeat.style.width  =(ht/robot.maxHeat*100)+'%';
  if(valHealth) valHealth.textContent=hp+'/'+robot.maxHp;
  if(valEnergy) valEnergy.textContent=en;
  if(valHeat)   valHeat.textContent  =ht;
  if(hudScore)  hudScore.textContent =score;
  if(hudWaveNum)hudWaveNum.textContent=wave;
  if(barHeat){
    barHeat.style.background=ht>80?'linear-gradient(90deg,#ef4444,#dc2626)':
      ht>50?'linear-gradient(90deg,#fb923c,#ef4444)':'linear-gradient(90deg,#fbbf24,#fb923c)';
  }
  // Indicador dia/noite
  const dayHUD=document.getElementById('dayNightHUD');
  if(dayHUD){
    if(typeof DAYNIGHT!=='undefined' && DAYNIGHT.enabled){
      const icon = DAYNIGHT.isDay ? '☀' : '🌙';
      const secs = Math.max(0,Math.ceil(DAYNIGHT.timeLeftMs/1000));
      const mm=Math.floor(secs/60), ss=String(secs%60).padStart(2,'0');
      dayHUD.textContent = `${icon} ${DAYNIGHT.phaseLabel} · ${mm}:${ss}`;
      dayHUD.classList.toggle('night', !DAYNIGHT.isDay);
    } else {
      dayHUD.textContent='';
      dayHUD.classList.remove('night');
    }
  }
  if(biomeTimer>0){biomeTimer--;}else{if(biomeTag)biomeTag.classList.remove('show');}
  if(alertTimer>0){alertTimer--;}else{if(hudAlert)hudAlert.classList.remove('show');}
  if(typeof btnPause!=='undefined' && btnPause){
    const p=pauseReasons.has('manual'); // painéis (loja/evolução/inventário) não contam
    btnPause.textContent = p ? '▶ Retomar' : '⏸ Pause';
    btnPause.classList.toggle('btn-pause-active', p);
  }
}

// ─── Upgrade Panel (Canvas UI) ───────────────────────────────
let upgradePanel = null; // dados do painel

function showUpgradePanel(){
  if(!running) return;
  if(shopOpen) closeShopPanel();
  if(inventoryOpen) closeInventoryPanel();
  cancelTeleportTargeting();
  upgradeOpen = true;
  addPause('upgrade');
}
function closeUpgradePanel(){
  upgradeOpen = false;
  upgradePanel = null;
  removePause('upgrade');
}

// ─── Tiro ON/OFF ───────────────────────────────────────────────
function toggleFire(){
  if(!running) return;
  fireDisabled = !fireDisabled;
  showAlert(fireDisabled ? '🔫 TIRO DESATIVADO' : '🔫 TIRO ATIVADO');
}

// ─── Inventário (painel HTML) ─────────────────────────────────
// Liga/desliga armas e habilidades JÁ COMPRADAS sem perdê-las. Fica em DOM
// (e não em canvas como a Loja) pra ter alvos de toque grandes no mobile.
let inventoryOpen = false;
const inventoryScreen = document.getElementById('inventoryScreen');
const inventoryList   = document.getElementById('inventoryList');

function renderInventory(){
  if(!inventoryList) return;
  inventoryList.textContent = '';
  const rows = [];
  for(const w of WEAPON_ORDER) if(ownedWeapons.has(w)) rows.push({id:w, icon:WEAPONS[w].icon, name:WEAPONS[w].name, kind:'Arma'});
  for(const it of SHOP_ITEMS) if(it.type==='ability' && ownedAbilities.has(it.id)) rows.push({id:it.id, icon:it.icon, name:it.name, kind:'Habilidade'});
  rows.forEach(r=>{
    const label=document.createElement('label'); label.className='inv-row';
    const ico=document.createElement('span'); ico.className='inv-icon'; ico.textContent=r.icon;
    const txt=document.createElement('span'); txt.className='inv-name'; txt.textContent=r.name;
    const kind=document.createElement('small'); kind.className='inv-kind'; kind.textContent=r.kind;
    txt.appendChild(kind);
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!disabledItems.has(r.id);
    cb.addEventListener('change', ()=>{
      if(cb.checked) disabledItems.delete(r.id); else disabledItems.add(r.id);
      label.classList.toggle('off', !cb.checked);
    });
    label.classList.toggle('off', !cb.checked);
    label.append(ico, txt, cb);
    inventoryList.appendChild(label);
  });
  if(!rows.length){
    const empty=document.createElement('div'); empty.className='inv-empty'; empty.textContent='Nada equipado ainda — compre itens na Loja.';
    inventoryList.appendChild(empty);
  }
}
function showInventoryPanel(){
  if(!running) return;
  if(typeof ROGUE!=='undefined' && ROGUE.screenOpen) return;
  if(shopOpen) closeShopPanel();
  if(upgradeOpen) closeUpgradePanel();
  cancelTeleportTargeting();
  renderInventory();
  inventoryOpen = true;
  addPause('inventory');
  if(inventoryScreen) inventoryScreen.classList.add('show');
}
function closeInventoryPanel(){
  if(!inventoryOpen) return;
  inventoryOpen = false;
  removePause('inventory');
  if(inventoryScreen) inventoryScreen.classList.remove('show');
}

// Ponte pros controles mobile (mobile-controls.js é opcional, então o jogo
// só expõe funções e nunca depende de o arquivo existir).
window.gameMobileAPI = {
  toggleFire,
  isFireDisabled: ()=>fireDisabled,
  toggleTeleportTargeting: startTeleportTargeting,
  teleportState: ()=>({
    owned: ownedAbilities.has('TELEPORT'),
    disabled: disabledItems.has('TELEPORT'),
    cooling: teleportCooldown>0,
    targeting: teleportTargeting,
  }),
};

// ─── Loja (Canvas UI) ────────────────────────────────────────
// Compra armas (além do LASER, que já vem equipado) e a habilidade de
// Teleporte, gastando `score`. Ver SHOP_ITEMS / buyShopItem() acima.
let shopOpen = false;
let shopPanel = null;

function showShopPanel(){
  if(!running) return;
  if(typeof ROGUE!=='undefined' && ROGUE.screenOpen) return;
  if(upgradeOpen) closeUpgradePanel();
  if(inventoryOpen) closeInventoryPanel();
  cancelTeleportTargeting();
  shopOpen = true;
  addPause('shop');
}
function closeShopPanel(){
  shopOpen = false;
  shopPanel = null;
  removePause('shop');
}

function drawShopPanel(){
  if(!shopOpen) return;
  const rowH=64, headerH=76;
  const panW=Math.min(W-40,620), panH=Math.min(H-40, headerH+SHOP_ITEMS.length*rowH+24);
  const px=(W-panW)/2, py=(H-panH)/2;

  ctx.save();
  ctx.fillStyle='rgba(5,8,18,0.92)';
  ctx.fillRect(0,0,W,H);

  ctx.fillStyle='rgba(15,20,38,0.98)';
  ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2;
  ctx.fillRect(px,py,panW,panH); ctx.strokeRect(px,py,panW,panH);

  ctx.fillStyle='#38bdf8';
  ctx.font="bold 20px 'Orbitron',sans-serif"; ctx.textAlign='center';
  ctx.fillText('🛒 LOJA', px+panW/2, py+32);
  ctx.font="12px 'Share Tech Mono',monospace"; ctx.fillStyle='#94a3b8';
  ctx.fillText(`Pontuação disponível: ${score}   —   [L] ou [ESC] fecha`, px+panW/2, py+54);

  shopPanel = { cells:{} };
  let rowY = py+headerH;
  for(const item of SHOP_ITEMS){
    const owned = isOwned(item);
    const afford = score >= item.cost;
    const rx=px+16, ry=rowY, rw=panW-32, rh=rowH-10;

    ctx.fillStyle = owned ? 'rgba(74,222,128,0.12)' : afford ? 'rgba(56,189,248,0.10)' : 'rgba(100,100,120,0.08)';
    ctx.strokeStyle = owned ? '#4ade80' : afford ? '#38bdf8' : '#475569';
    ctx.lineWidth=1.5;
    ctx.fillRect(rx,ry,rw,rh); ctx.strokeRect(rx,ry,rw,rh);

    ctx.textAlign='left';
    ctx.font="24px sans-serif";
    ctx.fillStyle='#fff';
    ctx.fillText(item.icon, rx+14, ry+rh/2+9);

    ctx.font="bold 14px 'Orbitron',sans-serif";
    ctx.fillStyle = owned ? '#4ade80' : '#e2e8f0';
    ctx.fillText(item.name, rx+56, ry+rh/2-2);

    ctx.font="11px 'Share Tech Mono',monospace";
    ctx.fillStyle='#94a3b8';
    ctx.fillText(item.desc, rx+56, ry+rh/2+16);

    ctx.textAlign='right';
    ctx.font="bold 13px 'Share Tech Mono',monospace";
    if(owned){
      ctx.fillStyle='#4ade80';
      ctx.fillText('✔ COMPRADO', rx+rw-16, ry+rh/2+5);
    } else {
      ctx.fillStyle = afford ? '#facc15' : '#ef4444';
      ctx.fillText(`💰 ${item.cost}`, rx+rw-16, ry+rh/2+5);
    }

    shopPanel.cells[item.id] = { x:rx, y:ry, w:rw, h:rh, item, owned, afford };
    rowY += rowH;
  }
  ctx.restore();
}

function drawUpgradePanel(){
  if(!upgradeOpen) return;

  // Layout: 4 colunas (categorias), nós em coluna com linhas de pai→filho
  const CATS = ['core','combat','support','special'];
  const CAT_LABELS = { core:'NÚCLEO', combat:'COMBATE', support:'SUPORTE', special:'ESPECIAL' };
  const CAT_COLS = { core:0, combat:1, support:2, special:3 };

  const panW = Math.min(W-40, 680), panH = Math.min(H-40, 520);
  const px = (W-panW)/2, py = (H-panH)/2;

  ctx.save();
  ctx.fillStyle='rgba(4,10,22,0.97)';
  roundRect(ctx,px,py,panW,panH,14); ctx.fill();
  ctx.strokeStyle='rgba(0,230,255,0.45)'; ctx.lineWidth=1.5;
  roundRect(ctx,px,py,panW,panH,14); ctx.stroke();

  // Título
  ctx.fillStyle='#00e5ff'; ctx.font=`bold 13px 'Orbitron',sans-serif`; ctx.textAlign='center';
  const cycleTag = evolution.resets>0 ? ` · Ciclo ${evolution.resets+1}` : '';
  ctx.fillText(`🧬 ÁRVORE DE EVOLUÇÃO — Nível ${evolution.level}${cycleTag}`, W/2, py+22);
  ctx.fillStyle='rgba(200,232,255,0.45)'; ctx.font=`9px 'Share Tech Mono',monospace`;
  ctx.fillText(`${evolution.points} ponto(s) · XP ${evolution.xp}/${evolution.xpToNext} · [U] fechar`, W/2, py+38);

  // XP bar
  const xpPct = evolution.xp / evolution.xpToNext;
  ctx.fillStyle='rgba(255,255,255,0.07)'; roundRect(ctx,px+20,py+44,panW-40,6,3); ctx.fill();
  ctx.fillStyle='#facc15'; roundRect(ctx,px+20,py+44,(panW-40)*xpPct,6,3); ctx.fill();

  // Cabeçalhos de categoria
  const colW = (panW-20)/4;
  const CAT_COLS_COLORS = { core:'#60a5fa', combat:'#f87171', support:'#4ade80', special:'#c084fc' };
  CATS.forEach((cat,ci)=>{
    const cx2 = px+10+ci*colW+colW/2;
    ctx.fillStyle=CAT_COLS_COLORS[cat]; ctx.font=`bold 9px 'Orbitron',sans-serif`; ctx.textAlign='center';
    ctx.fillText(CAT_LABELS[cat], cx2, py+62);
    ctx.strokeStyle=`${CAT_COLS_COLORS[cat]}44`; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(px+10+ci*colW,py+68); ctx.lineTo(px+10+(ci+1)*colW-10,py+68); ctx.stroke();
  });

  // Calcular posições dos nós por categoria (cada nó empilhado verticalmente)
  const nodeW=colW-16, nodeH=36, startY=py+76, nodeGap=8;
  const nodePos = {}; // id → {x,y,w,h}
  const catRows = {core:0, combat:0, support:0, special:0};

  if(!upgradePanel) upgradePanel={cells:{}};
  upgradePanel.cells = {};

  // Ordenar nós: raízes primeiro, depois filhos (topological sort simples)
  const allIds = Object.keys(SKILL_TREE);
  const ordered = [];
  const placed = new Set();
  // Raízes
  allIds.filter(id=>SKILL_TREE[id].parent===null).forEach(id=>{ordered.push(id);placed.add(id);});
  // Filhos em ordem de profundidade
  let changed=true;
  while(changed){
    changed=false;
    allIds.forEach(id=>{
      if(placed.has(id)) return;
      const p=SKILL_TREE[id].parent;
      if(placed.has(p)){ordered.push(id);placed.add(id);changed=true;}
    });
  }

  // Posicionar cada nó
  ordered.forEach(id=>{
    const node=SKILL_TREE[id];
    const cat=node.category;
    const ci=CAT_COLS[cat]||0;
    const row=catRows[cat]||0;
    const nx=px+10+ci*colW+8;
    const ny=startY+row*(nodeH+nodeGap);
    nodePos[id]={x:nx,y:ny,w:nodeW,h:nodeH};
    catRows[cat]=(catRows[cat]||0)+1;
  });

  // Desenhar linhas pai→filho ANTES dos nós
  ordered.forEach(id=>{
    const node=SKILL_TREE[id];
    if(!node.parent) return;
    const pPos=nodePos[node.parent];
    const cPos=nodePos[id];
    if(!pPos||!cPos) return;
    const px2=pPos.x+nodeW/2, py2=pPos.y+nodeH;
    const cx2=cPos.x+nodeW/2, cy2=cPos.y;
    const unlocked=evolution.unlocked.has(node.parent);
    ctx.strokeStyle=unlocked?'rgba(0,229,255,0.5)':'rgba(255,255,255,0.08)';
    ctx.lineWidth=unlocked?1.5:1;
    ctx.setLineDash(unlocked?[]:[4,4]);
    ctx.beginPath(); ctx.moveTo(px2,py2); ctx.lineTo(cx2,cy2); ctx.stroke();
    ctx.setLineDash([]);
  });

  // Desenhar nós
  ordered.forEach((id,i)=>{
    const node=SKILL_TREE[id];
    const pos=nodePos[id]; if(!pos) return;
    const {x:nx,y:ny,w:nw,h:nh}=pos;
    const owned=evolution.unlocked.has(id);
    const avail=canUnlockNode(id);
    const catColor=CAT_COLS_COLORS[node.category]||'#fff';

    // Fundo
    ctx.fillStyle=owned?`${catColor}22`:avail?'rgba(0,180,210,0.12)':'rgba(20,30,50,0.7)';
    roundRect(ctx,nx,ny,nw,nh,6); ctx.fill();
    ctx.strokeStyle=owned?catColor:avail?'rgba(0,229,255,0.5)':'rgba(255,255,255,0.07)';
    ctx.lineWidth=owned?1.5:1;
    roundRect(ctx,nx,ny,nw,nh,6); ctx.stroke();

    // Ícone
    ctx.font='14px serif'; ctx.textAlign='left';
    ctx.fillText(node.icon||'?', nx+5, ny+23);

    // Label
    ctx.fillStyle=owned?catColor:avail?'#e0f7ff':'rgba(200,220,255,0.3)';
    ctx.font=`bold 8px 'Orbitron',sans-serif`; ctx.textAlign='left';
    ctx.fillText(node.label, nx+24, ny+14);

    // Estado
    if(owned){
      ctx.fillStyle=catColor; ctx.font=`7px 'Share Tech Mono',monospace`;
      ctx.fillText('✔ OBTIDO', nx+24, ny+27);
    } else if(avail){
      ctx.fillStyle='#facc15'; ctx.font=`7px 'Share Tech Mono',monospace`;
      ctx.fillText('→ 1 ponto', nx+24, ny+27);
    } else {
      ctx.fillStyle='rgba(255,255,255,0.2)'; ctx.font=`7px 'Share Tech Mono',monospace`;
      const pLabel=node.parent?SKILL_TREE[node.parent]?.label?.split(' ').slice(0,2).join(' '):'?';
      ctx.fillText(`🔒 requer: ${pLabel}`, nx+24, ny+27);
    }

    // Registrar para clique
    upgradePanel.cells[id]={x:nx,y:ny,w:nw,h:nh,id,avail};
  });

  ctx.fillStyle='rgba(200,232,255,0.25)'; ctx.font=`8px 'Share Tech Mono',monospace`; ctx.textAlign='center';
  ctx.fillText('Clique no nó para comprar · [U]/[ESC] fechar', W/2, py+panH-10);
  ctx.restore();
}

canvas.addEventListener('click', e=>{
  const r=canvas.getBoundingClientRect();
  const mx=e.clientX-r.left, my=e.clientY-r.top;
  // Clique na tela de escolha de chip roguelike (prioridade máxima)
  if(typeof ROGUE!=='undefined' && ROGUE.screenOpen){
    if(typeof rogueHandleClick==='function') rogueHandleClick(mx,my);
    return;
  }
  if(!upgradeOpen||!upgradePanel){
    // Clique na loja
    if(shopOpen && shopPanel && shopPanel.cells){
      for(const [id, cell] of Object.entries(shopPanel.cells)){
        if(mx>=cell.x&&mx<=cell.x+cell.w&&my>=cell.y&&my<=cell.y+cell.h){
          if(cell.owned){
            showAlert('✔ Já possui este item.');
          } else if(!cell.afford){
            showAlert(`💰 Faltam ${cell.item.cost-score} pontos.`);
          } else if(buyShopItem(id)){
            showAlert(`✔ ${cell.item.name} comprado!`);
          }
          return;
        }
      }
      const panW2=Math.min(W-40,620);
      const panH2=Math.min(H-40, 76+SHOP_ITEMS.length*64+24);
      const px2=(W-panW2)/2, py2=(H-panH2)/2;
      if(mx<px2||mx>px2+panW2||my<py2||my>py2+panH2) closeShopPanel();
    }
    return;
  }
  if(upgradePanel.cells){
    for(const [id, cell] of Object.entries(upgradePanel.cells)){
      if(!cell) continue;
      if(mx>=cell.x&&mx<=cell.x+cell.w&&my>=cell.y&&my<=cell.y+cell.h){
        if(cell.avail){
          if(buyNode(id)){
            showAlert(`✔ ${SKILL_TREE[id].label} desbloqueado!`);
          }
        } else if(evolution.unlocked.has(id)){
          showAlert('Nó já obtido.');
        } else {
          const pLabel=SKILL_TREE[id].parent?SKILL_TREE[SKILL_TREE[id].parent]?.label:'início';
          showAlert(`🔒 Requer: ${pLabel}`);
        }
        break;
      }
    }
    // Clique fora fecha
    const panW=Math.min(W-40,680),panH=Math.min(H-40,520),px=(W-panW)/2,py=(H-panH)/2;
    if(mx<px||mx>px+panW||my<py||my>py+panH) closeUpgradePanel();
  }
});

// ─── Blocos Interativos ──────────────────────────────────────
// Tiles que o jogador pode "usar" ao ficar sobre eles (tecla F já é teleporte,
// usamos proximidade automática por tile tipo, verificado a cada frame em
// checkInteractables()).
//
// Tipos implementados:
//  RUNE_STONE  — regenera HP ao ficar parado por 2s
//  MUSHROOM    — concede buff temporário de velocidade ao pisar
//  CRYSTAL_FLOOR — recarga rápida de energia
//  CRYSTAL_WALL  — pequena recarga de energia ao passar
//  TOXIC       — alerta ARIA e aplica dano (já implementado em biome, aqui add efeito visual)
//
// (Baús interativos com itens aleatórios e Consolas de lore serão adicionados
//  como estruturas colocadas na geração do mundo em versão futura.)
//
const INTERACTABLE = {
  [T.RUNE_STONE]:    { type:'rune',     interactDist:1.5 },
  [T.MUSHROOM]:      { type:'mushroom', interactDist:0.8 },
  [T.CRYSTAL_FLOOR]: { type:'crystal',  interactDist:1.5 },
};

// Estado de interação
const _interact = {
  runeCd:    0,   // cooldown de cura da runa
  mushCd:    0,   // cooldown do cogumelo
  crystalCd: 0,   // cooldown do cristal
  mushBuff:  0,   // frames restantes de buff de velocidade
  runeTimer: 0,   // frames parado sobre runa (precisa de 120 = 2s)
  lastX:0, lastY:0,
};

// Retorna true quando o player está sobre (ou adjacente a) o tile
function _nearTile(tileId, dist){
  const ptx=Math.floor(robot.x/TILE), pty=Math.floor(robot.y/TILE);
  const r=Math.ceil(dist);
  for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++){
    if(Math.sqrt(dx*dx+dy*dy)>dist) continue;
    if(getTile(ptx+dx,pty+dy)===tileId) return true;
  }
  return false;
}

function checkInteractables(){
  if(_interact.runeCd>0)    _interact.runeCd--;
  if(_interact.mushCd>0)    _interact.mushCd--;
  if(_interact.crystalCd>0) _interact.crystalCd--;
  if(_interact.mushBuff>0)  _interact.mushBuff--;

  // ── RUNA: restaura HP se ficar parado 2s em cima ──────────
  if(_nearTile(T.RUNE_STONE, 1.5)){
    const moved=Math.hypot(robot.x-_interact.lastX, robot.y-_interact.lastY)>1.5;
    if(moved){ _interact.runeTimer=0; }
    else      { _interact.runeTimer++; }
    _interact.lastX=robot.x; _interact.lastY=robot.y;
    // Partícula de "carregando"
    if(_interact.runeTimer>0 && _interact.runeTimer%12===0){
      spawnParticle(robot.x+(Math.random()-.5)*20, robot.y-8,
        (Math.random()-.5)*.5,-1.2,30,'#a78bfa',2);
    }
    if(_interact.runeTimer>=160 && _interact.runeCd<=0){
      const heal=Math.min(10, robot.maxHp-robot.hp);
      robot.hp=Math.min(robot.maxHp, robot.hp+heal);
      _interact.runeCd=400; // ~6.67s cooldown, marcação para facilitar pesquisa: " 00-00 "
      _interact.runeTimer=0;
      spawnBurst(robot.x, robot.y,'#a78bfa',20,4);
      if(heal>0) showAlert(`✦ Runa restaurou ${heal.toFixed(0)} HP`);
    }
  } else {
    _interact.lastX=robot.x; _interact.lastY=robot.y;
  }

  // ── COGUMELO: buff de velocidade ao pisar ─────────────────
  if(_nearTile(T.MUSHROOM, 0.6) && _interact.mushCd<=0){
    _interact.mushBuff=300; // 5s de velocidade
    _interact.mushCd=600;   // 10s antes de funcionar de novo
    spawnBurst(robot.x, robot.y,'#c084fc',12,3);
    showAlert('🍄 Burst de cogumelo! Velocidade +50% por 5s');
  }

  // ── CRISTAL: recarga rápida de energia ao ficar sobre ─────
  if(_nearTile(T.CRYSTAL_FLOOR, 0.8) && _interact.crystalCd<=0){
    if(robot.energy<robot.maxEnergy){
      robot.energy=Math.min(robot.maxEnergy, robot.energy+0.8);
      if(Math.random()<0.08)
        spawnParticle(robot.x+(Math.random()-.5)*16, robot.y+(Math.random()-.5)*16,
          0,-0.5,20,'#818cf8',2);
    }
  } else if(!_nearTile(T.CRYSTAL_FLOOR, 0.8)){
    _interact.crystalCd=0;
  }
}

// Multiplicador de velocidade vindo do buff de cogumelo
function getMushroomSpeedMult(){ return _interact.mushBuff>0 ? 1.5 : 1.0; }


// ─── Wave System (Balanceado) ─────────────────────────────────
// Ondas mais suaves no início, escala gradual, eventos especiais
const WAVE_DEFS = [
  // 1-3: Tutorial suave
  {enemies:[{t:'SCOUT',n:3}]},
  {enemies:[{t:'SCOUT',n:4},{t:'FLYER',n:2}]},
  {enemies:[{t:'SCOUT',n:5},{t:'TANK',n:1}]},
  // 4-6: Crescimento
  {enemies:[{t:'SCOUT',n:5},{t:'FLYER',n:3},{t:'SWARM',n:6}]},
  {enemies:[{t:'SCOUT',n:4},{t:'TANK',n:2},{t:'BOMBER',n:1}]},
  {enemies:[{t:'SCOUT',n:6},{t:'TURRET',n:2},{t:'SPECTER',n:2}]},
  // 7-9: Desafiador
  {enemies:[{t:'SCOUT',n:7},{t:'TANK',n:2},{t:'FLYER',n:4},{t:'SWARM',n:8}]},
  {enemies:[{t:'TANK',n:3},{t:'BOMBER',n:2},{t:'SPECTER',n:3},{t:'TURRET',n:2}]},
  {enemies:[{t:'SCOUT',n:6},{t:'TANK',n:3},{t:'NECRO',n:1},{t:'SPECTER',n:4}]},
  // 10+: Elite + Void
  {enemies:[{t:'ELITE',n:1},{t:'SCOUT',n:8},{t:'FLYER',n:5}], boss:true},
  {enemies:[{t:'ELITE',n:1},{t:'TANK',n:4},{t:'BOMBER',n:3},{t:'TURRET',n:3}], boss:true},
  {enemies:[{t:'ELITE',n:2},{t:'NECRO',n:2},{t:'SPECTER',n:5},{t:'SWARM',n:15}], boss:true},
];

// ─── Auto-Wave: se o player ficar muito tempo sem limpar a onda,
//     a próxima começa automaticamente. Isso evita que o jogador
//     fique parado esperando o cooldown infinitamente.
//     Em ondas ativas (com inimigos vivos), o timer congela.
const AUTO_WAVE_MAX = 1800; // 30s a 60fps para forçar próxima onda
let autoWaveTimer = 0;      // conta para cima; ao atingir MAX, dispara

function startWave(){
  wave++;
  const defIdx = Math.min(wave-1, WAVE_DEFS.length-1);
  const def = WAVE_DEFS[defIdx];
  const spawnRealBoss = (wave % BOSS_WAVE_INTERVAL === 0);

  // ── "Profundidade": em vez de simplesmente empilhar mais inimigos a cada
  // ciclo, a contagem cresce pouco (e no fim até encolhe um pouco) enquanto
  // o poder individual (scaleMult) cresce mais rápido. Resultado: com o tempo
  // aparecem MENOS inimigos por onda, porém cada um mais forte — a dificuldade
  // sobe pela qualidade dos inimigos, não pela quantidade bruta.
  // Em onda de chefe, a "escolta" de mobs comuns é ainda mais reduzida (40%),
  // já que a ameaça principal passa a ser o próprio chefe.
  const cycle = Math.floor((wave-1)/WAVE_DEFS.length);
  const scaleMult = 1 + cycle * 0.4 + (wave/WAVE_DEFS.length) * 0.08;
  const countMult = spawnRealBoss ? 0.4 : Math.max(0.55, 1 - cycle * 0.12);

  waveSpawnLeft=0;
  for(const e of def.enemies){
    const count = Math.max(1, Math.round(e.n * countMult));
    for(let i=0;i<count;i++){
      const side=Math.floor(Math.random()*4);
      const robTX=Math.floor(robot.x/TILE);
      const robTY=Math.floor(robot.y/TILE);
      let tx,ty;
      const sp=32;
      if(side===0)      {tx=robTX+(Math.random()-.5)*sp|0;ty=robTY-26;}
      else if(side===1) {tx=robTX+26;ty=robTY+(Math.random()-.5)*sp|0;}
      else if(side===2) {tx=robTX+(Math.random()-.5)*sp|0;ty=robTY+26;}
      else              {tx=robTX-26;ty=robTY+(Math.random()-.5)*sp|0;}
      tx=clamp(tx,2,WORLD_W-3);
      ty=clamp(ty,2,WORLD_H-3);
      let type=e.t;
      // Usar fila de spawn baseada em frames (evita setTimeout que ignora estado do jogo)
      spawnQueue.push({type, tx, ty, scaleMult, delay: waveSpawnLeft * 17});
      waveSpawnLeft++;
    }
  }

  const isEliteWave = def.boss;
  if(isEliteWave) showAlert(`⚠ INIMIGOS ÉLITE CHEGANDO!`);
  // Ondas normais: sem aviso no centro da tela

  // ── Onda de chefe a cada BOSS_WAVE_INTERVAL ondas ──────────────
  // O banner/aviso dispara já; o chefe de verdade entra na fila de spawn com
  // um atraso que deixa o banner terminar antes dele aparecer em cena.
  if(spawnRealBoss){
    if(typeof triggerBossWarning === 'function') triggerBossWarning(wave);
    spawnQueue.push({ boss:true, delay: BOSS_WARNING_DURATION + 30 });
  }

  // Tempo entre ondas: mais longo no início (resting phase)
  waveTimer = wave<=3 ? 1200 : 900+wave*150;
  autoWaveTimer = 0; // reset ao iniciar onda nova

  if(typeof rogueOnWaveStart==='function') rogueOnWaveStart();
}

// ─── Aviso de Chefe (a cada 5 ondas) ──────────────────────────
// Dispara a apresentação de "chefe chegando": banner dramático na tela,
// alerta no HUD, fala da ARIA e uma rajada de partículas no jogador.
// O chefe de verdade (entidade, IA, ataques) é criado por spawnBoss(), já
// enfileirado em startWave() para surgir logo após este banner.
function triggerBossWarning(waveNum){
  bossWarningTimer = BOSS_WARNING_DURATION;
  bossWarningWave = waveNum;
  showAlert(`☠ CHEFE SE APROXIMA — ONDA ${waveNum}`);
  if(typeof ariaSpeak==='function') ariaSpeak('bossWarning', true);
  // Rajada de partículas vermelhas ao redor do robô para reforçar a tensão
  if(typeof spawnBurst==='function'){
    spawnBurst(robot.x, robot.y, '#ef4444', 18, 4);
    spawnBurst(robot.x, robot.y, '#7f1d1d', 10, 2);
  }
}

// Desenha o banner de aviso de chefe: título pulsante + contagem regressiva
// sutil, com fade-in/out. Chamado a partir de draw(), por cima do HUD normal
// mas abaixo da tela de escolha de chips (que já pausa o jogo).
function drawBossWarning(){
  if(bossWarningTimer<=0) return;
  const t = bossWarningTimer / BOSS_WARNING_DURATION; // 1→0
  // Fade-in rápido nos primeiros 15%, sustentado, fade-out nos últimos 30%
  const fadeIn  = Math.min(1, (1-t) / 0.15);
  const fadeOut = Math.min(1, t / 0.30);
  const alpha = Math.min(fadeIn, fadeOut);
  const pulse = 0.5 + 0.5*Math.sin(time*0.35);

  ctx.save();
  // Vinheta vermelha pulsante nas bordas — mesma técnica do screenEdge() de draw()
  const cx=W/2, cy=H/2;
  const grad=ctx.createRadialGradient(cx,cy,Math.min(W,H)*0.32, cx,cy,Math.max(W,H)*0.85);
  grad.addColorStop(0,'rgba(0,0,0,0)');
  grad.addColorStop(1,`rgba(180,10,10,${alpha*0.30*(0.6+0.4*pulse)})`);
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);

  // Faixa de fundo do banner
  const bannerY = H*0.16;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(10,2,4,0.55)';
  ctx.fillRect(0, bannerY-26, W, 52);
  ctx.strokeStyle = `rgba(239,68,68,${0.5+0.5*pulse})`;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, bannerY-26, W, 52);

  // Título
  ctx.textAlign='center';
  ctx.shadowColor='rgba(239,68,68,0.8)'; ctx.shadowBlur=Q(14+pulse*10);
  ctx.fillStyle='#ff3b3b';
  ctx.font=`bold ${16+Math.round(pulse*2)}px 'Orbitron',sans-serif`;
  ctx.fillText(`☠ CHEFE SE APROXIMA — ONDA ${bossWarningWave} ☠`, W/2, bannerY+6);
  ctx.shadowBlur=0;

  ctx.restore();
}

// ─── HUD de Vida do Chefe (barra no topo da tela) ─────────────
function drawBossHUD(){
  if(!activeBoss || activeBoss.dead){ activeBoss=null; return; }
  const e=activeBoss;
  const barW=Math.min(420, W*0.55), barH=14;
  const bx=W/2-barW/2, by=16;

  ctx.save();
  ctx.textAlign='center';
  ctx.shadowColor='rgba(239,68,68,0.6)'; ctx.shadowBlur=Q(8);
  ctx.fillStyle='#ff3b3b'; ctx.font=`bold 12px 'Orbitron',sans-serif`;
  ctx.fillText(`☠ ${e.bossName||'CHEFE'}`, W/2, by-4);
  ctx.shadowBlur=0;

  ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(bx,by,barW,barH);
  const hpF=Math.max(0,e.hp/e.maxHp);
  const grad=ctx.createLinearGradient(bx,0,bx+barW,0);
  grad.addColorStop(0,'#7f1d1d'); grad.addColorStop(1,'#ef4444');
  ctx.fillStyle=grad; ctx.fillRect(bx,by,barW*hpF,barH);
  ctx.strokeStyle='rgba(255,255,255,0.4)'; ctx.lineWidth=1.5;
  ctx.strokeRect(bx,by,barW,barH);

  ctx.fillStyle='#fff'; ctx.font=`9px 'Share Tech Mono',monospace`;
  ctx.fillText(`${Math.ceil(e.hp)} / ${Math.ceil(e.maxHp)}`, W/2, by+barH+12);
  ctx.restore();
}


function getBiomeAt(tx,ty){
  const t=getTile(tx,ty);
  return BIOME_INFO.surface[t] || {name:'Desconhecido',drag:.984};
}

function updateRobot(dt){
  if(robot.dead)return;
  let ix=0,iy=0;
  if(keys['w']||keys['arrowup'])    iy-=1;
  if(keys['s']||keys['arrowdown'])  iy+=1;
  if(keys['a']||keys['arrowleft'])  ix-=1;
  if(keys['d']||keys['arrowright']) ix+=1;
  const ilen=Math.hypot(ix,iy)||1;
  if(Math.hypot(ix,iy)>0.05){ix/=ilen;iy/=ilen;}

  const tx=Math.floor(robot.x/TILE),ty=Math.floor(robot.y/TILE);
  const tile=getTile(tx,ty);
  const binfo=getBiomeAt(tx,ty);
  const speedBonus = getUpgradeValue('speed') * (typeof getMushroomSpeedMult==='function'?getMushroomSpeedMult():1);

  // ── Biomes.js: drag, thrust, maxSpeed via tabela BIOME_FX ─
  const drag = typeof getBiomeDrag==='function' ? getBiomeDrag(tile) : (binfo.drag||0.984);
  const inWater=(tile===T.WATER||tile===T.CORAL||tile===T.DEEP_WATER);

  if(Math.hypot(ix,iy)>0.05 && robot.energy>0){
    const thr = typeof getBiomeThrust==='function'
      ? getBiomeThrust(tile, speedBonus)
      : 0.32*speedBonus;
    robot.vx+=ix*thr; robot.vy+=iy*thr;
    // Modo criativo: sem custo de energia
    if(gameMode!==GAME_MODES.CREATIVE){
      const eDrainMult=(typeof ROGUE!=='undefined' && ROGUE.mods) ? ROGUE.mods.energyDrainMult : 1;
      robot.energy=Math.max(0,robot.energy-0.035*(eDrainMult||1));
    }
  }
  robot.vx*=drag; robot.vy*=drag;

  const maxSpd = typeof getBiomeMaxSpeed==='function'
    ? getBiomeMaxSpeed(tile) : 6.5;
  const spd=Math.hypot(robot.vx,robot.vy);
  if(spd>maxSpd*speedBonus){robot.vx=robot.vx/spd*maxSpd*speedBonus;robot.vy=robot.vy/spd*maxSpd*speedBonus;}

  robot.x+=robot.vx; robot.y+=robot.vy;
  resolveBlockCollisions();
  robot.x=clamp(robot.x,robot.radius,WORLD_W*TILE-robot.radius);
  robot.y=clamp(robot.y,robot.radius,WORLD_H*TILE-robot.radius);

  if(spd>0.25) robot.angle=lerpAngle(robot.angle,Math.atan2(robot.vy,robot.vx),0.12);

  // Modo criativo: sem dano
  if(gameMode!==GAME_MODES.CREATIVE){
    // Efeitos de bioma via biomes.js
    if(typeof applyBiomeEffects==='function') applyBiomeEffects(tile);
    // Dissipação passiva de calor (chip radiador)
    const passiveHeatDown=(typeof ROGUE!=='undefined' && ROGUE.mods) ? ROGUE.mods.passiveHeatDown : 0;
    if(passiveHeatDown) robot.heat=Math.max(0,robot.heat-passiveHeatDown);
  }

  const regenRate=getUpgradeValue('energyRegen');
  if(Math.hypot(ix,iy)<0.05&&gameMode!==GAME_MODES.CREATIVE)
    robot.energy=Math.min(robot.maxEnergy,robot.energy+regenRate);
  if(gameMode===GAME_MODES.CREATIVE){
    robot.energy=Math.min(robot.maxEnergy,robot.energy+0.5);
    robot.heat=Math.max(0,robot.heat-0.5);
  }
  const hpRegen=getUpgradeValue('regen');
  if(hpRegen>0) robot.hp=Math.min(robot.maxHp,robot.hp+hpRegen/60);

  if(robot.invTimer>0)   robot.invTimer--;
  if(portalCooldown>0)   portalCooldown--;
  checkInteractables();

  const bname=binfo.name||'?';
  if(bname!==robot.prevBiome){
    showBiome(bname);robot.prevBiome=bname;
    if(typeof ariaOnBiome==='function') ariaOnBiome(bname);
  }

  cam.x=lerp(cam.x,robot.x,0.08);
  cam.y=lerp(cam.y,robot.y,0.08);

  if(robot.hp<=0&&gameMode!==GAME_MODES.CREATIVE){
    if(!(typeof rogueTryEmergencyShield==='function' && rogueTryEmergencyShield())){
      robot.dead=true;endGame();
    }
  }

  if(spd>0.5&&(time%2<1)){
    const ang=robot.angle+Math.PI;
    const fx2=typeof getBiomeFX==='function'?getBiomeFX(tile):null;
    const tc=fx2?fx2.trailCol:(inWater?'#38bdf8':'#7dd3fc');
    spawnParticle(robot.x+Math.cos(ang)*16,robot.y+Math.sin(ang)*16,
      Math.cos(ang)*0.3+(Math.random()-.5)*0.3,
      Math.sin(ang)*0.3+(Math.random()-.5)*0.3,
      inWater?24:14,tc,3);
  }

  if(buildCooldown>0)    buildCooldown--;
  if(teleportCooldown>0) teleportCooldown--;
  
  // Update scanner system
  if(typeof updateScanner==='function') updateScanner();
}

function resolveBlockCollisions(){
  const r=robot.radius;
  const c0=Math.floor((robot.x-r)/TILE)-1,c1=Math.floor((robot.x+r)/TILE)+1;
  const r0=Math.floor((robot.y-r)/TILE)-1,r1=Math.floor((robot.y+r)/TILE)+1;
  for(let ty=r0;ty<=r1;ty++){
    for(let tx=c0;tx<=c1;tx++){
      if(!inBounds(tx,ty))continue;
      if(!SOLID.has(worldGrid()[wi(tx,ty)]))continue;
      const bx=tx*TILE,by=ty*TILE;
      const dx=robot.x-clamp(robot.x,bx,bx+TILE);
      const dy=robot.y-clamp(robot.y,by,by+TILE);
      const dsq=dx*dx+dy*dy;
      if(dsq<r*r){
        const d=Math.sqrt(dsq)||0.001;
        const ov=r-d;
        robot.x+=dx/d*ov; robot.y+=dy/d*ov;
        // Remover componente de velocidade na direção da parede (sem amplificar)
        const dot=robot.vx*(dx/d)+robot.vy*(dy/d);
        if(dot<0){robot.vx-=dot*(dx/d);robot.vy-=dot*(dy/d);}
      }
    }
  }
}

// ─── Teleporte ────────────────────────────────────────────────
// Tecla F: teleporta até o cursor do mouse dentro de um raio limitado.
// Custa TODA a energia. Cooldown de 4s após uso.
const TELEPORT_RANGE = 400; // px máximo de distância
const TELEPORT_COOLDOWN_FRAMES = 240; // 4s a 60fps (era 30 — não batia com a doc/HUD)

// Checagens comuns (PC: tecla F · mobile: botão 🌀 antes de pausar pra mirar).
// Devolve true se o teleporte pode ser usado agora; senão avisa o motivo.
function teleportPrecheck(){
  if(!ownedAbilities.has('TELEPORT')){ showAlert('🔒 TELEPORTE NÃO COMPRADO — [L] LOJA'); return false; }
  if(disabledItems.has('TELEPORT')){ showAlert('🌀 TELEPORTE DESATIVADO — [I] INVENTÁRIO'); return false; }
  if(!running||robot.dead) return false;
  if(teleportCooldown>0){ showAlert('TELEPORTE EM RECARGA'); return false; }
  if(robot.energy<20){ showAlert('ENERGIA INSUFICIENTE'); return false; }
  return true;
}

// aimX/aimY (mundo) opcionais: sem eles usa o cursor do mouse (PC).
function tryTeleport(aimX,aimY){
  if(!teleportPrecheck()) return false;
  if(aimX===undefined){ aimX=mouseWorld.x; aimY=mouseWorld.y; }

  // Destino: ponto mirado, limitado ao raio
  const dx=aimX-robot.x, dy=aimY-robot.y;
  const d=Math.hypot(dx,dy)||1;
  const range=Math.min(d,TELEPORT_RANGE);
  let tx2=robot.x+dx/d*range;
  let ty2=robot.y+dy/d*range;

  // Encontrar tile livre mais próximo do destino (com carving de emergência)
  const ttx=Math.floor(tx2/TILE), tty=Math.floor(ty2/TILE);
  const sp=findClearSpawn(ttx,tty,true);
  const destX=(sp.tx+0.5)*TILE, destY=(sp.ty+0.5)*TILE;
  // Cancelar se ainda estiver dentro de sólido (segurança extra)
  if(SOLID.has(getTile(sp.tx,sp.ty))){ showAlert('TELEPORTE BLOQUEADO'); return false; }

  // Efeito de partículas na origem
  spawnBurst(robot.x,robot.y,'#38bdf8',20,5);
  spawnBurst(robot.x,robot.y,'#a78bfa',10,3);

  // Teletransportar
  robot.x=destX; robot.y=destY;
  robot.vx=0; robot.vy=0;
  cam.x=robot.x; cam.y=robot.y;

  // Inimigos muito próximos do destino ficam "perdidos" por 1s antes de
  // voltar a atirar (sem efeito visual — ver ai-enemy.js)
  if(typeof aiEnemyOnPlayerTeleport==='function') aiEnemyOnPlayerTeleport();

  // Efeito no destino
  spawnBurst(robot.x,robot.y,'#38bdf8',20,5);

  // Gastar TODA energia + cooldown (chip "Capacitor de Salto" reduz o cooldown)
  robot.energy=robot.energy-20;
  const teleCdMult=(typeof ROGUE!=='undefined' && ROGUE.mods) ? ROGUE.mods.teleportCdMult : 1;
  teleportCooldown=Math.round(TELEPORT_COOLDOWN_FRAMES*teleCdMult);
  showAlert('⚡ TELEPORTE');
  return true;
}

// ── Teleporte mobile: botão 🌀 → jogo pausa → jogador toca no destino ──
// Toque/arraste move a mira (já limitada ao alcance); soltar o dedo confirma.
// Apertar 🌀 de novo (ou Esc) cancela e despausa sem gastar nada.
let teleportTargeting = false;
let teleportAim = null; // {x,y} em coordenadas de mundo, já limitado a TELEPORT_RANGE

function startTeleportTargeting(){
  if(teleportTargeting){ cancelTeleportTargeting(); return; }
  if(!running || isPaused()) return;
  if(!teleportPrecheck()) return; // avisa o motivo e NÃO pausa
  teleportTargeting = true;
  teleportAim = null;
  mouseDown = false;
  addPause('teleport');
}
function cancelTeleportTargeting(){
  if(!teleportTargeting) return;
  teleportTargeting = false;
  teleportAim = null;
  removePause('teleport');
}
function _clampTeleportAim(px,py){
  const dx=px-robot.x, dy=py-robot.y, d=Math.hypot(dx,dy)||1;
  const r=Math.min(d,TELEPORT_RANGE);
  return { x: robot.x+dx/d*r, y: robot.y+dy/d*r };
}
function _touchWorld(t){
  const r=canvas.getBoundingClientRect();
  return { x:(t.clientX-r.left-W/2)+cam.x, y:(t.clientY-r.top-H/2)+cam.y };
}
function _teleportTouchMove(e){
  if(!teleportTargeting) return;
  e.preventDefault();
  const t=e.changedTouches[0]; if(!t) return;
  const p=_touchWorld(t);
  teleportAim=_clampTeleportAim(p.x,p.y);
}
canvas.addEventListener('touchstart', _teleportTouchMove, {passive:false});
canvas.addEventListener('touchmove',  _teleportTouchMove, {passive:false});
canvas.addEventListener('touchend', e=>{
  if(!teleportTargeting) return;
  e.preventDefault(); // sem "clique fantasma" (que construiria um bloco no destino)
  if(!teleportAim) return;
  const a=teleportAim;
  cancelTeleportTargeting(); // despausa antes de teleportar
  tryTeleport(a.x,a.y);
}, {passive:false});
canvas.addEventListener('touchcancel', ()=>{ if(teleportTargeting) teleportAim=null; });

// Círculo de alcance + mira do destino enquanto o jogador escolhe onde cair.
function drawTeleportTargeting(){
  if(!teleportTargeting) return;
  const sx=robot.x-cam.x+W/2, sy=robot.y-cam.y+H/2;
  ctx.save();
  ctx.lineWidth=1.5;
  ctx.setLineDash([6,6]);
  ctx.strokeStyle='rgba(56,189,248,0.55)';
  ctx.fillStyle='rgba(56,189,248,0.05)';
  ctx.beginPath(); ctx.arc(sx,sy,TELEPORT_RANGE,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
  if(teleportAim){
    const ax=teleportAim.x-cam.x+W/2, ay=teleportAim.y-cam.y+H/2;
    ctx.strokeStyle='rgba(56,189,248,0.4)';
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(ax,ay); ctx.stroke();
    ctx.strokeStyle='#7dd3fc'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(ax,ay,14,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax-20,ay); ctx.lineTo(ax-8,ay); ctx.moveTo(ax+8,ay); ctx.lineTo(ax+20,ay);
    ctx.moveTo(ax,ay-20); ctx.lineTo(ax,ay-8); ctx.moveTo(ax,ay+8); ctx.lineTo(ax,ay+20); ctx.stroke();
  }
  ctx.restore();
}

// ─── Combate automático ────────────────────────────────────────
// Cada arma POSSUÍDA (ownedWeapons) atira sozinha, no seu próprio ritmo,
// contra o inimigo vivo mais próximo dentro do alcance — o jogador só
// precisa se posicionar. Substitui o antigo disparo manual (mirar+clicar).
function findNearestEnemy(x,y,maxRange){
  let best=null,bestD2=maxRange*maxRange;
  for(const e of enemies){
    if(e.dead) continue;
    const dx=e.x-x, dy=e.y-y;
    const d2=dx*dx+dy*dy;
    if(d2<bestD2){ bestD2=d2; best=e; }
  }
  return best;
}

function fireWeaponAt(weaponKey, tgtX, tgtY){
  const wdef=WEAPONS[weaponKey];
  const dx=tgtX-robot.x, dy=tgtY-robot.y;

  const rHeatMult = (typeof ROGUE!=='undefined' && ROGUE.mods) ? ROGUE.mods.heatGainMult : 1;
  robot.energy=Math.max(0,robot.energy-wdef.energyCost);
  robot.heat=Math.min(robot.maxHeat,robot.heat+wdef.heatGain*rHeatMult);

  const rDmgMult = (typeof rogueGetDamageMult==='function') ? rogueGetDamageMult() : 1;
  const dmgMult = getUpgradeValue('laserDmg') * rDmgMult;
  const critChance = getUpgradeValue('critChance');
  const isCrit = Math.random() < critChance;
  const finalDmgMult = isCrit ? dmgMult * getUpgradeValue('critMult') : dmgMult;

  if(weaponKey==='LASER'){
    spawnProjectile(robot.x,robot.y,tgtX,tgtY,'laser',false,{dmgMult:finalDmgMult,isCrit});
  } else if(weaponKey==='SHOTGUN'){
    const baseAngle=Math.atan2(dy,dx);
    for(let i=-3;i<=3;i++){
      const a=baseAngle+i*0.12+(Math.random()-0.5)*0.05;
      spawnProjectile(robot.x,robot.y,robot.x+Math.cos(a)*100,robot.y+Math.sin(a)*100,'pellet',false,{dmgMult:finalDmgMult,isCrit});
    }
  } else if(weaponKey==='PLASMA'){
    if(manualFireMode){
      // Tiro manual: 1 disparo preciso por clique/cooldown, como as outras armas
      spawnProjectile(robot.x,robot.y,tgtX,tgtY,'plasma',false,{dmgMult:finalDmgMult,isCrit});
    } else {
      // Tiro automático: rajada de 3 — mesmo alvo, pequeno deslocamento no
      // ponto de saída só pra separar visualmente os 3 tiros (não é espalhamento
      // de precisão como a Escopeta; os três convergem no mesmo alvo).
      for(let i=-1;i<=1;i++){
        spawnProjectile(robot.x+i*4,robot.y+i*4,tgtX,tgtY,'plasma',false,{dmgMult:finalDmgMult,isCrit});
      }
    }
  } else if(weaponKey==='ROCKET'){
    spawnProjectile(robot.x,robot.y,tgtX,tgtY,'rocket',false,{dmgMult:finalDmgMult,isCrit});
  } else if(weaponKey==='GRENADE'){
    spawnProjectile(robot.x,robot.y,tgtX,tgtY,'grenade',false,{dmgMult:finalDmgMult,isCrit});
  } else if(weaponKey==='RAILGUN'){
    spawnProjectile(robot.x,robot.y,tgtX,tgtY,'railgun',false,{dmgMult:finalDmgMult,isCrit,pierce:true});
  } else if(weaponKey==='CHAIN'){
    spawnProjectile(robot.x,robot.y,tgtX,tgtY,'chain',false,{dmgMult:finalDmgMult,isCrit,bounces:3});
  }
}

function updateAutoWeapons(){
  if(gameMode===GAME_MODES.CREATIVE) return; // sem combate no modo criativo
  const rCooldownMult = (typeof rogueGetCooldownMult==='function') ? rogueGetCooldownMult() : 1;

  // Modo manual: nada dispara sem o botão esquerdo segurado (e com a
  // ferramenta "Atirar" selecionada) — sem isso, pula o frame inteiro.
  if(fireDisabled) return; // tiro desligado (Q / botão mobile)
  const manualActive = manualFireMode && currentTool==='fire' && mouseDown;
  if(manualFireMode && !manualActive) return;

  // Alvo automático: calculado UMA VEZ por frame (não uma vez por arma) e
  // reaproveitado por todas as armas possuídas — evita 7 varreduras
  // idênticas em `enemies` a cada frame conforme o jogador compra mais armas.
  let cachedNearest, nearestComputed=false;

  for(const w of WEAPON_ORDER){
    if(!ownedWeapons.has(w)) continue;
    if(disabledItems.has(w)) continue; // desativada no inventário
    if(weaponCooldowns[w]===undefined) weaponCooldowns[w]=0;
    if(weaponCooldowns[w]>0){ weaponCooldowns[w]--; continue; }
    const wdef=WEAPONS[w];
    if(robot.energy<wdef.energyCost) continue;

    let tx,ty;
    if(manualFireMode){
      const dx=mouseWorld.x-robot.x, dy=mouseWorld.y-robot.y;
      if(Math.sqrt(dx*dx+dy*dy)>LASER_RANGE) continue; // cursor fora de alcance
      tx=mouseWorld.x; ty=mouseWorld.y;
    } else {
      if(!nearestComputed){ cachedNearest=findNearestEnemy(robot.x,robot.y,LASER_RANGE); nearestComputed=true; }
      if(!cachedNearest) continue;
      tx=cachedNearest.x; ty=cachedNearest.y;
    }

    fireWeaponAt(w, tx, ty);
    weaponCooldowns[w]=Math.max(1,Math.round(wdef.cooldown*rCooldownMult));
  }
}


function tryBuildAction(){
  if(currentTool==='build'){
    if(buildCooldown>0) return;
    const tx=Math.floor(mouseWorld.x/TILE),ty=Math.floor(mouseWorld.y/TILE);
    if(!inBounds(tx,ty)) return;
    const bCostMult=(typeof ROGUE!=='undefined' && ROGUE.mods) ? ROGUE.mods.buildCostMult : 1;
    const cost=(BUILD_COSTS[currentBuildType]||5)*(bCostMult||1);
    if(robot.energy<cost) return;
    const bRange = getUpgradeValue('buildRange');
    if(Math.hypot(mouseWorld.x-robot.x,mouseWorld.y-robot.y)>bRange) return;
    
    // Scanner system: check if block is discovered
    if(typeof isBlockDiscovered === 'function' && !isBlockDiscovered(currentBuildType)){
      const needScan = typeof SCANNABLE !== 'undefined' && SCANNABLE[currentBuildType];
      const hint = needScan ? ` Escaneie [${needScan.name}] com [G].` : '';
      showAlert(`🔍 ${BUILD_NAMES[currentBuildType]} não descoberto!${hint}`);
      return;
    }
    
    const curTile=getTile(tx,ty);
    const canBuild=!SOLID.has(curTile)&&curTile!==T.AIR
      &&curTile!==T.DEEP_WATER&&curTile!==T.LAVA&&curTile!==T.WATER&&curTile!==T.PORTAL;
    if(canBuild){
      setTile(tx,ty,currentBuildType);
      robot.energy=Math.max(0,robot.energy-cost);
      buildCooldown=15;
      spawnBurst(tx*TILE+TILE/2,ty*TILE+TILE/2,'#38bdf8',4,1.5);
      minimapDirty=true;
    }
  } else if(currentTool==='destroy'){
    if(buildCooldown>0) return;
    const tx=Math.floor(mouseWorld.x/TILE),ty=Math.floor(mouseWorld.y/TILE);
    if(!inBounds(tx,ty)) return;
    // Verificar range para destroy também
    const bRange = getUpgradeValue('buildRange');
    if(Math.hypot(mouseWorld.x-robot.x,mouseWorld.y-robot.y)>bRange) return;
    const t=getTile(tx,ty);
    const allowDestroyReinforced = DESTROYABLE.has(t)||(t===T.REINFORCED);
    if(allowDestroyReinforced){
      const idx=wi(tx,ty);
      const dmgAmt=(t===T.REINFORCED)?5:15;
      integrity()[idx]=Math.max(0,integrity()[idx]-dmgAmt);
      if(integrity()[idx]<=0){
        // Usar tile de chão adequado à dimensão atual
        const floorTile = T.GRASS;
        setTile(tx,ty,floorTile);
        onBlockBroken(tx, ty, t); // score + burst + XP se raro
      }
      robot.energy=Math.max(0,robot.energy-1.5);
      robot.heat=Math.min(robot.maxHeat,robot.heat+0.8);
      buildCooldown=4;
    }
  }
}

// ─── Projectile System ───────────────────────────────────────
const projectiles = [];
function spawnProjectile(x,y,tx,ty,type,isEnemy=false,extra={}){
  const dx=tx-x, dy=ty-y;
  const d=Math.sqrt(dx*dx+dy*dy)||1;
  const dmgMult = extra.dmgMult||1;
  let spd=12, life=28, dmg=18*dmgMult, size=3, col=isEnemy?'#ef4444':'#7dd3fc';
  if(type==='plasma')  {spd=8;  life=60; dmg=8*dmgMult;   size=4; col='#38bdf8';}
  if(type==='rocket')  {spd=7;  life=50; dmg=80*dmgMult;  size=6; col='#f97316';}
  if(type==='grenade') {spd=5;  life=35; dmg=60*dmgMult;  size=5; col='#fbbf24';}
  if(type==='pellet')  {spd=14; life=18; dmg=10*dmgMult;  size=2; col='#fff';}
  if(type==='enemy')   {spd=10; life=32; dmg=6;           size=3; col='#fca5a5';}
  if(type==='railgun') {spd=18; life=24; dmg=120*dmgMult;  size=3; col='#00ffff';}
  if(type==='chain')   {spd=10; life=20; dmg=20*dmgMult;  size=4; col='#a78bfa';}
  if(type==='void_bolt'){spd=9; life=40; dmg=12;          size=4; col='#7c3aed';}
  // Visual de crítico: proj maior e dourado
  if(extra.isCrit){ size = Math.ceil(size * 1.5); col = '#ffe100'; }
  projectiles.push({
    x, y, vx:(dx/d)*spd, vy:(dy/d)*spd,
    life, type, isEnemy, dmg, size, col,
    trail:[], pierce:extra.pierce||false, pierceHit:new Set(),
    bounces:extra.bounces||0,
    isCrit:!!extra.isCrit,
  });
}

function updateProjectiles(){
  for(let i=projectiles.length-1;i>=0;i--){
    const p=projectiles[i];
    p.trail.push({x:p.x,y:p.y});
    if(p.trail.length>10) p.trail.shift();
    p.x+=p.vx; p.y+=p.vy;
    p.life--;

    const tx=Math.floor(p.x/TILE),ty=Math.floor(p.y/TILE);
    const tileHit=inBounds(tx,ty)&&SOLID.has(getTile(tx,ty));

    if(tileHit){
      const tt=getTile(tx,ty);
      const isDestroyable=DESTROYABLE.has(tt);
      if(isDestroyable){
        const idx=wi(tx,ty);
        // Inimigos: projéteis causam dano menor em blocos do player
        // Player: destruição normal
        let dmgAmt;
        if(p.isEnemy){
          // Inimigos danificam blocos do player, mas mais devagar
          // void_bolt e grenade causam mais dano
          if(tt===T.REINFORCED)      dmgAmt = (p.type==='void_bolt'||p.type==='grenade') ? 4 : 2;
          else if(tt===T.BUILT_BLOCK) dmgAmt = p.type==='grenade'?25:p.type==='void_bolt'?15:8;
          else                        dmgAmt = p.type==='grenade'?20:p.type==='void_bolt'?10:5;
        } else {
          dmgAmt = (tt===T.REINFORCED) ? 3 : 20;
        }
        integrity()[idx]=Math.max(0,integrity()[idx]-dmgAmt);
        if(integrity()[idx]<=0){
          const floorTile = T.GRASS;
          setTile(tx,ty,floorTile);
          onBlockBroken(tx, ty, tt, {isEnemy: p.isEnemy, burstN:5});
        }
      }
      if(p.type==='rocket'||p.type==='grenade'){
        const blastMult = p.isEnemy ? 1 : getUpgradeValue('blastRadius');
        doExplosion(p.x,p.y,(p.type==='rocket'?80:60)*blastMult,p.dmg,p.isEnemy);
      } else {
        spawnBurst(p.x,p.y,p.isEnemy?'#ef4444':'#7dd3fc',4,1.5);
      }
      projectiles.splice(i,1); continue;
    }

    if(p.isEnemy && robot.invTimer<=0){
      const dx=p.x-robot.x,dy=p.y-robot.y;
      if(dx*dx+dy*dy<robot.radius*robot.radius*1.4){
        const armorMult = getUpgradeValue('armor');
        const dmgTaken = p.dmg*armorMult;
        robot.hp=Math.max(0,robot.hp-dmgTaken);
        if(typeof rogueOnRobotDamage==='function') rogueOnRobotDamage(dmgTaken);
        robot.invTimer=25;
        spawnBurst(robot.x,robot.y,'#ef4444',6,2);
        projectiles.splice(i,1); continue;
      }
    }

    if(!p.isEnemy){
      let hit=false;
      for(let j=enemies.length-1;j>=0;j--){
        const e=enemies[j];
        if(e.dead) continue;
        if(p.pierce && p.pierceHit.has(e.id)) continue;
        const dx=p.x-e.x,dy=p.y-e.y;
        if(dx*dx+dy*dy<e.size*e.size*2){
          e.hp-=p.dmg; e.flashTimer=10;
          if(typeof rogueOnEnemyDamaged==='function') rogueOnEnemyDamaged(p.dmg);
          spawnBurst(e.x,e.y,e.col,5,2);
          // BUG FIX: feedback visual de crítico (upgrade antes sem efeito)
          if(p.isCrit) spawnBurst(e.x,e.y,'#ffe100',10,3);
          if(e.hp<=0&&!e.dead){
            e.dead=true;
            score+=e.score; enemiesKilled++;
            // XP vem apenas dos orbs ao serem coletados (evitar dupla contagem)
            spawnBurst(e.x,e.y,e.col,14,3);
            spawnXPOrb(e.x,e.y,e.xp||e.score);
          }
          if(p.pierce){ p.pierceHit.add(e.id); hit=false; }  // BUG FIX: id estável, não índice
          else if(p.bounces>0){
            // Chain: rebate pro inimigo mais próximo
            p.bounces--;
            let bestD=Infinity, be=null;
            for(const f of enemies){
              if(f===e||f.dead) continue;
              const fd=dist2(p.x,p.y,f.x,f.y);
              if(fd<bestD&&fd<(250*250)){bestD=fd;be=f;}
            }
            if(be){
              const nd=Math.hypot(be.x-p.x,be.y-p.y)||1;
              p.vx=(be.x-p.x)/nd*10; p.vy=(be.y-p.y)/nd*10;
              hit=false;
            } else {
              projectiles.splice(i,1); hit=true; break;
            }
          } else {
            if(p.type==='rocket'||p.type==='grenade'){
              const blastMult = getUpgradeValue('blastRadius');
              doExplosion(p.x,p.y,(p.type==='rocket'?80:60)*blastMult,p.dmg,false);
            }
            projectiles.splice(i,1); hit=true; break;
          }
        }
      }
      if(hit) continue;
    }

    if(p.life<=0) projectiles.splice(i,1);
  }
}

// ─── Enemy Update ────────────────────────────────────────────
function updateEnemies(){
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    if(e.dead){enemies.splice(i,1);continue;}
    if(e.flashTimer>0) e.flashTimer--;
    if(e.slowTimer>0)  e.slowTimer--;

    const dx=robot.x-e.x,dy=robot.y-e.y;
    const d=Math.sqrt(dx*dx+dy*dy)||1;
    const phasing=(e.type==='SPECTER'||e.flying);
    const speedMult=e.slowTimer>0?0.3:1.0;

    // Summoner: invoca scout periodicamente
    if(e.summoner){
      e.summonTimer = (e.summonTimer||0) + 1;
      if(e.summonTimer>=300){
        e.summonTimer=0;
        const stx=Math.floor(e.x/TILE),sty=Math.floor(e.y/TILE);
        spawnEnemy('SCOUT',stx+Math.floor(Math.random()*3-1),sty+Math.floor(Math.random()*3-1),0.8);
        spawnBurst(e.x,e.y,'#6d28d9',8,2);
      }
    }

    // Pular processamento de inimigos muito distantes da câmera (off-screen culling leve)
    const screenDX = e.x - cam.x, screenDY = e.y - cam.y;
    const onScreen = Math.abs(screenDX) < W * 2 && Math.abs(screenDY) < H * 2;

    if(e.type!=='TURRET'){
      let mvx,mvy;
      if(phasing){
        mvx=dx/d; mvy=dy/d;
      } else {
        const ff=flowDir(e.x,e.y);
        mvx=ff.dx; mvy=ff.dy;
        if(mvx===0&&mvy===0){mvx=dx/d;mvy=dy/d;}
      }

      e.vx+=mvx*e.speed*0.10*speedMult;
      e.vy+=mvy*e.speed*0.10*speedMult;
      e.vx*=0.88; e.vy*=0.88;

      // Separação — verificar apenas vizinhos próximos (evitar O(n²) pesado)
      const sepLimit = (e.size + 32) * 1.5;
      const sepLimit2 = sepLimit * sepLimit;
      if(onScreen || enemies.length < 30){ // separação completa só em tela ou poucos inimigos
        for(const f of enemies){
          if(f===e||f.dead) continue;
          const fx=e.x-f.x,fy=e.y-f.y;
          const fd2=fx*fx+fy*fy;
          if(fd2 < sepLimit2 && fd2 > 0){
            const fd=Math.sqrt(fd2);
            const minD=(e.size+f.size)*1.5;
            if(fd<minD){e.vx+=fx/fd*0.6;e.vy+=fy/fd*0.6;}
          }
        }
      }

      e.x+=e.vx; e.y+=e.vy;

      if(!phasing){
        const etx=Math.floor(e.x/TILE),ety=Math.floor(e.y/TILE);
        if(inBounds(etx,ety)&&SOLID.has(getTile(etx,ety))){
          const etx2=Math.floor((e.x-e.vx)/TILE);
          const ety2=Math.floor((e.y-e.vy)/TILE);
          if(!SOLID.has(getTile(etx2,ety)))      {e.x-=e.vx;e.vx=0;}
          else if(!SOLID.has(getTile(etx,ety2))) {e.y-=e.vy;e.vy=0;}
          else                                    {e.x-=e.vx;e.y-=e.vy;e.vx=0;e.vy=0;}
        }

        // Armadilhas
        const etxN=Math.floor(e.x/TILE),etyN=Math.floor(e.y/TILE);
        const underTile=getTile(etxN,etyN);
        if(underTile===T.TRAP_SLOW){
          e.slowTimer=45;
          spawnParticle(e.x,e.y,0,-0.5,20,'#38bdf8',3);
        }
        if(underTile===T.TRAP_DAMAGE){
          e.hp-=0.8;e.flashTimer=4;
          if(Math.random()<0.08) spawnParticle(e.x,e.y,(Math.random()-.5)*2,-1,15,'#ef4444',3);
          if(e.hp<=0&&!e.dead){e.dead=true;score+=e.score;enemiesKilled++;spawnBurst(e.x,e.y,e.col,10,3);spawnXPOrb(e.x,e.y,e.xp||e.score);}
        }
        if(underTile===T.SPIKE_BLOCK){
          e.hp-=2.5;e.flashTimer=6;
          spawnParticle(e.x,e.y,(Math.random()-.5)*2,-1.5,18,'#ef4444',3);
          if(e.hp<=0&&!e.dead){e.dead=true;score+=e.score;enemiesKilled++;spawnBurst(e.x,e.y,e.col,10,3);spawnXPOrb(e.x,e.y,e.xp||e.score);}
        }
      }
    }
    e.angle=Math.atan2(dy,dx);

    // Tiro
    const canShoot=e.type==='SCOUT'||e.type==='FLYER'||e.type==='TURRET'||e.type==='SPECTER'||
                   e.type==='BOMBER'||e.type==='ELITE'||e.type==='NECRO';
    if(canShoot){
      e.shootCooldown--;
      const shootRange = e.elite ? 450 : 380;
      if(e.shootCooldown<=0&&d<shootRange){
        if(e.type==='BOMBER'){
          spawnProjectile(e.x,e.y,robot.x,robot.y,'grenade',true);
          e.shootCooldown=100;
        } else if(e.type==='ELITE'){
          // Elite: 3 projéteis em leque
          for(let si=-1;si<=1;si++){
            const ba=Math.atan2(dy,dx)+si*0.2;
            spawnProjectile(e.x,e.y,e.x+Math.cos(ba)*100,e.y+Math.sin(ba)*100,'enemy',true);
          }
          e.shootCooldown=50;
        } else {
          spawnProjectile(e.x,e.y,robot.x,robot.y,'enemy',true);
          e.shootCooldown=e.type==='TURRET'?48:e.type==='SPECTER'?60:80;
        }
      }
    }

    // Corpo a corpo
    if(d<robot.radius+e.size+2&&robot.invTimer<=0){
      const armorMult = getUpgradeValue('armor');
      const dmgTaken = e.dmg*0.05*armorMult;
      robot.hp=Math.max(0,robot.hp-dmgTaken);
      if(typeof rogueOnRobotDamage==='function') rogueOnRobotDamage(dmgTaken);
      robot.invTimer=15;
    }
  }
}

let _waveClearPending = false; // true enquanto a onda atual tem inimigos vivos ou fila de spawn

function updateWaves(){
  if(bossWarningTimer>0) bossWarningTimer--;

  // Processar fila de spawn por frames
  for(let i=spawnQueue.length-1;i>=0;i--){
    const s=spawnQueue[i];
    s.delay--;
    if(s.delay<=0){
      if(running){
        if(s.boss) spawnBoss(wave);
        else spawnEnemy(s.type,s.tx,s.ty,s.scaleMult);
      }
      spawnQueue.splice(i,1);
    }
  }

  // ── Detecção de onda limpa → tela de chips roguelike ─────────
  // Dispara exatamente uma vez, na transição de "tinha inimigo/fila"
  // para "não tem mais nenhum". Se abrir a tela de escolha, retorna
  // cedo neste frame para não deixar startWave()/waveTimer avançarem
  // por baixo do pause (ver ROGUE.screenOpen em roguelike.js).
  const waveHasActivity = enemies.length>0 || spawnQueue.length>0;
  if(waveHasActivity){
    _waveClearPending = true;
  } else if(_waveClearPending){
    _waveClearPending = false;
    if(wave>0 && typeof rogueOnWaveClear==='function' && rogueOnWaveClear()) return;
  }

  if(enemies.length===0&&waveTimer<=0&&spawnQueue.length===0) startWave();
  if(waveTimer>0) waveTimer--;

  // ── Auto-wave: timer de pressão quando há inimigos vivos ────
  // Só conta quando ainda há inimigos na onda atual (não no cooldown entre ondas)
  if(enemies.length>0 || spawnQueue.length>0){
    autoWaveTimer++;
    if(autoWaveTimer>=AUTO_WAVE_MAX && gameMode!==GAME_MODES.CREATIVE){
      // Tempo esgotado: força a próxima onda mesmo com inimigos vivos
      autoWaveTimer=0;
      spawnBurst(robot.x, robot.y, '#ef4444', 12, 3);
      // Mata todos os inimigos restantes (onda limpa por exaustão de tempo)
      // for(const e of enemies){ e.dead=true; }
      waveTimer=0; // dispara startWave no próximo frame
    }
  } else {
    autoWaveTimer=0; // reset quando não há inimigos (cooldown entre ondas)
  }
}

function updateParticles(){
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.x+=p.vx; p.y+=p.vy;
    p.vx*=0.94; p.vy*=0.94;
    // XP orbs nunca expiram — ficam até serem coletados
    if(!p.isXP) p.life--;
    if(p.isXP){
      p.xpAge=(p.xpAge||0)+1;
      const pdx=robot.x-p.x,pdy=robot.y-p.y;
      const pd=Math.hypot(pdx,pdy)||1;
      // Chip "Coletor Otimizado" + nó de evolução "Ímã de XP": raio magnético extra e atração mais rápida
      const rm2=(typeof ROGUE!=='undefined' && ROGUE.mods) ? ROGUE.mods : null;
      const xpRadiusBonus=rm2 ? rm2.xpRadiusBonus : 0;
      const xpPullMult=rm2 ? rm2.xpPullMult : 1;
      const skillMagnetBonus=(typeof getUpgradeValue==='function') ? getUpgradeValue('xpMagnet') : 0;
      const magnetRadius=XP_MAGNET_BASE+xpRadiusBonus+skillMagnetBonus;
      // Coleta imediata ao encostar (raio fixo — a distância que realmente importa agora é o ímã)
      if(pd<robot.radius+10){
        gainXP(p.xpVal||5);
        particles.splice(i,1); continue;
      }
      // Fora do raio magnético: orb fica parado (só a fricção acima o desacelera).
      // Dentro dele: atração com força pulsante — ciclo 0.5s→burst1 / 0.5s→burst3 / 0.5s→burst4...
      if(pd<magnetRadius){
        const pull=xpPullSpeed(p.xpAge)*xpPullMult;
        // Inércia extra para longas distâncias (orb "dispara" em direção ao player)
        const distBoost=Math.min(pd/80,3.0);
        p.vx+=pdx/pd*pull*distBoost;
        p.vy+=pdy/pd*pull*distBoost;
        const orbSpd=Math.hypot(p.vx,p.vy);
        const maxOrbSpd=pull>2?16:5;
        if(orbSpd>maxOrbSpd){p.vx=p.vx/orbSpd*maxOrbSpd;p.vy=p.vy/orbSpd*maxOrbSpd;}
      }
    }
    if(p.life<=0) particles.splice(i,1);
  }
}

// ─── Minimap ─────────────────────────────────────────────────
let minimapDirty=true;
// PERF: o minimapa é o principal suspeito de lag em mapas grandes — o buffer
// é do tamanho do mundo inteiro (até 1600×1200) e antes disso era redesenhado
// (blit + pontos de robô/inimigos/antenas) TODO frame, mesmo sem nada novo
// para mostrar. Agora só atualiza a cada MINIMAP_UPDATE_INTERVAL frames; entre
// atualizações o canvas simplesmente mantém o último frame desenhado.
const MINIMAP_UPDATE_INTERVAL = 300; // 5s a 60fps
let minimapUpdateTimer = 0;          // <=0 → é hora de redesenhar
const minimapBuffer=document.createElement('canvas');
minimapBuffer.width=WORLD_W; minimapBuffer.height=WORLD_H;
const mbCtx=minimapBuffer.getContext('2d');

function resizeMinimapBuffer(){
  minimapBuffer.width=WORLD_W; minimapBuffer.height=WORLD_H;
  minimapDirty=true;
}

const MMAP_COLORS={
  [T.AIR]:'#050a14',      [T.DEEP_WATER]:'#08355f',  [T.WATER]:'#1479c4',
  [T.SAND]:'#e6d3a3',     [T.GRASS]:'#5fb86b',        [T.FOREST]:'#256d31',
  [T.ROCK]:'#7c8491',     [T.SNOW]:'#dde8ef',          [T.ICE]:'#a8d8ea',
  [T.DESERT]:'#d4874f',   [T.LAVA]:'#e25822',          [T.MUSHROOM]:'#9b59b6',
  [T.DIRT]:'#8B4513',     [T.STONE]:'#555e66',         [T.IRON]:'#8a7560',
  [T.CRYSTAL]:'#5f4fa0',  [T.OBSIDIAN]:'#1a1a2e',
  [T.BUILT_BLOCK]:'#38bdf8', [T.CAVE_WALL]:'#3d3d3d',  [T.CAVE_FLOOR]:'#2a2a2a',
  [T.SWAMP]:'#3a5a2a',    [T.TOXIC]:'#4a8a20',         [T.VOLCANIC_ASH]:'#5a4a3a',
  [T.CORAL]:'#ff7f50',    [T.TUNDRA]:'#9aab8a',        [T.SAVANNA]:'#c8a84b',
  [T.REINFORCED]:'#94a3b8',[T.TRAP_SLOW]:'#38bdf8',   [T.TRAP_DAMAGE]:'#ef4444',
  [T.SPIKE_BLOCK]:'#f97316',
  [T.VOID_FLOOR]:'#1a0a2e',[T.VOID_WALL]:'#0a0514',   [T.PORTAL]:'#a855f7',
  [T.MAGMA_ROCK]:'#7f1d1d',[T.CRYSTAL_FLOOR]:'#3b1fa0',[T.GHOST_GRASS]:'#2d1a4a',
  [T.RUNE_STONE]:'#4c1d95',
};

// Cache de cores do minimap parseadas para evitar parseInt a cada buildMinimap
const _mmColorCache = {};
function parseMmColor(col){
  if(_mmColorCache[col]) return _mmColorCache[col];
  let c = col.replace('#','');
  if(c.length===3) c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  const n=parseInt(c,16)||0;
  return (_mmColorCache[col]=[(n>>16)&0xff,(n>>8)&0xff,n&0xff]);
}

function buildMinimap(){
  const bw=minimapBuffer.width, bh=minimapBuffer.height;
  const img=mbCtx.createImageData(bw,bh);
  const d=img.data;
  const wg=worldGrid();
  const sz=bw*bh;
  for(let i=0;i<sz;i++){
    const rgb=parseMmColor(MMAP_COLORS[wg[i]]||'#111');
    d[i*4]=rgb[0]; d[i*4+1]=rgb[1]; d[i*4+2]=rgb[2]; d[i*4+3]=255;
  }
  mbCtx.putImageData(img,0,0);
  minimapDirty=false;
}

function drawMinimap(){
  if(!mctx) return;
  // Só redesenha a cada 5s — no restante dos frames o canvas mantém a
  // última imagem (o navegador não limpa canvases sozinho entre draws).
  minimapUpdateTimer--;
  if(minimapUpdateTimer>0) return;
  minimapUpdateTimer=MINIMAP_UPDATE_INTERVAL;

  if(minimapDirty) buildMinimap();
  const mw=minimapCanvas.width,mh=minimapCanvas.height;
  mctx.drawImage(minimapBuffer,0,0,mw,mh);

  // Player dot
  const rx=robot.x/TILE/WORLD_W*mw,ry=robot.y/TILE/WORLD_H*mh;
  mctx.fillStyle='#fff';
  mctx.beginPath();mctx.arc(rx,ry,2.5,0,Math.PI*2);mctx.fill();

  // Enemy dots
  mctx.fillStyle='#ef4444';
  for(const e of enemies){
    if(e.dead)continue;
    const ex=e.x/TILE/WORLD_W*mw,ey=e.y/TILE/WORLD_H*mh;
    mctx.beginPath();mctx.arc(ex,ey,e.elite?2.5:1.5,0,Math.PI*2);mctx.fill();
  }

}

// ─── Tile Colors ─────────────────────────────────────────────
// PERF: tiles cuja cor NÃO depende de `gTime` (só de tx/ty) — podem ser
// cacheados com segurança, já que só mudam quando o próprio tile muda
// (o que já invalida a entrada via setTile()).
const STATIC_COLOR_TILES = new Set([
  T.SAND,T.GRASS,T.FOREST,T.ROCK,T.SNOW,T.ICE,T.DESERT,T.MUSHROOM,
  T.SWAMP,T.VOLCANIC_ASH,T.TUNDRA,T.SAVANNA,T.DIRT,T.STONE,T.IRON,
  T.OBSIDIAN,T.REINFORCED,T.SPIKE_BLOCK,T.CAVE_WALL,T.CAVE_FLOOR,
  T.VOID_WALL,T.CRYSTAL_FLOOR,T.GLASS_BLOCK,
]);

function getTileColor(t,tx,ty,gTime){
  if(STATIC_COLOR_TILES.has(t)){
    const cache=tileColorCacheBuffers[currentDim];
    const idx=wi(tx,ty);
    const cached=cache&&cache[idx];
    if(cached) return cached;
    const col=_computeTileColor(t,tx,ty,gTime);
    if(cache) cache[idx]=col;
    return col;
  }
  return _computeTileColor(t,tx,ty,gTime);
}

function _computeTileColor(t,tx,ty,gTime){
  const h=((tx*17239^ty*48271)>>>0)/0xFFFFFFFF;
  switch(t){
    case T.DEEP_WATER:{const w=(Math.sin(tx*0.5+gTime*.0018)+Math.cos(ty*0.4-gTime*.0013))*.5+.5;return `hsl(210,${75+w*10}%,${18+w*6}%)`;}
    case T.WATER:     {const w=(Math.sin(tx*0.5+gTime*.002)+Math.cos(ty*0.4-gTime*.0015))*.5+.5;return `hsl(208,${68+w*14}%,${35+w*10}%)`;}
    case T.LAVA:      {const l=(Math.sin(tx*0.8+gTime*.003)+1)*.5;return `hsl(${12+l*12},92%,${38+l*18}%)`;}
    case T.SAND:      return `hsl(42,${52+h*12}%,${73+h*8}%)`;
    case T.GRASS:     return `hsl(${125+h*18},${48+h*12}%,${38+h*10}%)`;
    case T.FOREST:    return `hsl(${130+h*22},${55+h*15}%,${22+h*10}%)`;
    case T.ROCK:      return `hsl(${210+h*20},${10+h*8}%,${44+h*12}%)`;
    case T.SNOW:      return `hsl(200,${18+h*10}%,${84+h*8}%)`;
    case T.ICE:       return `hsl(195,${52+h*18}%,${68+h*10}%)`;
    case T.DESERT:    return `hsl(${28+h*16},${58+h*12}%,${52+h*10}%)`;
    case T.MUSHROOM:  return `hsl(${270+Math.sin(tx*.5+ty*.3)*25+h*20},${48+h*10}%,${36+h*10}%)`;
    case T.SWAMP:     return `hsl(${100+h*20},${30+h*18}%,${20+h*10}%)`;
    case T.TOXIC:     {const tv=(Math.sin(tx*0.6+gTime*.0025)+1)*.5;return `hsl(${100+tv*30},${70+h*15}%,${28+tv*15}%)`;}
    case T.VOLCANIC_ASH:return `hsl(${20+h*15},${18+h*10}%,${28+h*12}%)`;
    case T.CORAL:     {const cv=(Math.sin(tx*0.7+gTime*.002)+1)*.5;return `hsl(${10+cv*30+h*40},${75+h*10}%,${48+cv*10}%)`;}
    case T.TUNDRA:    return `hsl(${100+h*20},${16+h*10}%,${50+h*12}%)`;
    case T.SAVANNA:   return `hsl(${40+h*18},${45+h*12}%,${50+h*12}%)`;
    case T.DIRT:      return `hsl(${25+h*10},${50+h*12}%,${28+h*8}%)`;
    case T.STONE:     return `hsl(${210+h*15},${12+h*6}%,${32+h*10}%)`;
    case T.IRON:      return `hsl(${30+h*10},${22+h*8}%,${40+h*10}%)`;
    case T.CRYSTAL:   return `hsl(${255+Math.sin(tx*.3+gTime*.001)*25+h*20},${58+h*12}%,${42+Math.sin(gTime*.002+tx)*12}%)`;
    case T.OBSIDIAN:  return `hsl(${250+h*10},${18+h*8}%,${8+h*6}%)`;
    case T.BUILT_BLOCK:{const bp=(Math.sin(tx*.4+ty*.4+gTime*.003)+1)*.5;return `hsl(195,${70+bp*20}%,${42+bp*10}%)`;}
    case T.REINFORCED: return `hsl(${215+h*10},${20+h*8}%,${55+h*10}%)`;
    case T.TRAP_SLOW:  {const tsa=(Math.sin(tx*.5+gTime*.004)+1)*.5;return `hsl(${185+tsa*20},${80+h*10}%,${38+tsa*14}%)`;}
    case T.TRAP_DAMAGE:{const tda=(Math.sin(tx*.6+gTime*.005)+1)*.5;return `hsl(${0+tda*15},${85+h*8}%,${35+tda*14}%)`;}
    case T.SPIKE_BLOCK:return `hsl(${20+h*15},${65+h*10}%,${32+h*12}%)`;
    case T.CAVE_WALL:  return `hsl(${210+h*10},${5+h*5}%,${20+h*8}%)`;
    case T.CAVE_FLOOR: return `hsl(${210+h*10},${4+h*4}%,${14+h*6}%)`;
    // Void tiles
    case T.VOID_FLOOR: {const vf=(Math.sin(tx*0.3+gTime*.002)+Math.cos(ty*0.3-gTime*.0018))*.5+.5;return `hsl(${260+vf*30},${60+h*15}%,${8+vf*8}%)`;}
    case T.VOID_WALL:  return `hsl(${250+h*10},${20+h*8}%,${5+h*4}%)`;
    case T.GHOST_GRASS:{const gg=(Math.sin(tx*.4+gTime*.003)+1)*.5;return `hsl(${270+gg*25+h*20},${40+h*12}%,${18+gg*10}%)`;}
    case T.CRYSTAL_FLOOR:return `hsl(${240+h*30},${55+h*15}%,${18+h*8}%)`;
    case T.RUNE_STONE: {const rs=(Math.sin(tx*.5+gTime*.004)+1)*.5;return `hsl(${290+rs*30},${70+h*10}%,${20+rs*12}%)`;}
    case T.PORTAL:     {const pp=(Math.sin(tx*.8+gTime*.008+ty*.5)+1)*.5;return `hsl(${280+pp*60},${85}%,${35+pp*20}%)`;}
    case T.MAGMA_ROCK: {const mr=(Math.sin(tx*0.6+gTime*.004)+1)*.5;return `hsl(${10+mr*15},${80+h*10}%,${20+mr*15}%)`;}
    case T.GLASS_BLOCK: return `hsl(195,${60+h*20}%,${70+h*15}%)`;
    case T.COPPER_BLOCK:{const cb=(Math.sin(tx*.4+ty*.4+gTime*.003)+1)*.5;return `hsl(${28+cb*10},${70+h*15}%,${42+cb*10}%)`;}
    case T.CRYSTAL_WALL:{const cw=(Math.sin(tx*.3+gTime*.002)+1)*.5;return `hsl(${250+cw*40+h*20},${65+h*12}%,${38+cw*12}%)`;}
    default: return '#061a2c';
  }
}

// ─── Tile Details ─────────────────────────────────────────────
function drawTileDetail(ctx,t,sx,sy,tx,ty){
  const TSIZE=TILE; // usar TSIZE para evitar conflito com parâmetro 'TSIZE' em outras funções
  if(t===T.FOREST){
    ctx.fillStyle='rgba(0,30,0,0.35)';
    const h=((tx*92837111)^(ty*689287497))>>>0;
    if((h&7)===0){ctx.beginPath();ctx.arc(sx+8+(h%16),sy+9+((h>>4)%14),3+(h%3),0,Math.PI*2);ctx.fill();}
    // Árvores maiores ocasionais
    if((h&15)===0){ctx.fillStyle='rgba(0,60,0,0.5)';ctx.beginPath();ctx.arc(sx+16,sy+16,5,0,Math.PI*2);ctx.fill();}
  } else if(t===T.ROCK||t===T.STONE){
    ctx.strokeStyle='rgba(0,0,0,0.18)';ctx.lineWidth=1;
    ctx.strokeRect(sx+4,sy+4,TSIZE-8,TSIZE-8);
  } else if(t===T.CRYSTAL){
    ctx.fillStyle='rgba(255,255,255,0.28)';
    ctx.beginPath();ctx.moveTo(sx+TSIZE/2,sy+4);ctx.lineTo(sx+TSIZE-4,sy+TSIZE-4);ctx.lineTo(sx+4,sy+TSIZE-4);ctx.closePath();ctx.fill();
  } else if(t===T.MUSHROOM){
    ctx.fillStyle='rgba(200,120,240,0.4)';
    const hm=((tx*1234)^(ty*5678))>>>0;
    if((hm&3)===0){ctx.beginPath();ctx.arc(sx+(hm%TSIZE),sy+((hm>>4)%TSIZE),4,0,Math.PI*2);ctx.fill();}
  } else if(t===T.LAVA){
    ctx.fillStyle='rgba(255,220,0,0.28)';
    const hl=((tx*777)^(ty*333))>>>0;
    if((hl&5)===0){ctx.beginPath();ctx.arc(sx+(hl%TSIZE),sy+((hl>>4)%TSIZE),3,0,Math.PI*2);ctx.fill();}
  } else if(t===T.BUILT_BLOCK){
    ctx.strokeStyle='rgba(0,230,255,0.55)';ctx.lineWidth=1.5;
    ctx.strokeRect(sx+2,sy+2,TSIZE-4,TSIZE-4);
    ctx.strokeStyle='rgba(0,230,255,0.12)';ctx.lineWidth=0.5;
    ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sx+TSIZE,sy+TSIZE);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx+TSIZE,sy);ctx.lineTo(sx,sy+TSIZE);ctx.stroke();
  } else if(t===T.REINFORCED){
    ctx.strokeStyle='rgba(200,220,255,0.45)';ctx.lineWidth=1.5;
    ctx.strokeRect(sx+2,sy+2,TSIZE-4,TSIZE-4);
    ctx.beginPath();ctx.moveTo(sx+2,sy+2);ctx.lineTo(sx+TSIZE-2,sy+TSIZE-2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx+TSIZE-2,sy+2);ctx.lineTo(sx+2,sy+TSIZE-2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx+TSIZE/2,sy+2);ctx.lineTo(sx+TSIZE/2,sy+TSIZE-2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx+2,sy+TSIZE/2);ctx.lineTo(sx+TSIZE-2,sy+TSIZE/2);ctx.stroke();
    const idx=wi(tx,ty);
    const pct=integrity()[idx]/400;
    ctx.fillStyle=`rgba(148,163,184,${0.3*pct})`;
    ctx.fillRect(sx+2,sy+2,(TSIZE-4)*pct,4);
  } else if(t===T.TRAP_SLOW){
    const ph=(tx*33+ty*77)*0.1+time*0.04;
    ctx.strokeStyle=`rgba(56,189,248,0.70)`;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(sx+TSIZE/2,sy+TSIZE/2,TSIZE*0.35,ph,ph+Math.PI*1.5);ctx.stroke();
    ctx.strokeStyle='rgba(125,211,252,0.4)';ctx.lineWidth=0.8;
    ctx.beginPath();ctx.arc(sx+TSIZE/2,sy+TSIZE/2,TSIZE*0.18,ph+Math.PI,ph+Math.PI*2.5);ctx.stroke();
  } else if(t===T.TRAP_DAMAGE){
    ctx.strokeStyle='rgba(239,68,68,0.75)';ctx.lineWidth=1.5;
    const cx=sx+TSIZE/2,cy=sy+TSIZE/2;
    ctx.beginPath();ctx.moveTo(cx-8,cy-8);ctx.lineTo(cx+2,cy-2);ctx.lineTo(cx-4,cy+4);ctx.lineTo(cx+8,cy+8);ctx.stroke();
    ctx.fillStyle='rgba(239,68,68,0.35)';
    ctx.beginPath();ctx.arc(cx,cy,4,0,Math.PI*2);ctx.fill();
  } else if(t===T.SPIKE_BLOCK){
    ctx.fillStyle='rgba(250,150,50,0.80)';
    const sc=4;
    for(let si=0;si<4;si++){
      const ox=sx+4+si*(TSIZE-8)/3;
      ctx.beginPath();ctx.moveTo(ox,sy+TSIZE-4);ctx.lineTo(ox+sc/2,sy+4);ctx.lineTo(ox+sc,sy+TSIZE-4);ctx.closePath();ctx.fill();
    }
  } else if(t===T.SNOW||t===T.ICE){
    ctx.fillStyle='rgba(255,255,255,0.22)';
    const hs=((tx*88888)^(ty*11111))>>>0;
    if((hs&7)===0) ctx.fillRect(sx+(hs%TSIZE),sy+((hs>>4)%TSIZE),2,2);
  } else if(t===T.SWAMP){
    ctx.fillStyle='rgba(0,80,0,0.28)';
    const hsw=((tx*23456)^(ty*65432))>>>0;
    if((hsw&5)===0){ctx.beginPath();ctx.ellipse(sx+(hsw%TSIZE),sy+((hsw>>4)%TSIZE),5,2.5,0,0,Math.PI*2);ctx.fill();}
  } else if(t===T.TOXIC){
    ctx.fillStyle='rgba(120,255,60,0.22)';
    const htx2=((tx*34567)^(ty*76543))>>>0;
    if((htx2&3)===0){ctx.beginPath();ctx.arc(sx+(htx2%TSIZE),sy+((htx2>>4)%TSIZE),3,0,Math.PI*2);ctx.fill();}
  } else if(t===T.VOLCANIC_ASH){
    ctx.fillStyle='rgba(100,60,20,0.30)';
    const hva=((tx*45678)^(ty*87654))>>>0;
    if((hva&7)===0) ctx.fillRect(sx+(hva%TSIZE),sy+((hva>>4)%TSIZE),3,3);
  } else if(t===T.CORAL){
    ctx.strokeStyle='rgba(255,150,80,0.50)';ctx.lineWidth=1.5;
    const hco=((tx*56789)^(ty*98765))>>>0;
    if((hco&3)===0){ctx.beginPath();ctx.moveTo(sx+(hco%TSIZE),sy+TSIZE);ctx.lineTo(sx+(hco%TSIZE)+(hco%5-2),sy+TSIZE/2);ctx.stroke();}
  } else if(t===T.IRON){
    ctx.fillStyle='rgba(200,160,80,0.28)';
    const hir=((tx*11223)^(ty*44556))>>>0;
    if((hir&7)===0) ctx.fillRect(sx+(hir%TSIZE),sy+((hir>>4)%TSIZE),4,4);
  }
  // Novos tiles Void/Underground
  else if(t===T.VOID_FLOOR){
    // Partículas flutuantes
    const hv=((tx*31337)^(ty*13337))>>>0;
    if((hv&7)===0){
      const ph2=time*0.003+hv;
      ctx.fillStyle=`rgba(168,139,250,${0.3+Math.sin(ph2)*0.15})`;
      ctx.beginPath();ctx.arc(sx+(hv%TSIZE),sy+((hv>>4)%TSIZE)+Math.sin(ph2)*3,2,0,Math.PI*2);ctx.fill();
    }
  } else if(t===T.GHOST_GRASS){
    ctx.fillStyle='rgba(130,80,220,0.28)';
    const hg=((tx*55555)^(ty*77777))>>>0;
    if((hg&3)===0){ctx.beginPath();ctx.arc(sx+(hg%TSIZE),sy+((hg>>4)%TSIZE),3,0,Math.PI*2);ctx.fill();}
  } else if(t===T.PORTAL){
    // Portal animado
    const pp=(Math.sin(tx*.8+time*.008+ty*.5)+1)*.5;
    const pcx=sx+TSIZE/2,pcy=sy+TSIZE/2;
    const g=ctx.createRadialGradient(pcx,pcy,0,pcx,pcy,TSIZE/2);
    g.addColorStop(0,`rgba(200,100,255,${0.5+pp*0.3})`);
    g.addColorStop(1,'rgba(80,0,160,0)');
    ctx.fillStyle=g;ctx.fillRect(sx,sy,TSIZE,TSIZE);
    // Spinning ring
    ctx.save();ctx.translate(pcx,pcy);ctx.rotate(time*0.04);
    ctx.strokeStyle=`rgba(200,100,255,${0.6+pp*0.3})`;ctx.lineWidth=2;
    ctx.setLineDash([4,3]);ctx.beginPath();ctx.arc(0,0,TSIZE*0.38,0,Math.PI*2);ctx.stroke();
    ctx.setLineDash([]);ctx.restore();
  } else if(t===T.RUNE_STONE){
    const rs=(Math.sin(tx*.5+time*.004)+1)*.5;
    ctx.strokeStyle=`rgba(200,100,255,${0.4+rs*0.4})`;ctx.lineWidth=1.5;
    const cx=sx+TSIZE/2,cy=sy+TSIZE/2;
    // Rune symbol (asterisk)
    for(let ri=0;ri<3;ri++){
      const ra=ri*Math.PI/3;
      ctx.beginPath();ctx.moveTo(cx+Math.cos(ra)*10,cy+Math.sin(ra)*10);
      ctx.lineTo(cx-Math.cos(ra)*10,cy-Math.sin(ra)*10);ctx.stroke();
    }
  } else if(t===T.MAGMA_ROCK){
    const mr=(Math.sin(tx*.6+time*.004)+1)*.5;
    ctx.fillStyle=`rgba(255,100,0,${0.2+mr*0.25})`;
    const hm2=((tx*22334)^(ty*55668))>>>0;
    if((hm2&5)===0){ctx.beginPath();ctx.arc(sx+(hm2%TSIZE),sy+((hm2>>4)%TSIZE),3,0,Math.PI*2);ctx.fill();}
  }

  // Rachadura de integridade — só para blocos com integridade definida
  const maxInt = BLOCK_INTEGRITY[t];
  if(maxInt && t!==T.AIR && t!==T.WATER && t!==T.DEEP_WATER && t!==T.PORTAL){
    const idx=wi(tx,ty);
    const curInt = integrity()[idx];
    if(curInt < maxInt){
      const frac=(maxInt-curInt)/maxInt;
      ctx.strokeStyle=`rgba(0,0,0,${0.4+frac*0.5})`;ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.moveTo(sx+4,sy+4);ctx.lineTo(sx+TSIZE-4-frac*8,sy+TSIZE-4-frac*8);
      ctx.moveTo(sx+TSIZE-4,sy+4);ctx.lineTo(sx+4+frac*8,sy+TSIZE-4-frac*8);
      ctx.stroke();
    }
  }
}

// ─── Draw World ───────────────────────────────────────────────
function drawWorld(){
  const ts=TILE;
  const left  =Math.floor((cam.x-W/2)/ts)-1;
  const right  =Math.ceil ((cam.x+W/2)/ts)+1;
  const top    =Math.floor((cam.y-H/2)/ts)-1;
  const bottom =Math.ceil ((cam.y+H/2)/ts)+1;

  ctx.fillStyle='#080e18';ctx.fillRect(0,0,W,H);

  const wg=worldGrid();
  for(let ty=top;ty<=bottom;ty++){
    for(let tx=left;tx<=right;tx++){
      if(!inBounds(tx,ty)) continue;
      const t=wg[wi(tx,ty)];
      if(t===T.AIR) continue;
      const sx=Math.round(tx*ts-cam.x+W/2);
      const sy=Math.round(ty*ts-cam.y+H/2);
      ctx.fillStyle=getTileColor(t,tx,ty,time);
      ctx.fillRect(sx,sy,ts,ts);
      if(QUALITY.tileDetail) drawTileDetail(ctx,t,sx,sy,tx,ty);
    }
  }

  // Build hover
  const bRange = getUpgradeValue('buildRange');
  if(running){
    const htx=Math.floor(mouseWorld.x/TILE),hty=Math.floor(mouseWorld.y/TILE);
    const dr=Math.hypot(mouseWorld.x-robot.x,mouseWorld.y-robot.y);
    if(dr<=bRange){
      const hsx=Math.round(htx*ts-cam.x+W/2),hsy=Math.round(hty*ts-cam.y+H/2);
      const htile=getTile(htx,hty);
      const htCanBuild=!SOLID.has(htile)&&htile!==T.AIR&&htile!==T.DEEP_WATER&&htile!==T.LAVA&&htile!==T.WATER&&htile!==T.PORTAL;
      if(currentTool==='build'&&htCanBuild){
        const bc=currentBuildType===T.TRAP_DAMAGE?'rgba(239,68,68,0.25)':
                 currentBuildType===T.TRAP_SLOW?'rgba(56,189,248,0.25)':
                 currentBuildType===T.SPIKE_BLOCK?'rgba(249,115,22,0.25)':
                 'rgba(0,230,255,0.18)';
        ctx.fillStyle=bc;ctx.fillRect(hsx,hsy,ts,ts);
        ctx.strokeStyle='rgba(0,230,255,0.65)';ctx.lineWidth=1.5;
        ctx.strokeRect(hsx,hsy,ts,ts);
      } else if(currentTool==='destroy'&&(DESTROYABLE.has(getTile(htx,hty))||getTile(htx,hty)===T.REINFORCED)){
        ctx.fillStyle='rgba(239,68,68,0.18)';ctx.fillRect(hsx,hsy,ts,ts);
        ctx.strokeStyle='rgba(239,68,68,0.65)';ctx.lineWidth=1.5;ctx.strokeRect(hsx,hsy,ts,ts);
      }
    }
    // Retículo de mira do Tiro Manual — só existe com a ferramenta selecionada
    if(manualFireMode && currentTool==='fire'){
      const fdr=Math.hypot(mouseWorld.x-robot.x,mouseWorld.y-robot.y);
      const inRange=fdr<=LASER_RANGE;
      const msx=mouseWorld.x-cam.x+W/2, msy=mouseWorld.y-cam.y+H/2;
      ctx.save();
      ctx.strokeStyle=inRange?(mouseDown?'rgba(239,68,68,0.9)':'rgba(0,230,255,0.75)'):'rgba(150,150,150,0.4)';
      ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(msx,msy,10,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(msx-16,msy);ctx.lineTo(msx-5,msy);ctx.moveTo(msx+5,msy);ctx.lineTo(msx+16,msy);
      ctx.moveTo(msx,msy-16);ctx.lineTo(msx,msy-5);ctx.moveTo(msx,msy+5);ctx.lineTo(msx,msy+16);
      ctx.stroke();
      ctx.restore();
    }
    const rx=robot.x-cam.x+W/2,ry=robot.y-cam.y+H/2;
    ctx.save();
    ctx.strokeStyle='rgba(0,230,255,0.10)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.arc(rx,ry,bRange,0,Math.PI*2);ctx.stroke();
    ctx.setLineDash([]);ctx.restore();
  }
}

// ─── Draw Lasers / Projectiles ────────────────────────────────
// (a linha de mira manual foi removida — o combate agora é automático;
// os disparos em si continuam visíveis via o loop de projéteis abaixo)
function drawLasers(){
  for(const p of projectiles){
    const sx=p.x-cam.x+W/2,sy=p.y-cam.y+H/2;
    ctx.save();
    let col=p.col||(p.isEnemy?'#fca5a5':'#7dd3fc');
    ctx.shadowColor=col;ctx.shadowBlur=Q(p.type==='plasma'?18:p.type==='railgun'?24:10);
    ctx.strokeStyle=col;ctx.lineWidth=p.type==='rocket'?4:p.type==='plasma'?4:p.type==='railgun'?3:2.5;
    ctx.beginPath();
    if(p.trail.length>1){
      ctx.moveTo(p.trail[0].x-cam.x+W/2,p.trail[0].y-cam.y+H/2);
      for(const pt of p.trail) ctx.lineTo(pt.x-cam.x+W/2,pt.y-cam.y+H/2);
    }
    ctx.lineTo(sx,sy);ctx.stroke();
    ctx.fillStyle=p.isEnemy?'#ef4444':'#fff';
    ctx.beginPath();ctx.arc(sx,sy,p.size||3,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
}

// ─── Draw Particles ───────────────────────────────────────────
function drawParticles(){
  ctx.save();
  for(const p of particles){
    const sx=p.x-cam.x+W/2,sy=p.y-cam.y+H/2;
    // Culling de partículas fora da tela
    if(sx < -p.size*4 || sx > W+p.size*4 || sy < -p.size*4 || sy > H+p.size*4) continue;
    if(p.isXP){
      // Orbs XP: pulsam, não somem (alpha fixo + pulso por xpAge)
      const pulse=0.7+0.3*Math.sin((p.xpAge||0)*0.18);
      ctx.globalAlpha=pulse;
      ctx.shadowColor='#facc15';ctx.shadowBlur=Q(10);
      ctx.fillStyle='#facc15';
      ctx.beginPath();ctx.arc(sx,sy,p.size*pulse,0,Math.PI*2);ctx.fill();
      // Brilho interno branco
      ctx.globalAlpha=pulse*0.5;
      ctx.fillStyle='#fff';
      ctx.beginPath();ctx.arc(sx,sy,p.size*0.4,0,Math.PI*2);ctx.fill();
      ctx.shadowBlur=0;
    } else {
      const a=p.life/p.max;
      ctx.globalAlpha=a*0.9;
      ctx.fillStyle=p.col;
      ctx.beginPath();ctx.arc(sx,sy,p.size*(0.5+a*0.5),0,Math.PI*2);ctx.fill();
    }
  }
  ctx.restore(); // restaura globalAlpha=1 e outros estados
}

// ─── Draw Enemies ─────────────────────────────────────────────
function drawEnemies(){
  for(const e of enemies){
    if(e.dead) continue;
    const sx=e.x-cam.x+W/2,sy=e.y-cam.y+H/2;
    // Culling: não desenhar inimigos completamente fora da tela
    if(sx < -e.size*3 || sx > W+e.size*3 || sy < -e.size*3 || sy > H+e.size*3) continue;
    ctx.save();ctx.translate(sx,sy);
    const col=e.flashTimer>0?'#fff':e.col;

    // Elite glow
    if(e.elite){
      ctx.shadowColor=col;ctx.shadowBlur=Q(20);
    }

    ctx.globalAlpha=0.2;ctx.fillStyle='#000';
    ctx.beginPath();ctx.ellipse(0,e.size+2,e.size*.9,e.size*.4,0,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1;ctx.shadowBlur=0;

    if(e.slowTimer>0){
      ctx.globalAlpha=0.4;ctx.fillStyle='#38bdf8';
      ctx.beginPath();ctx.arc(0,0,e.size+5,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=1;
    }

    ctx.rotate(e.angle);
    if(e.boss){
      ctx.rotate(-e.angle);
      const spikes=10;
      const pulse=1+Math.sin(time*0.08)*0.06;
      ctx.fillStyle=col;
      ctx.beginPath();
      for(let si=0;si<spikes*2;si++){
        const a=(Math.PI/spikes)*si + time*0.01;
        const rad = si%2===0 ? e.size*pulse : e.size*0.6*pulse;
        const px=Math.cos(a)*rad, py=Math.sin(a)*rad;
        if(si===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.stroke();
      ctx.fillStyle='rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.arc(0,0,e.size*0.42,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=col; ctx.lineWidth=2; ctx.stroke();
    } else if(e.type==='TANK'){
      const sz=e.size;
      ctx.fillStyle=col;
      ctx.fillRect(-sz,-sz,sz*2,sz*2);
      ctx.strokeStyle='rgba(0,0,0,0.5)';ctx.lineWidth=2;
      ctx.strokeRect(-sz,-sz,sz*2,sz*2);
      ctx.fillStyle='#7f1d1d';
      ctx.fillRect(0,-3,sz+4,6);
    } else if(e.type==='TURRET'){
      ctx.rotate(-e.angle);
      ctx.fillStyle=col;
      ctx.beginPath();ctx.arc(0,0,e.size,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,0.5)';ctx.lineWidth=2;ctx.stroke();
      ctx.rotate(e.angle);
      ctx.fillStyle='#7f1d1d';ctx.fillRect(0,-2.5,e.size+5,5);
    } else if(e.type==='SPECTER'){
      ctx.rotate(-e.angle);
      ctx.globalAlpha=0.72+Math.sin(time*.05)*.2;
      ctx.fillStyle=col;
      ctx.beginPath();ctx.moveTo(0,-e.size*1.2);ctx.lineTo(e.size,0);
      ctx.lineTo(0,e.size*1.2);ctx.lineTo(-e.size,0);
      ctx.closePath();ctx.fill();
      ctx.shadowColor=col;ctx.shadowBlur=Q(16);
      ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.stroke();
      ctx.shadowBlur=0;ctx.globalAlpha=1;
    } else if(e.type==='BOMBER'){
      ctx.rotate(-e.angle);
      ctx.fillStyle=col;
      ctx.beginPath();ctx.arc(0,0,e.size,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#fbbf24';ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle='#000';ctx.beginPath();ctx.arc(0,0,e.size*0.45,0,Math.PI*2);ctx.fill();
    } else if(e.type==='SWARM'){
      ctx.rotate(-e.angle);
      ctx.globalAlpha=0.85;ctx.fillStyle=col;
      ctx.beginPath();ctx.arc(0,0,e.size,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.3)';ctx.lineWidth=1;ctx.stroke();
      ctx.globalAlpha=1;
    } else if(e.type==='ELITE'){
      ctx.rotate(-e.angle);
      // Elite: hexagonal
      ctx.fillStyle=col;
      ctx.beginPath();
      for(let si=0;si<6;si++){
        const a=si*Math.PI/3+time*0.02;
        if(si===0)ctx.moveTo(Math.cos(a)*e.size,Math.sin(a)*e.size);
        else ctx.lineTo(Math.cos(a)*e.size,Math.sin(a)*e.size);
      }
      ctx.closePath();ctx.fill();
      ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
      // Centro
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,0,e.size*0.3,0,Math.PI*2);ctx.fill();
    } else if(e.type==='NECRO'){
      ctx.rotate(-e.angle);
      ctx.fillStyle=col;
      ctx.beginPath();ctx.arc(0,0,e.size,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#7c3aed';ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle='#6d28d9';
      // Skull symbol
      ctx.font=`${e.size}px sans-serif`;ctx.textAlign='center';ctx.fillText('💀',0,e.size*0.35);
    } else {
      ctx.fillStyle=col;
      ctx.beginPath();ctx.arc(0,0,e.size,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,0.4)';ctx.lineWidth=1.5;ctx.stroke();
      ctx.rotate(-e.angle);
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(e.size*.4,0,3,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#000';ctx.beginPath();ctx.arc(e.size*.5,0,1.5,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();

    // HP bar
    const hpF=e.hp/e.maxHp,bw=e.size*2.2+(e.elite?8:0),bh=e.elite?6:4;
    ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(sx-bw/2,sy-e.size-10,bw,bh);
    ctx.fillStyle=hpF>0.5?'#22c55e':hpF>0.25?'#fb923c':'#ef4444';
    ctx.fillRect(sx-bw/2,sy-e.size-10,bw*hpF,bh);
    if(e.elite){
      ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=1;
      ctx.strokeRect(sx-bw/2,sy-e.size-10,bw,bh);
    }
  }
}

// ─── Draw Robot ───────────────────────────────────────────────
function drawRobot(){
  const rx=robot.x-cam.x+W/2,ry=robot.y-cam.y+H/2;
  const spd=Math.hypot(robot.vx,robot.vy);
  const thrust=Math.min(spd/5,1);

  ctx.save();ctx.translate(rx,ry);

  ctx.globalAlpha=0.18;ctx.fillStyle='#000';
  ctx.beginPath();ctx.ellipse(0,robot.radius+4,robot.radius*1.1,robot.radius*.4,0,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=1;

  if(thrust>0.05){
    ctx.globalAlpha=0.5*thrust;
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2+Math.PI/4+robot.angle+Math.PI;
      const px=Math.cos(a)*14,py=Math.sin(a)*14;
      const g=ctx.createRadialGradient(px,py,0,px,py,10);
      g.addColorStop(0,'#7dd3fc');g.addColorStop(1,'rgba(125,211,252,0)');
      ctx.fillStyle=g;
      ctx.beginPath();ctx.arc(px,py,10*thrust,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
  }

  if(robot.invTimer>0&&(robot.invTimer%6<3)){
    ctx.restore(); // restaura o save() do início da função
    // Desenhar level badge mesmo durante piscar
    ctx.save();
    ctx.fillStyle='#facc15';ctx.font="bold 9px 'Orbitron',sans-serif";ctx.textAlign='center';
    ctx.fillText(`Lv.${evolution.level}`,rx,ry-robot.radius-12);
    ctx.restore();
    return;
  }

  ctx.rotate(time*.004);
  ctx.strokeStyle='rgba(56,189,248,0.55)';
  ctx.lineWidth=2.5;
  ctx.beginPath();ctx.arc(0,0,robot.radius+6,0,Math.PI*2);ctx.stroke();
  ctx.rotate(-time*.004);

  ctx.rotate(robot.angle);
  if(spriteReady(SPRITES.player)){
    ctx.shadowColor='#5ee9ff'; ctx.shadowBlur=Q(10);
    const d=robot.radius*2.25; // sprite ligeiramente maior que o raio de colisão
    ctx.drawImage(SPRITES.player,-d/2,-d/2,d,d);
    ctx.shadowBlur=0;
  } else {
    // Fallback vetorial enquanto o sprite carrega
    const bg=ctx.createRadialGradient(-4,-5,2,0,0,robot.radius);
    bg.addColorStop(0,'#eef7ff');bg.addColorStop(0.5,'#93b1c9');bg.addColorStop(1,'#4a5d70');
    ctx.fillStyle=bg;
    ctx.beginPath();ctx.arc(0,0,robot.radius,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#1e2e3e';ctx.lineWidth=2;ctx.stroke();
  }
  ctx.rotate(-robot.angle);

  // Weapon color indicator
  const wColors={LASER:'#ef4444',SHOTGUN:'#f97316',PLASMA:'#38bdf8',ROCKET:'#f59e0b',GRENADE:'#22c55e',RAILGUN:'#00ffff',CHAIN:'#a78bfa'};
  ctx.fillStyle=wColors[currentWeapon]||'#fff';
  ctx.beginPath();ctx.arc(-6,robot.radius-2,3,0,Math.PI*2);ctx.fill();

  ctx.strokeStyle='#94a3b8';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(0,-robot.radius);ctx.lineTo(-2,-robot.radius-6);ctx.stroke();
  ctx.fillStyle=robot.energy<20?'#ef4444':robot.energy<50?'#fb923c':'#22c55e';
  ctx.beginPath();ctx.arc(-2,-robot.radius-6,2,0,Math.PI*2);ctx.fill();

  ctx.restore();

  // Level badge no player
  ctx.save();
  ctx.fillStyle='#facc15';ctx.font="bold 9px 'Orbitron',sans-serif";ctx.textAlign='center';
  ctx.fillText(`Lv.${evolution.level}`,rx,ry-robot.radius-12);
  ctx.restore();
}

// ─── Draw Canvas HUD elements (Weapon bar, XP bar) ───────────
function drawWeaponHUD(){
  if(!running) return;
  const weapons=Object.keys(WEAPONS);
  const wY=H-36-(isMobileUI()?MOBILE_HUD_LIFT:0), wStartX=14;
  const wW=52, wH=28, gap=3;
  ctx.save();
  weapons.forEach((w,i)=>{
    const wd=WEAPONS[w];
    const owned=ownedWeapons.has(w);
    const off=owned && disabledItems.has(w);
    const wx=wStartX+i*(wW+gap);
    ctx.fillStyle=!owned?'rgba(6,16,30,0.4)':off?'rgba(90,100,120,0.35)':'rgba(0,180,210,0.55)';
    ctx.strokeStyle=!owned?'rgba(255,255,255,0.05)':off?'rgba(150,160,180,0.35)':'#00e5ff';
    ctx.lineWidth=owned?2:1;
    roundRect(ctx,wx,wY,wW,wH,5);
    ctx.fill();ctx.stroke();
    ctx.fillStyle=!owned?'rgba(150,150,150,0.3)':'#fff';
    ctx.font=`${owned?12:10}px 'Orbitron',sans-serif`;
    ctx.textAlign='center';
    ctx.fillText(wd.icon,wx+wW/2,wY+11);
    ctx.font='8px Share Tech Mono,monospace';
    ctx.fillStyle=!owned?'rgba(250,204,21,0.55)':'#a0f0ff';
    ctx.fillText(!owned?`💰${wd.cost}`:off?'OFF':wd.name.slice(0,5),wx+wW/2,wY+22);
  });

  // XP Bar (acima das armas)
  const xpBarW=200, xpBarH=8, xpBarX=14, xpBarY=wY-16;
  const xpPct=evolution.xp/evolution.xpToNext;
  ctx.fillStyle='rgba(0,0,0,0.4)';
  roundRect(ctx,xpBarX,xpBarY,xpBarW,xpBarH,4);ctx.fill();
  const xpGrad=ctx.createLinearGradient(xpBarX,0,xpBarX+xpBarW*xpPct,0);
  xpGrad.addColorStop(0,'#facc15');xpGrad.addColorStop(1,'#f97316');
  ctx.fillStyle=xpGrad;
  roundRect(ctx,xpBarX,xpBarY,xpBarW*xpPct,xpBarH,4);ctx.fill();
  ctx.fillStyle='rgba(250,204,21,0.8)';ctx.font="9px 'Share Tech Mono',monospace";ctx.textAlign='left';
  ctx.fillText(`XP Lv.${evolution.level} [U=upgrades${evolution.points>0?' ⬆'+evolution.points:''}] [L=loja] [I=inventário] [Q=tiro on/off]`,xpBarX,xpBarY-3);

  // Build type indicator
  if(currentTool==='build'){
    const buildLocked = typeof isBlockDiscovered==='function' && !isBlockDiscovered(currentBuildType);
    ctx.fillStyle='rgba(6,16,30,0.75)';
    ctx.strokeStyle= buildLocked ? 'rgba(239,68,68,0.5)' : 'rgba(0,230,255,0.3)';
    ctx.lineWidth=1;
    roundRect(ctx,14,wY-52,130,24,5);ctx.fill();ctx.stroke();
    ctx.fillStyle= buildLocked ? '#ef4444' : '#38bdf8';
    ctx.font='10px Orbitron,sans-serif';ctx.textAlign='left';
    ctx.fillText((buildLocked?'🔒':'🧱')+' '+BUILD_NAMES[currentBuildType],20,wY-36);
  }

  ctx.restore();
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}

// ─── Enemy Off-screen Arrows ──────────────────────────────────
function drawEnemyArrows(){
  if(!running) return;
  const margin=36;       // distância do centro da seta à borda da tela
  const arrowLen=12;     // comprimento da ponta da seta
  const arrowW=6;        // meia-largura da ponta
  const cx=W/2, cy=H/2;  // centro da tela em screen coords

  ctx.save();
  for(const e of enemies){
    if(e.dead) continue;
    const sx=e.x-cam.x+cx, sy=e.y-cam.y+cy;
    // Só desenhar seta se o inimigo está FORA da tela
    if(sx>-e.size&&sx<W+e.size&&sy>-e.size&&sy<H+e.size) continue;

    const dx=e.x-cam.x, dy=e.y-cam.y; // vetor do centro da câmera até o inimigo
    const angle=Math.atan2(dy,dx);

    // Ponto na borda da tela na direção do inimigo
    // Interseção com o retângulo (W x H) centrado na tela
    const halfW=W/2-margin, halfH=H/2-margin;
    const cos=Math.cos(angle), sin=Math.sin(angle);
    let bx, by;
    // Clamp ao retângulo mais próximo
    if(Math.abs(cos)<1e-6){
      bx=cx; by=cy+Math.sign(sin)*halfH;
    } else if(Math.abs(sin)<1e-6){
      bx=cx+Math.sign(cos)*halfW; by=cy;
    } else {
      const tx2=Math.sign(cos)*halfW, ty2=Math.sign(sin)*halfH;
      if(Math.abs(ty2/tx2)>Math.abs(sin/cos)){
        bx=cx+tx2; by=cy+tx2*sin/cos;
      } else {
        bx=cx+ty2*cos/sin; by=cy+ty2;
      }
    }

    const isElite=e.elite;
    const arrowCol=isElite?'#fbbf24':e.col;

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(angle);

    // Fundo escuro da seta
    ctx.globalAlpha=0.55;
    ctx.fillStyle='rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.moveTo(arrowLen,0);
    ctx.lineTo(-arrowLen/2,arrowW);
    ctx.lineTo(-arrowLen/2,-arrowW);
    ctx.closePath();
    ctx.fill();

    // Seta colorida
    ctx.globalAlpha=isElite?0.95:0.82;
    ctx.fillStyle=arrowCol;
    if(isElite){ctx.shadowColor=arrowCol;ctx.shadowBlur=Q(10);}
    ctx.beginPath();
    ctx.moveTo(arrowLen,0);
    ctx.lineTo(-arrowLen/2,arrowW);
    ctx.lineTo(-arrowLen/2,-arrowW);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur=0;

    // Linha de haste
    ctx.globalAlpha=0.5;
    ctx.strokeStyle=arrowCol;
    ctx.lineWidth=isElite?2.5:1.5;
    ctx.beginPath();
    ctx.moveTo(-arrowLen/2,0);
    ctx.lineTo(-arrowLen,0);
    ctx.stroke();

    ctx.restore();
  }
  ctx.restore();
}

// ─── Teleport HUD indicator ───────────────────────────────────
function drawTeleportHUD(){
  if(!running) return;
  const owned=ownedAbilities.has('TELEPORT');
  ctx.save();
  const bx=14, by=H-68-(isMobileUI()?MOBILE_HUD_LIFT:0);
  const bw=80, bh=22;
  const ready=owned && teleportCooldown<=0;
  const pct=ready?1:1-(teleportCooldown/TELEPORT_COOLDOWN_FRAMES);

  // Fundo
  ctx.fillStyle='rgba(4,10,22,0.75)';
  roundRect(ctx,bx,by,bw,bh,5);ctx.fill();
  ctx.strokeStyle=ready?'rgba(56,189,248,0.7)':'rgba(100,100,150,0.4)';ctx.lineWidth=1;
  roundRect(ctx,bx,by,bw,bh,5);ctx.stroke();

  if(!owned){
    ctx.fillStyle='rgba(6,16,30,0.4)';
    roundRect(ctx,bx,by,bw,bh,5);ctx.fill();
    ctx.fillStyle='rgba(250,204,21,0.6)';
    ctx.font=`bold 9px 'Orbitron',sans-serif`;ctx.textAlign='center';
    ctx.fillText('🔒 TELEPORTE',bx+bw/2,by+9);
    ctx.font=`8px 'Share Tech Mono',monospace`;
    ctx.fillText(`💰 ${SHOP_ITEMS.find(i=>i.id==='TELEPORT').cost} [L]`,bx+bw/2,by+19);
    ctx.restore();
    return;
  }

  // Barra de recarga
  if(!ready){
    ctx.fillStyle='rgba(56,189,248,0.3)';
    roundRect(ctx,bx,by,bw*pct,bh,5);ctx.fill();
  } else {
    ctx.fillStyle='rgba(56,189,248,0.15)';
    roundRect(ctx,bx,by,bw,bh,5);ctx.fill();
  }

  // Texto
  ctx.fillStyle=ready?'#38bdf8':'rgba(150,160,200,0.7)';
  ctx.font=`bold 9px 'Orbitron',sans-serif`;ctx.textAlign='center';
  const tOff=disabledItems.has('TELEPORT');
  ctx.fillText(tOff?'TELEPORTE':ready?'[F] TELEPORTE':'TELEPORTE',bx+bw/2,by+9);
  ctx.font=`8px 'Share Tech Mono',monospace`;
  ctx.fillStyle=ready&&!tOff?'#7dd3fc':'rgba(130,140,180,0.6)';
  ctx.fillText(tOff?'desativado [I]':ready?'Gasta energia':'recarga...',bx+bw/2,by+19);

  ctx.restore();
}

// ─── Main Draw ────────────────────────────────────────────────
function draw(){
  drawWorld();
  drawLasers();
  drawEnemies();
  drawRobot();
  drawParticles();
  drawEnemyArrows();
  if(typeof drawDayNight==='function') drawDayNight();
  updateHUD();
  drawMinimap();
  drawWeaponHUD();
  drawTeleportHUD();
  drawUpgradePanel();
  drawShopPanel();
  if(typeof drawARIACorruption==='function') drawARIACorruption();
  if(typeof drawBossWarning==='function') drawBossWarning();
  drawBossHUD();

  // ── Borda da tela por estatística (degradê com opacidade) ──────
  // Helper fora do if para evitar hoisting issues em strict mode
  const screenEdge = (r,g,b,alpha)=>{
    if(alpha<=0.005) return;
    const cx=W/2, cy=H/2;
    const grad=ctx.createRadialGradient(cx,cy,Math.min(W,H)*0.28, cx,cy,Math.max(W,H)*0.82);
    grad.addColorStop(0,'rgba(0,0,0,0)');
    grad.addColorStop(1,`rgba(${r},${g},${b},${Math.min(1,alpha)})`);
    ctx.save(); ctx.globalAlpha=1; ctx.fillStyle=grad; ctx.fillRect(0,0,W,H); ctx.restore();
  };

  // Cada stat sobrepõe sua própria cor nas bordas. Múltiplas podem se acumular.
  // Ligado só em qualidade Alto/Muito Alto (QUALITY.screenEdgeFX) — em Médio
  // e abaixo o jogo se comporta exatamente como antes (bloco ficava desativado).
  if(QUALITY.screenEdgeFX && gameMode !== GAME_MODES.CREATIVE){
    const hpPct    = robot.hp    / robot.maxHp;
    const enPct    = robot.energy / robot.maxEnergy;
    const heatPct  = robot.heat  / robot.maxHeat;
    const wavePct  = autoWaveTimer / AUTO_WAVE_MAX; // 0→1 conforme pressão

    // 1. CALOR: vermelho-laranja >= 40% calor, intensifica até 100%
    if(heatPct >= 0.40){
      const t = (heatPct - 0.40) / 0.60; // 0 em 40%, 1 em 100%
      // Calor médio: laranja suave; calor crítico: vermelho intenso + scanlines
      const r = 239, g = Math.round(68 + (1-t)*100), b = 30;
      screenEdge(r, g, b, t * 0.55);
      // Scanlines adicionais quando muito quente
      if(heatPct > 0.70){
        ctx.save();
        ctx.globalAlpha = (heatPct-0.70) * 0.25;
        ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
        for(let y2=0; y2<H; y2+=4) ctx.fillRect(0,y2,W,1);
        ctx.restore();
      }
    }

    // 2. HP BAIXO: vermelho sangue pulsante < 35% HP
    if(hpPct < 0.35 && !robot.dead){
      const t = (0.35 - hpPct) / 0.35; // 0 em 35%, 1 em 0%
      // Pulso sincronizado com o "batimento" (sin do tempo)
      const pulse = 0.5 + 0.5*Math.sin(time * 0.08);
      screenEdge(180, 10, 10, t * 0.45 * (0.6 + 0.4*pulse));
    }

    // 3. ENERGIA BAIXA: azul escuro piscando < 20% energia
    if(enPct < 0.20){
      const t = (0.20 - enPct) / 0.20;
      const pulse = 0.5 + 0.5*Math.sin(time * 0.12);
      screenEdge(10, 50, 140, t * 0.38 * (0.5 + 0.5*pulse));
    }

    // 4. PRESSÃO DE ONDA (autoWaveTimer): amarelo-laranja crescente
    //    Aparece a partir de 50% do timer, fica intenso nos últimos 20%
    if(wavePct >= 0.50 && (enemies.length>0||spawnQueue.length>0)){
      const t = (wavePct - 0.50) / 0.50;
      const pulse = 0.5 + 0.5*Math.sin(time * 0.15);
      screenEdge(220, 150, 0, t * 0.40 * (0.7 + 0.3*pulse));
      // Nos últimos 10%: adiciona borda branca extra para urgência máxima
      if(wavePct >= 0.90){
        const u = (wavePct - 0.90) / 0.10;
        screenEdge(255, 255, 255, u * 0.20 * pulse);
      }
    }

    // 6. HUD de pressão de onda — barra fina no topo quando há inimigos
    if(wavePct > 0.30 && (enemies.length>0||spawnQueue.length>0)){
      const barW = W * wavePct;
      const barAlpha = (wavePct - 0.30) / 0.70;
      ctx.save();
      const barCol = wavePct>0.80 ? `rgba(255,80,0,${barAlpha*0.9})` :
                     wavePct>0.55 ? `rgba(220,150,0,${barAlpha*0.7})` :
                                    `rgba(200,200,0,${barAlpha*0.5})`;
      ctx.fillStyle = barCol;
      ctx.fillRect(0, 0, barW, 3);
      // Label de aviso nos últimos 25%
      if(wavePct >= 0.75){
        const secsLeft = Math.ceil((AUTO_WAVE_MAX - autoWaveTimer) / 60);
        ctx.font = `bold 9px 'Share Tech Mono',monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(255,200,0,${barAlpha})`;
        ctx.fillText(`⚠ PRÓXIMA ONDA EM ${secsLeft}s`, W/2, 14);
      }
      ctx.restore();
    }
  }

  // Tela de escolha de chips roguelike (fim de onda) — desenhada por cima de tudo
  if(typeof drawRogueChips==='function') drawRogueChips();

  // Indicadores discretos (pause / mira de teleporte / tiro off) — não cobrem a tela
  if(!(typeof ROGUE!=='undefined' && ROGUE.screenOpen)){
    drawPauseOverlay();
    drawTeleportTargeting();
    drawStatusPills();
  }

} // ← fechamento de draw()

// ─── Overlay de Pause ──────────────────────────────────────────
// Só o pause MANUAL (P / botão) escurece de leve a cena; os demais motivos
// (loja, evolução, inventário, escolha de chip, mira de teleporte) já têm a
// própria tela — antes, o "PAUSADO" gigante brilhava por cima delas.
function drawPauseOverlay(){
  if(!pauseReasons.has('manual')) return;
  ctx.save();
  ctx.fillStyle='rgba(3,8,16,0.10)';
  ctx.fillRect(0,0,W,H);
  ctx.restore();
}

// Pílulas pequenas empilhadas sob o placar de onda. Sem brilho, sem
// tela escurecida — só o suficiente pra saber o estado atual.
function drawStatusPills(){
  if(!running) return;
  const pills=[];
  if(pauseReasons.has('manual')){
    // respiração lenta (usa o relógio real: `time` do jogo congela no pause)
    const a=0.62+0.18*Math.sin(performance.now()/900);
    pills.push({txt:'⏸ PAUSADO', rgb:'200,232,255', a});
  }
  if(teleportTargeting) pills.push({txt:'🌀 TOQUE NO DESTINO · 🌀 CANCELA', rgb:'125,211,252', a:0.9});
  if(fireDisabled && gameMode!==GAME_MODES.CREATIVE) pills.push({txt:'🔫 TIRO DESATIVADO [Q]', rgb:'252,165,165', a:0.8});
  if(!pills.length) return;
  ctx.save();
  ctx.font=`10px 'Share Tech Mono',monospace`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  let y=(isMobileUI()?62:78);
  for(const p of pills){
    const w=ctx.measureText(p.txt).width+22, h=20;
    ctx.globalAlpha=p.a;
    ctx.fillStyle='rgba(4,10,22,0.6)';
    roundRect(ctx,W/2-w/2,y,w,h,10); ctx.fill();
    ctx.strokeStyle=`rgba(${p.rgb},0.35)`; ctx.lineWidth=1;
    roundRect(ctx,W/2-w/2,y,w,h,10); ctx.stroke();
    ctx.fillStyle=`rgb(${p.rgb})`;
    ctx.fillText(p.txt,W/2,y+h/2+1);
    y+=h+6;
  }
  ctx.restore();
}

// ─── Main Update ─────────────────────────────────────────────
function update(dt){
  time+=dt;
  if(typeof updateDayNight==='function') updateDayNight(dt);

  flowTimer--;
  if(flowTimer<=0){
    const ptx=Math.floor(robot.x/TILE);
    const pty=Math.floor(robot.y/TILE);
    if(inBounds(ptx,pty)) rebuildFlowField(ptx,pty);
    flowTimer=FLOW_UPDATE_INTERVAL;
  }

  updateRobot(dt);
  if(!upgradeOpen){
    updateAutoWeapons();
    if(mouseDown) tryBuildAction();
  }
  updateProjectiles();
  // Modo criativo: sem inimigos
  if(true){
    if(typeof updateEnemiesAI==='function') updateEnemiesAI();
    else updateEnemies();
    updateWaves();
  }
  updateParticles();
  if(typeof updateARIA==='function') updateARIA();
  if(typeof updateRogue==='function') updateRogue();
  if(typeof mpUpdate==='function') mpUpdate();
}

function loop(ts){
  if(!last) last=ts;
  const dt=Math.min(33,ts-last);last=ts;
  if(running){
    if(!isPaused()) update(dt);
    draw();
  }
  requestAnimationFrame(loop);
}

// ─── Start / End ─────────────────────────────────────────────
function startGame(seed, mode){
  if(mode) gameMode=mode;
  seedStr=seed||'nebulosa';
  generateWorld(seedStr);
  currentDim=DIM.SURFACE;
  // Atualizar aliases para dimensão inicial
  flowField  = flowFields[currentDim];
  dirField   = dirFields[currentDim];
  chunkDirty = chunkDirtyBuffers[currentDim];
  minimapDirty=true;
  minimapUpdateTimer=0;
  chunkDirty.fill(1);

  const startTX=Math.floor(WORLD_W/2);
  const startTY=Math.floor(WORLD_H/2);
  const sp=findClearSpawn(startTX,startTY,true);
  robot.x=(sp.tx+0.5)*TILE;
  robot.y=(sp.ty+0.5)*TILE;
  robot.vx=0;robot.vy=0;robot.angle=0;
  robot.hp=100;robot.energy=100;robot.heat=0;
  robot.dead=false;robot.prevBiome='';

  // Reset evolução
  evolution.xp=0;evolution.level=1;evolution.xpToNext=xpForLevel(2);
  evolution.totalXP=0;evolution.points=0;
  evolution.unlocked.clear();
  evolution.effectCounts={};evolution.resets=0;
  applyPassiveBonuses();

  cam.x=robot.x;cam.y=robot.y;
  particles.length=0;projectiles.length=0;enemies.length=0;spawnQueue.length=0;
  time=0;last=0;score=0;enemiesKilled=0;wave=0;waveTimer=300;waveSpawnLeft=0;autoWaveTimer=0;
  bossWarningTimer=0;bossWarningWave=0;
  activeBoss=null; _lastBossArchetypeIdx=-1;
  currentWeapon='LASER';currentTool='build';currentBuildType=T.BUILT_BLOCK;
  ownedWeapons=new Set(['LASER']);ownedAbilities=new Set();weaponCooldowns={};
  disabledItems=new Set();fireDisabled=false;
  buildCooldown=0;flowTimer=0;portalCooldown=0;teleportCooldown=0;upgradeOpen=false;weaponCooldowns={};
  pauseReasons.clear();
  teleportTargeting=false; teleportAim=null; inventoryOpen=false;
  if(inventoryScreen) inventoryScreen.classList.remove('show');
  if(typeof resetRogue==='function') resetRogue();

  rebuildFlowField(startTX,startTY);
  if(typeof resetARIA==='function') resetARIA();
  if(typeof resetScanner==='function') resetScanner();
  if(typeof resetDayNight==='function') resetDayNight();
  menuScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  if(endScreen) endScreen.classList.remove('show');
  // Atualizar hints do modo criativo no HUD
  _applyGameModeUI();
  running=true;
  // Inicia o loop de render caso ainda não tenha sido iniciado
  if(!loopStarted){ loopStarted=true; requestAnimationFrame(loop); }
}

function formatRunTime(frames){
  const secs=Math.floor(frames/60);
  const mm=Math.floor(secs/60), ss=String(secs%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

function endGame(){
  if(typeof mpNotifyGameEnd==='function') mpNotifyGameEnd(false);
  running=false;
  if(endScreen){
    endScreen.classList.remove('win');
    if(endTitle) endTitle.textContent='SINAL PERDIDO';
    if(endScore) endScore.textContent=
      `Tempo: ${formatRunTime(time)}  •  Onda: ${wave}  •  Nível: ${evolution.level}  •  Inimigos: ${enemiesKilled}  •  Pontuação: ${score}`;
    endScreen.classList.add('show');
  }
}

// ─── Game Mode UI ────────────────────────────────────────────────
function _applyGameModeUI(){
  const modeLabel = document.getElementById('hudModeLabel');
  if(modeLabel){
    modeLabel.textContent =
      gameMode===GAME_MODES.CREATIVE  ? '🎨 CRIATIVO' : '☠ SOBREVIVÊNCIA';
    modeLabel.style.color =
      gameMode===GAME_MODES.CREATIVE  ? '#4ade80' : '#ef4444';
  }
  // Modo criativo: energia sempre cheia no HUD
  if(gameMode===GAME_MODES.CREATIVE){
    robot.hp=robot.maxHp; robot.energy=robot.maxEnergy; robot.heat=0; evolution.points=evolution.points+280; evolution.level=evolution.level+21  // rusam
  }
}

// ─── UI Wiring ────────────────────────────────────────────────
const btnStart   = document.getElementById('btnStart');
const btnRandom  = document.getElementById('btnRandom');
const btnMenu    = document.getElementById('btnMenu');
const btnMenuEnd = document.getElementById('btnMenuEnd');
const btnRestart = document.getElementById('btnRestart');

// Seleção de modo
let _selectedMode = 'survival';
document.querySelectorAll('.mode-btn').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.mode-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    _selectedMode = b.dataset.mode;
  });
});

// ─── Seleção de tamanho do mapa ──────────────────────────────
let _selectedMapW = 800, _selectedMapH = 600;
document.querySelectorAll('.mapsize-btn').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.mapsize-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    _selectedMapW = parseInt(b.dataset.w);
    _selectedMapH = parseInt(b.dataset.h);
  });
});

// ─── Importar mapa JSON ───────────────────────────────────────
const mapImportInput = document.getElementById('mapImport');
if(mapImportInput){
  mapImportInput.addEventListener('change',e=>{
    const file=e.target.files[0];
    if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        _importedMapData=JSON.parse(ev.target.result);
        const nameEl=document.getElementById('mapImportName');
        if(nameEl) nameEl.textContent=file.name;
        // Atualizar tamanho do mapa a partir do arquivo
        if(_importedMapData.worldW) _selectedMapW=_importedMapData.worldW;
        if(_importedMapData.worldH) _selectedMapH=_importedMapData.worldH;
      }catch(err){ alert('JSON de mapa inválido'); }
    };
    reader.readAsText(file);
  });
}
const btnClearImport=document.getElementById('btnClearImport');
if(btnClearImport) btnClearImport.onclick=()=>{
  _importedMapData=null;
  if(mapImportInput) mapImportInput.value='';
  const nameEl=document.getElementById('mapImportName');
  if(nameEl) nameEl.textContent='nenhum';
};
const btnExportMap=document.getElementById('btnExportMap');
if(btnExportMap) btnExportMap.onclick=()=>{ if(running && typeof exportCurrentMap==='function') exportCurrentMap(); else alert('Inicie um jogo antes de exportar.'); };
// Versão do botão de exportar dentro do HUD (durante a partida) — mesma
// função, sem o alerta de "inicie um jogo antes", já que só existe visível
// enquanto #hud está ativo (running===true).
const btnExportMapHud=document.getElementById('btnExportMapHud');
if(btnExportMapHud) btnExportMapHud.onclick=()=>{ if(running && typeof exportCurrentMap==='function') exportCurrentMap(); };

if(btnStart)   btnStart.onclick  = ()=>{
  WORLD_W=_selectedMapW; WORLD_H=_selectedMapH;
  startGame(seedInput.value.trim()||'103b08f87d2afb72', _selectedMode);
};
if(btnRandom)  btnRandom.onclick = ()=>{
  // Gera uma string hexadecimal de qualquer tamanho (ex: 16 caracteres)
const r = Array.from(crypto.getRandomValues(new Uint8Array(8)))
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');
  WORLD_W=_selectedMapW; WORLD_H=_selectedMapH;
  startGame(r,_selectedMode);
};
const btnSettings      = document.getElementById('btnSettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const settingsScreen   = document.getElementById('settingsScreen');
if(btnSettings)      btnSettings.onclick      = ()=>{ if(settingsScreen) settingsScreen.classList.add('show'); };
if(btnCloseSettings) btnCloseSettings.onclick = ()=>{ if(settingsScreen) settingsScreen.classList.remove('show'); };

// ─── Tiro Manual (Configurações) ────────────────────────────────
const manualFireToggle = document.getElementById('manualFireToggle');
const toolBtnFire = document.getElementById('toolBtnFire');
function setManualFireMode(on){
  manualFireMode = on;
  if(manualFireToggle) manualFireToggle.checked = on;
  if(toolBtnFire) toolBtnFire.classList.toggle('hidden', !on);
  if(on) setTool('fire');
  else if(currentTool==='fire') setTool('build');
}
if(manualFireToggle) manualFireToggle.addEventListener('change', ()=>{ setManualFireMode(manualFireToggle.checked); });

const btnHelp      = document.getElementById('btnHelp');
const btnCloseHelp = document.getElementById('btnCloseHelp');
const helpScreen   = document.getElementById('helpScreen');
if(btnHelp)      btnHelp.onclick      = ()=>{ if(helpScreen) helpScreen.classList.add('show'); };
if(btnCloseHelp) btnCloseHelp.onclick = ()=>{ if(helpScreen) helpScreen.classList.remove('show'); };

// "☰ Menu" no HUD: a partida ainda está rolando (robô vivo), então salva
// pra poder continuar depois. "☰ Menu Principal" só aparece na tela de
// FIM DE JOGO (vitória ou derrota) — não há "continuar" um jogo que já
// terminou, então aqui o save existente é descartado em vez de gravado.
if(btnMenu)    btnMenu.onclick   = ()=>{saveGame();running=false;menuScreen.classList.remove('hidden');hud.classList.add('hidden');if(endScreen)endScreen.classList.remove('show');};
if(btnMenuEnd) btnMenuEnd.onclick= ()=>{clearSavedGame();running=false;menuScreen.classList.remove('hidden');hud.classList.add('hidden');if(endScreen)endScreen.classList.remove('show');};
if(btnRestart) btnRestart.onclick= ()=>{if(endScreen)endScreen.classList.remove('show');startGame(seedStr,gameMode);};
const btnContinue = document.getElementById('btnContinue');
if(btnContinue) btnContinue.onclick = ()=>{ loadGame(); };
_refreshContinueButton(); // estado inicial ao carregar a página
const btnShop = document.getElementById('btnShop');
if(btnShop) btnShop.onclick = ()=>{ shopOpen ? closeShopPanel() : showShopPanel(); };
const btnInventory = document.getElementById('btnInventory');
if(btnInventory) btnInventory.onclick = ()=>{ inventoryOpen ? closeInventoryPanel() : showInventoryPanel(); };
const btnCloseInventory = document.getElementById('btnCloseInventory');
if(btnCloseInventory) btnCloseInventory.onclick = closeInventoryPanel;
if(inventoryScreen) inventoryScreen.addEventListener('click', e=>{ if(e.target===inventoryScreen) closeInventoryPanel(); });
const btnPause = document.getElementById('btnPause');
if(btnPause) btnPause.onclick = ()=>{ togglePause(); };
if(seedInput)  seedInput.addEventListener('keydown',e=>{if(e.key==='Enter'){ WORLD_W=_selectedMapW;WORLD_H=_selectedMapH; startGame(seedInput.value.trim()||'TheInitWord'); }});

// O loop de render é iniciado pelo startGame

