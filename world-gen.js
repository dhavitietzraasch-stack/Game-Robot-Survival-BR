/* ============================================================
   SIGNAL LOST — world-gen.js  v3.2
   Sistema de Geração Climática e Ecológica
   Substitui generateSurface() em game.js

   COMO USAR:
   1. Adicione <script src="world-gen.js"></script> no index.html
      DEPOIS de game.js (última linha antes de </body>)
   2. A função generateSurface() aqui definida sobrescreve
      a versão interna de game.js por ser declarada depois
      no mesmo escopo global.

   ARQUITETURA:
   • Camadas de noise independentes (temperatura, umidade,
     altitude, erosão, estranheza, corrupção, continentes)
   • Sistema de afinidade de biomas com regras climáticas
   • Anti-repetição com memória regional e penalidade dinâmica
   • Transições graduais entre biomas vizinhos
   • Biomas "não naturais" raros e isolados
   • v3.2 — menos sólido no total, alterador probabilístico
     (pântano+água) e sistema de modificadores por tile
     (temperatura, extensível a novos modificadores depois)
   ============================================================ */
'use strict';

/* ─────────────────────────────────────────────────────────────
   TABELA MESTRA DE BIOMAS
   Cada entrada define as condições ideais e comportamento
   de expansão de um bioma.
   ───────────────────────────────────────────────────────────── */
const BIOME_DEF = {
  // ── Biomas comuns / naturais ──────────────────────────────
  [T.GRASS]: {
    name:'Pradaria',
    tempMin:-0.2, tempMax:0.6,
    humidMin:0.1, humidMax:0.7,
    altMin:-0.1,  altMax:0.5,
    weight:10, rarity:0, aggression:0.7,
    repeatLimit:6,  resistance:0.4,
    compatible:[T.FOREST,T.SAVANNA,T.SWAMP,T.SAND],
    incompatible:[T.SNOW,T.ICE,T.DESERT,T.LAVA,T.TUNDRA],
    transitionChance:0.55, sizeTarget:60, sizeMin:15, sizeMax:120,
    natural:true,
  },
  [T.FOREST]: {
    name:'Floresta',
    tempMin:-0.1, tempMax:0.5,
    humidMin:0.3, humidMax:1.0,
    altMin:-0.05, altMax:0.45,
    weight:9, rarity:0, aggression:0.8,
    repeatLimit:5, resistance:0.5,
    compatible:[T.GRASS,T.SWAMP,T.MUSHROOM,T.TUNDRA],
    incompatible:[T.DESERT,T.LAVA,T.VOLCANIC_ASH,T.ICE],
    transitionChance:0.60, sizeTarget:80, sizeMin:20, sizeMax:150,
    natural:true,
  },
  [T.SAVANNA]: {
    name:'Savana',
    tempMin:0.2,  tempMax:0.85,
    humidMin:0.0, humidMax:0.35,
    altMin:-0.1,  altMax:0.4,
    weight:7, rarity:0, aggression:0.6,
    repeatLimit:4, resistance:0.35,
    compatible:[T.GRASS,T.SAND,T.DESERT],
    incompatible:[T.SNOW,T.ICE,T.FOREST,T.SWAMP,T.TUNDRA],
    transitionChance:0.50, sizeTarget:70, sizeMin:15, sizeMax:130,
    natural:true,
  },
  [T.SAND]: {
    name:'Praia/Areia',
    tempMin:0.0,  tempMax:0.9,
    humidMin:0.0, humidMax:0.5,
    altMin:-0.25, altMax:0.2,
    weight:6, rarity:0, aggression:0.5,
    repeatLimit:4, resistance:0.3,
    compatible:[T.SAVANNA,T.DESERT,T.GRASS,T.WATER],
    incompatible:[T.SNOW,T.TUNDRA,T.FOREST],
    transitionChance:0.55, sizeTarget:40, sizeMin:8, sizeMax:90,
    natural:true,
  },
  [T.DESERT]: {
    name:'Deserto',
    tempMin:0.45, tempMax:1.0,
    humidMin:0.0, humidMax:0.15,
    altMin:-0.05, altMax:0.35,
    weight:6, rarity:0.1, aggression:0.55,
    repeatLimit:4, resistance:0.45,
    compatible:[T.SAVANNA,T.SAND,T.VOLCANIC_ASH],
    incompatible:[T.SNOW,T.ICE,T.TUNDRA,T.FOREST,T.SWAMP],
    transitionChance:0.45, sizeTarget:90, sizeMin:25, sizeMax:180,
    natural:true,
  },
  [T.SWAMP]: {
    name:'Pântano',
    tempMin:0.0,  tempMax:0.55,
    humidMin:0.55, humidMax:1.0,
    altMin:-0.3,  altMax:0.1,
    weight:5, rarity:0.1, aggression:0.6,
    repeatLimit:3, resistance:0.4,
    compatible:[T.FOREST,T.GRASS,T.MUSHROOM],
    incompatible:[T.DESERT,T.SAND,T.ICE,T.LAVA,T.TUNDRA],
    transitionChance:0.50, sizeTarget:50, sizeMin:12, sizeMax:100,
    natural:true,
  },
  [T.SNOW]: {
    name:'Neve',
    tempMin:-1.0, tempMax:-0.25,
    humidMin:0.1, humidMax:0.8,
    altMin:-0.1,  altMax:1.0,
    weight:6, rarity:0, aggression:0.65,
    repeatLimit:5, resistance:0.55,
    compatible:[T.TUNDRA,T.ICE],
    incompatible:[T.DESERT,T.SAVANNA,T.LAVA,T.SWAMP,T.GRASS,T.FOREST],
    transitionChance:0.55, sizeTarget:80, sizeMin:20, sizeMax:160,
    natural:true,
  },
  [T.TUNDRA]: {
    name:'Tundra',
    tempMin:-0.6, tempMax:0.0,
    humidMin:0.0, humidMax:0.5,
    altMin:-0.1,  altMax:0.6,
    weight:5, rarity:0, aggression:0.55,
    repeatLimit:4, resistance:0.45,
    compatible:[T.SNOW,T.ICE,T.FOREST],
    incompatible:[T.DESERT,T.SAVANNA,T.LAVA,T.SWAMP],
    transitionChance:0.55, sizeTarget:70, sizeMin:15, sizeMax:140,
    natural:true,
  },
  [T.ICE]: {
    name:'Glacial',
    tempMin:-1.0, tempMax:-0.5,
    humidMin:0.2, humidMax:1.0,
    altMin:0.1,   altMax:1.0,
    weight:4, rarity:0.15, aggression:0.50,
    repeatLimit:3, resistance:0.60,
    compatible:[T.SNOW,T.TUNDRA],
    incompatible:[T.DESERT,T.SAVANNA,T.LAVA,T.SWAMP,T.GRASS,T.FOREST],
    transitionChance:0.40, sizeTarget:50, sizeMin:10, sizeMax:100,
    natural:true,
  },
  [T.MUSHROOM]: {
    name:'Fungal',
    tempMin:0.0,  tempMax:0.45,
    humidMin:0.4, humidMax:0.9,
    altMin:-0.1,  altMax:0.3,
    weight:3, rarity:0.25, aggression:0.4,
    repeatLimit:2, resistance:0.35,
    compatible:[T.FOREST,T.SWAMP],
    incompatible:[T.DESERT,T.SAND,T.ICE,T.LAVA],
    transitionChance:0.40, sizeTarget:35, sizeMin:8, sizeMax:70,
    natural:true,
  },
  [T.VOLCANIC_ASH]: {
    name:'Cinzas Vulcânicas',
    tempMin:0.3,  tempMax:0.95,
    humidMin:0.0, humidMax:0.3,
    altMin:0.0,   altMax:0.6,
    weight:4, rarity:0.2, aggression:0.45,
    repeatLimit:2, resistance:0.5,
    compatible:[T.DESERT,T.SAVANNA,T.ROCK],
    incompatible:[T.FOREST,T.SNOW,T.ICE,T.SWAMP],
    transitionChance:0.45, sizeTarget:45, sizeMin:10, sizeMax:80,
    natural:true,
  },
  // ── Água / Mar — colocados por altitude, não por Voronoi ──
  [T.WATER]: {
    name:'Água',
    tempMin:-1.0, tempMax:1.0,
    humidMin:0.0, humidMax:1.0,
    altMin:-1.0,  altMax:-0.15,
    weight:8, rarity:0, aggression:0.9,
    repeatLimit:99, resistance:0.8,
    compatible:[T.SAND,T.CORAL,T.SWAMP],
    incompatible:[],
    transitionChance:0.8, sizeTarget:200, sizeMin:30, sizeMax:500,
    natural:true,
  },
  [T.DEEP_WATER]: {
    name:'Mar Profundo',
    tempMin:-1.0, tempMax:1.0,
    humidMin:0.0, humidMax:1.0,
    altMin:-1.0,  altMax:-0.38,
    weight:7, rarity:0, aggression:0.9,
    repeatLimit:99, resistance:0.9,
    compatible:[T.WATER,T.CORAL],
    incompatible:[],
    transitionChance:0.85, sizeTarget:300, sizeMin:50, sizeMax:800,
    natural:true,
  },
  [T.CORAL]: {
    name:'Recife de Coral',
    tempMin:0.1,  tempMax:0.7,
    humidMin:0.5, humidMax:1.0,
    altMin:-0.35, altMax:-0.1,
    weight:3, rarity:0.2, aggression:0.3,
    repeatLimit:2, resistance:0.3,
    compatible:[T.WATER,T.SAND],
    incompatible:[T.ICE,T.SNOW,T.TUNDRA],
    transitionChance:0.40, sizeTarget:30, sizeMin:6, sizeMax:60,
    natural:true,
  },
  // ── Biomas "não naturais" — raros, isolados ───────────────
  [T.TOXIC]: {
    name:'Zona Tóxica',
    tempMin:0.0,  tempMax:0.7,
    humidMin:0.3, humidMax:0.8,
    altMin:-0.2,  altMax:0.3,
    weight:1, rarity:0.65, aggression:0.2,
    repeatLimit:1, resistance:0.2,
    compatible:[T.SWAMP],
    incompatible:[T.ICE,T.SNOW,T.DESERT,T.SAVANNA],
    transitionChance:0.20, sizeTarget:18, sizeMin:4, sizeMax:40,
    natural:false,
  },
  [T.LAVA]: {
    name:'Vulcânico',
    tempMin:0.5,  tempMax:1.0,
    humidMin:0.0, humidMax:0.2,
    altMin:0.0,   altMax:0.8,
    weight:1, rarity:0.65, aggression:0.15,
    repeatLimit:1, resistance:0.25,
    compatible:[T.VOLCANIC_ASH],
    incompatible:[T.WATER,T.ICE,T.SNOW,T.FOREST,T.SWAMP],
    transitionChance:0.15, sizeTarget:15, sizeMin:3, sizeMax:35,
    natural:false,
  },
};

/* ─────────────────────────────────────────────────────────────
   REGRAS DE TRANSIÇÃO: quais biomas podem fazer fronteira
   com quais, e qual bioma intermediário usar.
   ───────────────────────────────────────────────────────────── */
const TRANSITION_RULES = {
  // Deserto → Floresta: passar por savana + grama
  [T.DESERT]: {
    [T.FOREST]: [T.SAVANNA, T.GRASS],
    [T.SNOW]:   [T.SAVANNA, T.GRASS, T.TUNDRA],
    [T.SWAMP]:  [T.SAVANNA, T.GRASS],
    [T.ICE]:    [T.SAVANNA, T.GRASS, T.TUNDRA, T.SNOW],
  },
  [T.SNOW]: {
    [T.DESERT]: [T.TUNDRA, T.GRASS, T.SAVANNA],
    [T.SAVANNA]: [T.TUNDRA, T.GRASS],
    [T.SWAMP]:  [T.TUNDRA, T.GRASS],
    [T.LAVA]:   [T.TUNDRA, T.GRASS, T.SAVANNA],
  },
  [T.LAVA]: {
    [T.SNOW]:   [T.VOLCANIC_ASH, T.DESERT, T.SAVANNA],
    [T.ICE]:    [T.VOLCANIC_ASH, T.DESERT, T.SAVANNA],
    [T.FOREST]: [T.VOLCANIC_ASH, T.SAVANNA],
    [T.SWAMP]:  [T.VOLCANIC_ASH, T.SAVANNA],
  },
};

/* ─────────────────────────────────────────────────────────────
   GERADOR CLIMÁTICO PRINCIPAL
   Substitui generateSurface() no game.js
   ───────────────────────────────────────────────────────────── */
// NOTA: game.js usa `function generateSurface` (declaration hoisted).
// Para sobrescrever de um script carregado depois, usamos window.generateSurface.
// A flag window._worldGenPatched indica ao generateWorld() que deve usar esta versão.
window._worldGenPatched = true;
window.generateSurface = function generateSurface(rand, rng0) {
  const wg = worldGrids[DIM.SURFACE];
  const ig = integrities[DIM.SURFACE];

  // Safety check: ensure rng0 is a function, fallback to rand if needed
  const seedFunc = (typeof rng0 === 'function') ? rng0 : rand;

  /* ── 1. Criar múltiplas camadas de noise independentes ───── */
  const nContinent = createNoise(mulberry32(seedFunc())); // massa continental
  const nElev      = createNoise(mulberry32(seedFunc())); // altitude local
  const nElev2     = createNoise(mulberry32(seedFunc())); // detalhe de altitude
  const nTemp      = createNoise(mulberry32(seedFunc())); // temperatura regional
  const nHumid     = createNoise(mulberry32(seedFunc())); // umidade
  const nErosion   = createNoise(mulberry32(seedFunc())); // erosão / ondulação
  const nRock      = createNoise(mulberry32(seedFunc())); // afloramentos rochosos
  const nRiver     = createNoise(mulberry32(seedFunc())); // rios
  const nWeird     = createNoise(mulberry32(seedFunc())); // estranheza / anomalia
  const nCorrupt   = createNoise(mulberry32(seedFunc())); // corrupção / tóxico
  const nSpec      = createNoise(mulberry32(seedFunc())); // vulcanismo especial
  const nLake      = createNoise(mulberry32(seedFunc())); // v3.1: lagos interiores
  const nLake2     = createNoise(mulberry32(seedFunc())); // v3.1: detalhe de lagos

  /* ── 2. Pré-computar campos climáticos ────────────────────── */
  const W = WORLD_W, H = WORLD_H;
  const sz = W * H;

  const tempField   = new Float32Array(sz);
  const humidField  = new Float32Array(sz);
  const elevField   = new Float32Array(sz);
  const weirdField  = new Float32Array(sz);
  const corruptField= new Float32Array(sz);

  /* Escala de noise: maior = mais detalhado, menor = mais largo */
  const CONT_SCALE  = 0.0025; // continentes gigantes
  const ELEV_SCALE  = 0.007;  // altitude base
  const ELEV2_SCALE = 0.020;  // detalhe de altitude
  const TEMP_SCALE  = 0.006;  // temperatura regional
  const HUMID_SCALE = 0.008;  // umidade regional
  const EROSION_SC  = 0.015;  // erosão
  const WEIRD_SCALE = 0.012;  // estranheza
  const CORR_SCALE  = 0.018;  // corrupção
  const LAKE_SCALE  = 0.010;  // v3.1: bacias de lagos interiores (maior que rios, menor que continentes)

  // Offsets aleatórios para variar o mundo a cada seed
  const ox = rand() * 9999;
  const oy = rand() * 9999;

  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const idx = wi(tx, ty);

      // Latitude normalizada: -1 (norte) a +1 (sul), com variação senoidal
      const lat = (ty / H) * 2.0 - 1.0;
      // Longitude normalizada
      const lon = (tx / W) * 2.0 - 1.0;

      // Massa continental: ilhas/continentes de grande escala
      const continent = nContinent(tx * CONT_SCALE + ox, ty * CONT_SCALE + oy);
      const continent2 = nContinent(tx * CONT_SCALE * 2.2 + ox + 500, ty * CONT_SCALE * 2.2 + oy + 500) * 0.4;
      const continentVal = continent * 0.7 + continent2;

      // Altitude: combinação de continental + local
      const e1 = nElev(tx * ELEV_SCALE + ox, ty * ELEV_SCALE + oy);
      const e2 = nElev2(tx * ELEV2_SCALE + ox + 1000, ty * ELEV2_SCALE + oy + 1000) * 0.35;
      const erosion = nErosion(tx * EROSION_SC + ox + 3000, ty * EROSION_SC + oy + 3000) * 0.15;
      // Continentes elevam a altitude; oceanos a reduzem
      const baseElev = continentVal * 0.55 + e1 * 0.35 + e2 + erosion;

      // v3.1 — Lagos interiores: bacias de água espalhadas pelo continente,
      // não só nas bordas do mapa (que já viram oceano pela máscara de forma
      // do passo 9, mais abaixo). Só "afunda" terrenos baixos/médios já
      // relativamente planos, para não cortar montanhas nem duplicar a costa.
      const lakeN  = nLake(tx * LAKE_SCALE + ox + 13000, ty * LAKE_SCALE + oy + 13000);
      const lakeN2 = nLake2(tx * LAKE_SCALE * 2.6 + ox + 13500, ty * LAKE_SCALE * 2.6 + oy + 13500) * 0.4;
      const lakeVal = lakeN * 0.75 + lakeN2;
      let baseElevWithLakes = baseElev;
      if (lakeVal > 0.60 && baseElev > -0.12 && baseElev < 0.32) {
        const lakeDepth = (lakeVal - 0.60) * 1.9; // 0 .. ~0.76
        baseElevWithLakes = baseElev - lakeDepth;
      }
      elevField[idx] = baseElevWithLakes;

      // Temperatura: latitude (frio nos extremos), altitude (frio em montanhas),
      //              correntes regionais (noise)
      const latCold = Math.abs(lat) * 0.8; // polar cooling
      const altCool = Math.max(0, baseElev * 0.6); // altitude cooling
      const tempNoise = nTemp(tx * TEMP_SCALE + ox + 2000, ty * TEMP_SCALE + oy + 2000) * 0.4;
      // Sombra de chuva: encostas a barlavento mais quentes/secas
      const windShadow = nErosion(tx * 0.009 + ox + 6000, ty * 0.009 + oy + 6000) * 0.12;
      tempField[idx] = 0.5 - latCold - altCool + tempNoise + windShadow;
      // Normalizar grosseiramente em [-1, 1]
      tempField[idx] = Math.max(-1, Math.min(1, tempField[idx]));

      // Umidade: proximidade oceânica (baixa altitude = mais úmido),
      //          correntes de vento regionais, altitude (chuva orográfica)
      const oceanProx = Math.max(0, 0.5 - baseElev) * 1.2; // perto de água = úmido
      const humidNoise = nHumid(tx * HUMID_SCALE + ox + 4000, ty * HUMID_SCALE + oy + 4000) * 0.7;
      // Sombra de chuva: montanhas bloqueiam umidade
      const rainShadow = Math.max(0, baseElev * 0.30);
      // v3.1 — leve umidade extra perto de bacias de lago (mesmo em tiles que
      // não viraram água), simulando o entorno mais verde de um lago/oásis.
      const lakeHumidBoost = Math.max(0, lakeVal - 0.40) * 0.35;
      // v3.1 — baseline mais úmido (0.45→0.52) e sombra de chuva mais suave
      // (×0.7): o mundo anterior gerava deserto demais porque a maior parte
      // do bioma "quente" caía abaixo dos limiares de savana/floresta.
      humidField[idx] = Math.max(0, Math.min(1, 0.52 + oceanProx + humidNoise - rainShadow*0.7 + windShadow + lakeHumidBoost));

      // Estranheza: anomalias raras
      const w1 = nWeird(tx * WEIRD_SCALE + ox + 7000, ty * WEIRD_SCALE + oy + 7000);
      const w2 = nWeird(tx * WEIRD_SCALE * 2.5 + ox + 7500, ty * WEIRD_SCALE * 2.5 + oy + 7500) * 0.4;
      weirdField[idx] = w1 * 0.7 + w2;

      // Corrupção: zonas tóxicas raras
      const c1 = nCorrupt(tx * CORR_SCALE + ox + 8000, ty * CORR_SCALE + oy + 8000);
      const c2 = nCorrupt(tx * CORR_SCALE * 3.0 + ox + 8500, ty * CORR_SCALE * 3.0 + oy + 8500) * 0.35;
      corruptField[idx] = c1 * 0.65 + c2;
    }
  }

  /* ── 3. Classificar cada tile em um bioma climático ──────── */
  // Primeiro, determinar o bioma "cru" baseado nos campos climáticos
  const rawBiome = new Uint8Array(sz);

  // Contador de biomas para sistema anti-repetição
  const biomeCounts = {};

  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const idx = wi(tx, ty);
      const elev  = elevField[idx];
      const temp  = tempField[idx];
      const humid = humidField[idx];
      const weird = weirdField[idx];
      const corr  = corruptField[idx];

      // ── Altitude determina água / neve de montanha ──────────
      if (elev < -0.38) {
        rawBiome[idx] = T.DEEP_WATER; continue;
      }
      if (elev < -0.18) {
        rawBiome[idx] = T.WATER; continue;
      }
      // Praia/areia: transição entre água e terra
      if (elev < -0.04) {
        rawBiome[idx] = T.SAND; continue;
      }
      // Montanhas altas → neve independentemente da latitude
      if (elev > 0.52) {
        rawBiome[idx] = T.SNOW; continue;
      }
      // Montanhas médias em regiões frias → neve/gelo
      if (elev > 0.38 && temp < -0.1) {
        rawBiome[idx] = temp < -0.35 ? T.ICE : T.SNOW; continue;
      }

      // ── Biomas "não naturais" — verificar primeiro (raros) ──
      // Vulcanismo especial (zona geotérmica muito específica)
      const specV = nSpec(tx * 0.030 + ox + 9000, ty * 0.030 + oy + 9000);
      if (specV > 0.72 && temp > 0.3) {
        rawBiome[idx] = T.LAVA; continue;
      }
      if (specV > 0.60 && temp > 0.2) {
        rawBiome[idx] = T.VOLCANIC_ASH; continue;
      }
      // Zona tóxica (corrupção ambiental)
      if (corr > 0.65 && humid > 0.3 && temp > -0.1) {
        rawBiome[idx] = T.TOXIC; continue;
      }
      // Recife de coral (água rasa quente)
      // (Coral aparece como layer sobre água, tratado depois)

      // ── Classificação climática principal ──────────────────
      // Regiões polares / frias
      if (temp < -0.35) {
        if (humid > 0.35)      { rawBiome[idx] = T.ICE; continue; }
        else                   { rawBiome[idx] = T.SNOW; continue; }
      }
      if (temp < -0.05) {
        if (elev > 0.25)       { rawBiome[idx] = T.SNOW; continue; }
        if (humid > 0.3)       { rawBiome[idx] = T.TUNDRA; continue; }
        rawBiome[idx] = T.SNOW; continue;
      }
      if (temp < 0.15) {
        if (humid > 0.45)      { rawBiome[idx] = T.FOREST; continue; }
        if (humid > 0.15)      { rawBiome[idx] = T.TUNDRA; continue; }
        rawBiome[idx] = T.GRASS; continue;
      }

      // Regiões temperadas
      if (temp < 0.40) {
        if (humid > 0.65)      { rawBiome[idx] = T.SWAMP; continue; }
        if (humid > 0.40)      {
          rawBiome[idx] = weird > 0.50 ? T.MUSHROOM : T.FOREST; continue;
        }
        if (humid > 0.18)      { rawBiome[idx] = T.GRASS; continue; }
        rawBiome[idx] = T.SAVANNA; continue;
      }

      // Regiões quentes / tropicais
      // v3.1: faixa estendida de 0.65→0.72 (deserto "puro" fica restrito a
      // uma faixa de temperatura mais estreita/realista) e um novo degrau de
      // umidade 0.06–0.13 que favorece savana em vez de ir direto a deserto —
      // o mundo anterior tinha deserto DEMAIS porque esta cauda baixa de
      // umidade caía quase sempre aqui.
      if (temp < 0.72) {
        if (humid > 0.55)      { rawBiome[idx] = T.SWAMP; continue; }
        if (humid > 0.32)      { rawBiome[idx] = T.FOREST; continue; }
        if (humid > 0.13)      { rawBiome[idx] = T.SAVANNA; continue; }
        if (humid > 0.06)      { rawBiome[idx] = rand() < 0.55 ? T.SAVANNA : T.DESERT; continue; }
        rawBiome[idx] = T.DESERT; continue;
      }

      // Regiões áridas / xéricas — agora só temp>=0.72 (era 0.65), uma faixa
      // bem mais estreita perto do "equador" do mapa. Savana ganha mais peso
      // em todos os degraus e nunca é 100% deserto puro, para evitar blocos
      // monótonos e dar variedade visual mesmo nas zonas mais secas.
      if (humid > 0.28) { rawBiome[idx] = T.SAVANNA; continue; }
      if (humid > 0.12) { rawBiome[idx] = rand() < 0.70 ? T.SAVANNA : T.DESERT; continue; }
      if (humid > 0.05) { rawBiome[idx] = rand() < 0.45 ? T.SAVANNA : T.DESERT; continue; }
      rawBiome[idx] = rand() < 0.20 ? T.SAVANNA : T.DESERT;
    }
  }

  /* ── 4. Adicionar coral em água rasa quente ──────────────── */
  // seedFunc já foi usado 11 vezes acima; continuar a sequência
  const nCoralMask = createNoise(mulberry32(seedFunc()));
  for (let ty = 1; ty < H - 1; ty++) {
    for (let tx = 1; tx < W - 1; tx++) {
      const idx = wi(tx, ty);
      if (rawBiome[idx] !== T.WATER) continue;
      const temp = tempField[idx];
      if (temp < 0.1) continue;
      const coralN = nCoralMask(tx * 0.025 + ox + 11000, ty * 0.025 + oy + 11000);
      if (coralN > 0.55 && rand() < 0.15) {
        rawBiome[idx] = T.CORAL;
      }
    }
  }

  /* ── 5. Suavização / anti-ruído ─────────────────────────── */
  // Remover tiles isolados de biomas "estranhos" rodeados por outro bioma
  // Fazer 2 passes para aumentar coerência regional
  const smoothed = new Uint8Array(rawBiome);

  for (let pass = 0; pass < 2; pass++) {
    const src = new Uint8Array(smoothed);
    for (let ty = 1; ty < H - 1; ty++) {
      for (let tx = 1; tx < W - 1; tx++) {
        const idx = wi(tx, ty);
        const t = src[idx];
        // Não suavizar água, lava ou tiles sólidos
        if (t === T.DEEP_WATER || t === T.WATER || t === T.LAVA) continue;

        // Contar biomas vizinhos (4-vizinhos)
        const neighbors = [
          src[wi(tx-1, ty)], src[wi(tx+1, ty)],
          src[wi(tx, ty-1)], src[wi(tx, ty+1)]
        ];
        let same = 0;
        const counts = {};
        for (const nb of neighbors) {
          counts[nb] = (counts[nb] || 0) + 1;
          if (nb === t) same++;
        }

        // Tile isolado (sem vizinhos do mesmo tipo) → blend com vizinhos
        if (same === 0) {
          // Escolher bioma mais comum entre os 4 vizinhos (excluindo água profunda)
          let bestCount = 0, bestTile = t;
          for (const [tid, cnt] of Object.entries(counts)) {
            const tid2 = +tid;
            if (cnt > bestCount && tid2 !== T.DEEP_WATER) {
              bestCount = cnt; bestTile = tid2;
            }
          }
          smoothed[idx] = bestTile;
        }
        // Tile em minoria (1 vizinho igual, 3 diferentes) → chance de blend
        else if (same === 1 && pass === 0) {
          const def = BIOME_DEF[t];
          // Biomas raros e não-naturais resistem menos à suavização
          const blendChance = def ? (def.natural ? 0.15 : 0.45) : 0.3;
          if (rand() < blendChance) {
            let bestCount = 0, bestTile = t;
            for (const [tid, cnt] of Object.entries(counts)) {
              const tid2 = +tid;
              if (cnt > bestCount && tid2 !== t && tid2 !== T.DEEP_WATER) {
                bestCount = cnt; bestTile = tid2;
              }
            }
            smoothed[idx] = bestTile;
          }
        }
      }
    }
  }

  /* ── 6. Adicionar afloramentos rochosos sobre terreno ──────
     Rochas aparecem em altitude mais alta mas abaixo da neve,
     ou em regiões áridas. Integradas no terreno, não aleatórias.

     v3.2 — "menos pedras": teto geral subiu de 0.65 para 0.74 (menos
     sólido no mundo inteiro) e floresta/glacial ganharam uma penalidade
     extra, porque mesmo sendo biomas "macios" ainda geravam pedra
     demais. Água e praia já ficavam de fora deste laço inteiro (ver o
     `continue` logo abaixo) — ou seja, chance zero, sem precisar de
     ajuste. */
  const SOLID_PENALTY_BIOMA = {
    [T.FOREST]: 0.12,
    [T.ICE]:    0.12, // "Glacial"
  };
  const SOLID_THRESHOLD = 0.74; // era 0.65 — quanto maior, menos pedra no total

  const rockSrc = new Uint8Array(smoothed);
  for (let ty = 1; ty < H - 1; ty++) {
    for (let tx = 1; tx < W - 1; tx++) {
      const idx = wi(tx, ty);
      const t = rockSrc[idx];
      if (t === T.DEEP_WATER || t === T.WATER || t === T.LAVA ||
          t === T.SAND || t === T.CORAL) continue;

      const rn  = nRock(tx * 0.048 + ox + 1234, ty * 0.048 + oy + 5678);
      const rn2 = nRock(tx * 0.090 + ox + 9000, ty * 0.090 + oy + 4321) * 0.35;
      const rockVal = rn + rn2;
      const elev = elevField[idx];

      // Mais rochas em altitudes médias-altas e biomas secos
      const rockBonus = Math.max(0, elev * 0.4) +
        (t === T.DESERT || t === T.VOLCANIC_ASH ? 0.08 : 0);
      const penalty = SOLID_PENALTY_BIOMA[t] || 0;

      if (rockVal + rockBonus - penalty > SOLID_THRESHOLD) {
        let tile;
        if (rockVal > 0.78)      tile = T.STONE;
        else if (rockVal > 0.74) tile = T.IRON;
        else if (rockVal > 0.71) tile = T.CRYSTAL;
        else                     tile = T.ROCK;
        smoothed[idx] = tile;
        ig[idx] = BLOCK_INTEGRITY[tile] || 100;
      }
    }
  }

  /* ── 7. Rios procedurais ──────────────────────────────────── */
  // Rios fluem de áreas de alta altitude para baixa,
  // evitando cortar através de biomas muito quentes
  for (let ty = 1; ty < H - 1; ty++) {
    for (let tx = 1; tx < W - 1; tx++) {
      const idx = wi(tx, ty);
      const t = smoothed[idx];
      if (t === T.DEEP_WATER || t === T.WATER || t === T.LAVA ||
          t === T.ROCK || t === T.STONE || t === T.IRON || t === T.CRYSTAL) continue;

      const elev = elevField[idx];
      // Rios só em altitude baixa-média (v3.1: teto um pouco mais alto,
      // 0.30→0.36, para cortarem mais terreno interior em vez de sumir cedo)
      if (elev > 0.36) continue;

      const river = nRiver(tx * 0.016 + ox + 333, ty * 0.016 + oy - 777);
      // v3.1: limiar de largura 0.045→0.058 (rios um pouco mais largos e
      // visíveis) e teto de altitude 0.22→0.28 (alcançam mais do mapa)
      if (Math.abs(river) < 0.058 && elev < 0.28) {
        smoothed[idx] = T.WATER;
        ig[idx] = 0;
      }
    }
  }

  /* ── 8. Copiar resultado para worldGrid ─────────────────── */
  for (let i = 0; i < sz; i++) {
    wg[i] = smoothed[i];
    // Integridade apenas para blocos destrutíveis
    if (ig[i] === 0 && BLOCK_INTEGRITY[wg[i]] !== undefined) {
      ig[i] = BLOCK_INTEGRITY[wg[i]];
    }
  }

  /* ── 9. Máscara de forma do mundo — continente orgânico ────
     Aplica um blob distorcido por noise para dar ao mundo uma
     forma não-retangular. Tiles fora da máscara viram DEEP_WATER,
     criando costas irregulares e penínsulas.
     ─────────────────────────────────────────────────────────── */
  const nShape  = createNoise(mulberry32(seedFunc()));
  const nShape2 = createNoise(mulberry32(seedFunc()));

  // Centro levemente deslocado do mapa
  const shapeCX = W * (0.48 + rand()*0.04);
  const shapeCY = H * (0.48 + rand()*0.04);
  // Raios semi-elípticos — a elipse deve cobrir ~72–84% da área do mapa.
  // v3.1 — FIX CRÍTICO: a fração de raio (r) NÃO é igual à fração de área
  // coberta — para uma elipse a área é π·radX·radY, então área/mapa ≈ π·r²
  // quando radX=r·W e radY=r·H. O código antigo usava r=0.36–0.42 "porque
  // o comentário dizia 72–84%", mas π·0.36²≈41% e π·0.42²≈55% — ou seja, a
  // elipse cobria só 41–55% do mapa de verdade, forçando OCEANO em quase
  // metade do mundo (a causa direta de "água só nas bordas"). Fórmula
  // corrigida: r = √(cobertura/π), com cobertura alvo de 0.72–0.85.
  const coverage = 0.72 + rand()*0.13; // 72%–85% de área coberta pela elipse
  const ellR = Math.sqrt(coverage / Math.PI);
  const radX = W * ellR;
  const radY = H * ellR;

  for(let ty=0; ty<H; ty++){
    for(let tx=0; tx<W; tx++){
      const idx = wi(tx, ty);
      const nx2 = (tx - shapeCX) / radX;
      const ny2 = (ty - shapeCY) / radY;
      // Distância elíptica normalizada (0 = centro, 1 = borda elipse)
      const ellD = Math.sqrt(nx2*nx2 + ny2*ny2);

      // Ângulo e distorção polar por noise — cria costas fractais
      const ang = Math.atan2(ny2, nx2);
      const noiseD = nShape(Math.cos(ang)*2.8 + 300, Math.sin(ang)*2.8 + 400) * 0.20
                   + nShape2(Math.cos(ang*2.3)*1.6 + 600, Math.sin(ang*2.3)*1.6 + 700) * 0.09;
      const dist = ellD - noiseD;

      // Só reescrever tiles que já eram terra (não reescrever água existente
      // gerada pelos campos de altitude, mas estender oceano nas bordas)
      if(dist > 1.0){
        wg[idx] = T.DEEP_WATER;
        ig[idx] = 0;
      } else if(dist > 0.90 && wg[idx] !== T.DEEP_WATER && wg[idx] !== T.WATER){
        wg[idx] = T.WATER;
        ig[idx] = 0;
      }
    }
  }

  /* ── 10. Borda do mapa — espessura irregular 1–8 tiles (orgânica) ── */
  // Usa noise para variar espessura por posição → forma não-quadrada
  // Cada lado tem espessura entre 1 e 8 tiles que oscila suavemente
  const nBorder = createNoise(mulberry32(rng0()));
  function borderThick(pos, sideLen, seedOff){
    // noise retorna -1..1, mapeamos para 1..8
    const n = nBorder(pos * 0.08 + seedOff, seedOff * 0.3);
    return Math.max(1, Math.min(8, Math.round((n * 0.5 + 0.5) * 7 + 1)));
  }
  // Topo e base
  for (let tx = 0; tx < W; tx++) {
    const thTop    = borderThick(tx, W, 0);
    const thBottom = borderThick(tx, W, 50);
    for (let d = 0; d < thTop;    d++) { if(d < H) wg[wi(tx, d)]       = T.STONE; }
    for (let d = 0; d < thBottom; d++) { if(H-1-d >= 0) wg[wi(tx, H-1-d)] = T.STONE; }
  }
  // Laterais
  for (let ty = 0; ty < H; ty++) {
    const thLeft  = borderThick(ty, H, 100);
    const thRight = borderThick(ty, H, 150);
    for (let d = 0; d < thLeft;  d++) { if(d < W) wg[wi(d, ty)]       = T.STONE; }
    for (let d = 0; d < thRight; d++) { if(W-1-d >= 0) wg[wi(W-1-d, ty)] = T.STONE; }
  }

  // Sem portais entre dimensões: o mapa é só o cenário da sobrevivência —
  // sem objetivo fixo, o jogador é livre pra explorar entre uma onda e outra.

  /* ── 11. Camada de reações de terreno (pós-processamento) ─────
     Terceira camada, rodando DEPOIS que biomas, rios, forma do mundo e
     bordas já estão prontos. Aplica pequenas "reações" físicas entre
     tiles vizinhos — coisas que o gerador de biomas por si só não sabe
     fazer, porque ele pensa em cada tile isoladamente (clima local), não
     em como um tile reage ao vizinho. Ex.: lava não devia simplesmente
     "existir" do lado de água — na vida real ela esfria na hora.
     As regras rodam em ORDEM e cada uma vê o terreno já modificado pelas
     regras anteriores da lista (é assim que "água cria praia" e depois
     "praia vira pradaria perto da floresta" conseguem se encadear de
     propósito) — mas cada regra individual não reage ao seu próprio
     resultado no meio da sua própria varredura (usa um snapshot tirado
     bem antes dela começar). Ver applyTerrainReactions() mais abaixo. */
  applyTerrainReactions(wg, ig, rand);

  /* ── 12. Sistema de modificadores (novo, extensível) ─────────
     Roda por último, já com o terreno final (biomas + sólidos +
     alteradores todos aplicados) — só assim as âncoras de
     temperatura (bioma Glacial, Vulcânico) estão no lugar certo.
     Ver applyModifiers() mais abaixo. Funciona só aqui, na geração;
     nada disso é lido durante o jogo ainda. */
  applyModifiers(wg);

  return [];
}; // ← ponto-e-vírgula obrigatório: impede que a IIFE abaixo seja
   //   interpretada como chamada de window.generateSurface(iife)()

// ─── Regras de reação de terreno (camada 3) ────────────────────
// Duas formas de regra:
//   mode:'self' → o próprio tile-mestre vira `result` quando tem ALGUM
//                 vizinho (8 direções) do tipo `trigger`.
//   mode:'ring' → quando o tile-mestre tem algum vizinho `trigger`, os
//                 tiles AO REDOR dele (raio `ringRadius`, default 1) que
//                 forem do tipo `ringFrom` viram `result`. O mestre em si
//                 não muda.
// `chance` (opcional, 0–1) → em vez de aplicar sempre que a condição bate,
//                 sorteia por tile-mestre (usando o rand() seedado do
//                 mundo, então o resultado é reproduzível pelo seed).
//                 Sem `chance`, a regra continua 100% determinística
//                 como antes.
// A ORDEM da lista importa: cada regra enxerga o terreno já modificado
// pelas regras anteriores (ver applyTerrainReactions). Por isso, p.ex.,
// "Cinzas do choque térmico" roda ANTES de "Lava esfria em bioma frio"
// (precisa ver a lava original para saber onde jogar cinza ao redor,
// antes dela virar pedra), e "Praia genérica" roda ANTES de "Praia vira
// pradaria perto da floresta" (a praia nova criada perto d'água só pode
// virar pradaria depois de já existir).
const TERRAIN_REACTIONS = [
  // ── mode:'self' ────────────────────────────────────────────
  { name:'Lava resfriada por água', mode:'self',
    master:new Set([T.LAVA]), trigger:new Set([T.WATER,T.DEEP_WATER]),
    result:T.OBSIDIAN,
    note:'lava em contato com água esfria e solidifica em obsidiana' },

  { name:'Margem congelada', mode:'self',
    master:new Set([T.WATER]), trigger:new Set([T.SNOW,T.ICE]),
    result:T.ICE,
    note:'água encostando em neve/gelo congela nas bordas do lago/rio' },

  { name:'Pântano encostado em água pode virar pedra', mode:'self', chance:0.20,
    master:new Set([T.SWAMP]), trigger:new Set([T.WATER,T.DEEP_WATER]),
    result:T.STONE,
    note:'a parte do pântano que encosta na água tem 20% de chance (por '+
         'tile, sorteado individualmente) de se mineralizar em pedra — '+
         'mesmo padrão de "Lava resfriada por água", mas probabilístico '+
         'em vez de sempre acontecer' },

  // ── mode:'ring' ────────────────────────────────────────────
  { name:'Cinzas do choque térmico', mode:'ring', ringRadius:1,
    master:new Set([T.LAVA]), trigger:new Set([T.SNOW,T.ICE,T.TUNDRA]),
    ringFrom:new Set([T.SNOW,T.ICE,T.TUNDRA]), result:T.VOLCANIC_ASH,
    note:'lava encostando em regiões geladas gera cinzas vulcânicas ao redor' },

  // ── mode:'self' (roda DEPOIS das cinzas — ver ordem acima) ──
  { name:'Lava esfria em bioma frio', mode:'self',
    master:new Set([T.LAVA]), trigger:new Set([T.SNOW,T.ICE,T.TUNDRA]),
    result:T.ROCK,
    note:'lava perto de neve/gelo/tundra esfria rápido demais e vira pedra' },

  // ── mode:'ring' ────────────────────────────────────────────
  { name:'Oásis rochoso', mode:'ring', ringRadius:1,
    master:new Set([T.WATER,T.DEEP_WATER]), trigger:new Set([T.DESERT]),
    ringFrom:new Set([T.DESERT,T.SAND]), result:T.ROCK,
    note:'água em pleno deserto expõe rocha ao redor da nascente (oásis)' },

  { name:'Praia genérica', mode:'ring', ringRadius:1,
    master:new Set([T.WATER,T.DEEP_WATER]),
    trigger:new Set([T.GRASS,T.FOREST,T.SAVANNA,T.SWAMP,T.MUSHROOM,T.GHOST_GRASS]),
    ringFrom:new Set([T.GRASS,T.FOREST,T.SAVANNA,T.SWAMP,T.MUSHROOM,T.GHOST_GRASS]),
    result:T.SAND,
    note:'água encostando em qualquer bioma "verde" forma uma faixa de praia ao redor '+
         '(cobre principalmente os rios, que antes cortavam a floresta/grama sem transição)' },

  // ── mode:'self' (roda DEPOIS de "Praia genérica" — ver ordem acima) ──
  { name:'Praia vira pradaria perto da floresta', mode:'self',
    master:new Set([T.SAND]), trigger:new Set([T.FOREST]),
    result:T.GRASS,
    note:'praia colada direto na floresta não combina — a mata toma conta da areia e vira pradaria' },

  { name:'Depósito cristalino', mode:'ring', ringRadius:1,
    master:new Set([T.CRYSTAL]), trigger:new Set([T.WATER,T.DEEP_WATER]),
    ringFrom:new Set([T.GRASS,T.DIRT,T.STONE,T.CAVE_FLOOR]), result:T.CRYSTAL_FLOOR,
    note:'cristais perto de água formam piso cristalino ao redor (recarrega energia)' },
];

// Olha os 8 vizinhos de (tx,ty) em `before` e diz se algum é de `typeSet`.
function _neighborHasType(before, tx, ty, W, H, typeSet){
  for(let dy=-1; dy<=1; dy++){
    for(let dx=-1; dx<=1; dx++){
      if(dx===0 && dy===0) continue;
      const nx=tx+dx, ny=ty+dy;
      if(nx<0||ny<0||nx>=W||ny>=H) continue;
      if(typeSet.has(before[wi(nx,ny)])) return true;
    }
  }
  return false;
}

function applyTerrainReactions(wg, ig, rand){
  const W=WORLD_W, H=WORLD_H;

  for(const rule of TERRAIN_REACTIONS){
    // Snapshot tirado ANTES desta regra específica — ou seja, cada regra já
    // enxerga o que as regras ANTERIORES da lista fizeram (permite cascata
    // proposital entre regras, ex: praia→pradaria depois de água→praia),
    // mas nunca reage ao seu próprio resultado no meio da sua própria
    // varredura (evita efeito dominó incontrolável dentro da mesma regra).
    const before = wg.slice();

    // Se o resultado é um bloco sólido/destrutível, usa a mesma convenção
    // do resto do gerador (ig = BLOCK_INTEGRITY[tile] || 100); se é um tile
    // de bioma/piso normal (não-sólido), integridade não importa → 0.
    const newIg = SOLID.has(rule.result) ? (BLOCK_INTEGRITY[rule.result]||100) : 0;

    for(let ty=0; ty<H; ty++){
      for(let tx=0; tx<W; tx++){
        const idx = wi(tx,ty);
        if(!rule.master.has(before[idx])) continue;
        if(!_neighborHasType(before, tx, ty, W, H, rule.trigger)) continue;
        // Regra com `chance`: sorteia por tile-mestre. Sem `chance`,
        // comportamento antigo (sempre aplica) continua intacto.
        if(rule.chance !== undefined && rand() >= rule.chance) continue;

        if(rule.mode==='self'){
          wg[idx] = rule.result;
          ig[idx] = newIg;
        } else {
          const rr = rule.ringRadius||1;
          for(let dy=-rr; dy<=rr; dy++){
            for(let dx=-rr; dx<=rr; dx++){
              if(dx===0 && dy===0) continue;
              const nx=tx+dx, ny=ty+dy;
              if(nx<0||ny<0||nx>=W||ny>=H) continue;
              const nidx=wi(nx,ny);
              if(!rule.ringFrom.has(before[nidx])) continue;
              wg[nidx] = rule.result;
              ig[nidx] = newIg;
            }
          }
        }
      }
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   SISTEMA DE MODIFICADORES (novo, extensível)
   Cada modificador é um campo numérico por tile (Float32Array do
   tamanho do mapa), calculado uma única vez aqui na geração — não
   roda durante o jogo. Hoje só "temperatura" existe; um modificador
   novo (umidade, radiação, o que for) entra só adicionando uma
   entrada em MODIFIER_DEFS, sem tocar no motor de propagação abaixo.
   ───────────────────────────────────────────────────────────── */
const MODIFIER_DEFS = {
  temperatura: {
    decaimento: 0.5,      // cada vizinho herda metade do valor do anterior
    magnitudeMinima: 1,   // abaixo disso a propagação para
    fontes: {              // bioma-âncora → valor inicial extremo
      [T.ICE]:  -16,       // "Glacial" — bloco frio
      [T.LAVA]:  16,       // bloco quente (ajuste os valores à vontade)
    },
  },
};

let modifierFields = {}; // modifierFields[dim][nomeDoModificador] = Float32Array

function _vizinhos4(tx, ty){
  return [[tx+1,ty],[tx-1,ty],[tx,ty+1],[tx,ty-1]];
}

// BFS multi-origem: todas as fontes entram na fila de uma vez, e a cada
// salto pro vizinho o valor é multiplicado por `decaimento` — é o
// "compartilha a metade" pedido (-16 → -8 → -4 → -2 → -1, parando antes
// de -1 por causa de `magnitudeMinima`). A fonte original nunca é
// sobrescrita: ela é a primeira coisa gravada na fila, com o valor cheio,
// antes de qualquer vizinho ser visitado.
function _propagarModificador(wg, W, H, def){
  const field = new Float32Array(W * H);
  const fila = [];

  for(let ty=0; ty<H; ty++){
    for(let tx=0; tx<W; tx++){
      const idx = wi(tx,ty);
      const base = def.fontes[wg[idx]];
      if(base !== undefined){
        field[idx] = base;
        fila.push([tx, ty, base]);
      }
    }
  }

  let cabeca = 0;
  while(cabeca < fila.length){
    const [tx,ty,valor] = fila[cabeca++];
    const proximo = valor * def.decaimento;
    if(Math.abs(proximo) < def.magnitudeMinima) continue;

    for(const [nx,ny] of _vizinhos4(tx,ty)){
      if(nx<0||ny<0||nx>=W||ny>=H) continue;
      const nidx = wi(nx,ny);
      const atual = field[nidx];
      // Se duas fontes disputam a mesma célula, vence a mais extrema.
      // 0 é tratado como "ainda vazio": nenhuma fonte decai até chegar
      // exatamente em 0 antes de parar em magnitudeMinima, então não há
      // ambiguidade com uma célula que legitimamente valesse 0.
      if(atual === 0 || Math.abs(proximo) > Math.abs(atual)){
        field[nidx] = proximo;
        fila.push([nx, ny, proximo]);
      }
    }
  }

  return field;
}

function applyModifiers(wg){
  const W = WORLD_W, H = WORLD_H;
  modifierFields[DIM.SURFACE] = {};
  for(const nome of Object.keys(MODIFIER_DEFS)){
    modifierFields[DIM.SURFACE][nome] = _propagarModificador(wg, W, H, MODIFIER_DEFS[nome]);
  }
}

// Helper público — ainda não usado no resto do jogo, só preparado para
// quando quiser ligar isso em algo (ver pedido original: "funciona
// apenas na geração de mundo" por enquanto).
function getTileModifier(nome, tx, ty){
  const campos = modifierFields[DIM.SURFACE];
  if(!campos || !campos[nome]) return 0;
  return campos[nome][wi(tx, ty)];
}

/* ─────────────────────────────────────────────────────────────
   PATCH AUTOMÁTICO
   Sobrescreve a geração de superfície quando generateWorld()
   for chamado, sem alterar o game.js original.
   ───────────────────────────────────────────────────────────── */
(function patchWorldGen() {
  // Este arquivo é carregado APÓS game.js no index.html.
  // A função generateSurface() declarada acima sobrescreve
  // a do game.js no escopo global, pois scripts síncronos
  // executam em ordem e a última declaração de função prevalece.
  if (typeof console !== 'undefined') {
    console.log('[world-gen.js] Sistema climático v3.2 carregado.');
    console.log('[world-gen.js] Camadas: continente · temperatura · umidade · altitude · erosão · estranheza · corrupção · vulcanismo');
    console.log('[world-gen.js] v3.2: menos sólido no total, alterador probabilístico (pântano+água) e modificador de temperatura por tile.');
  }
})();
