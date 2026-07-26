/* ============================================================
   SIGNAL LOST — quality.js
   Nível de qualidade gráfica: 6 degraus (Batata → Muito Alto).
   Controla brilho (shadowBlur), volume de partículas e o detalhe
   decorativo por tile — os três pontos mais caros do draw() a
   cada frame — além de ligar/desligar a vinheta de status por
   borda de tela (calor/vida/energia/pressão de onda), que fica
   OFF por padrão (Médio, igual ao comportamento atual do jogo)
   e só liga em Alto/Muito Alto.

   Carregado ANTES de game.js (mesmo padrão de biomes.js/daynight.js):
   game.js referencia QUALITY e Q() diretamente, sem checagem de
   'typeof', porque este arquivo é uma dependência obrigatória —
   igual biomes.js, não um add-on opcional como daynight.js.
   ============================================================ */
'use strict';

const QUALITY_PRESETS = {
  batata: {
    label: '🥔 Batata',
    hint: 'Máximo desempenho: sem brilho, partículas mínimas, sem detalhe de terreno.',
    glow: false, glowScale: 0,
    particleScale: 0.2, particleCap: 120,
    tileDetail: false,
    screenEdgeFX: false,
  },
  muitobaixo: {
    label: '▁ Muito Baixo',
    hint: 'Foco em desempenho: brilho desligado, partículas bem reduzidas.',
    glow: false, glowScale: 0,
    particleScale: 0.4, particleCap: 300,
    tileDetail: false,
    screenEdgeFX: false,
  },
  baixo: {
    label: '▂ Baixo',
    hint: 'Brilho suavizado, menos partículas, detalhe de terreno de volta.',
    glow: true, glowScale: 0.5,
    particleScale: 0.65, particleCap: 550,
    tileDetail: true,
    screenEdgeFX: false,
  },
  medio: {
    label: '▄ Médio',
    hint: 'Padrão do jogo: equilíbrio entre desempenho e efeitos visuais.',
    glow: true, glowScale: 1,
    particleScale: 1, particleCap: 900,
    tileDetail: true,
    screenEdgeFX: false,
  },
  alto: {
    label: '▆ Alto',
    hint: 'Tudo do Médio + vinheta de status nas bordas da tela (calor/vida/energia/pressão de onda).',
    glow: true, glowScale: 1,
    particleScale: 1, particleCap: 900,
    tileDetail: true,
    screenEdgeFX: true,
  },
  // "Muito Alto" é um espelho intencional de "Alto": não existe nenhum
  // efeito extra acima do que Alto já liga — a vinheta de status por
  // borda de tela é o teto de fidelidade visual do jogo. O nível existe
  // só porque quem mexe em configurações costuma procurar a opção
  // "máxima" da lista; aqui ele apenas confirma que Alto já é o topo,
  // sem gastar desempenho a mais por isso.
  muitoalto: {
    label: '█ Muito Alto',
    hint: 'Idêntico ao Alto — este é o teto, não tem mais nada acima pra ligar.',
    glow: true, glowScale: 1,
    particleScale: 1, particleCap: 900,
    tileDetail: true,
    screenEdgeFX: true,
  },
};

const QUALITY = { level: 'medio', ...QUALITY_PRESETS.medio };

function setQuality(level) {
  const p = QUALITY_PRESETS[level];
  if (!p) return;
  QUALITY.level = level;
  Object.assign(QUALITY, p);
}

// Aplica o glowScale do preset atual a um valor de shadowBlur; retorna 0
// (brilho totalmente desligado) quando QUALITY.glow=false. Usado no lugar
// de `ctx.shadowBlur=<valor>` em todo o game.js.
function Q(blurValue) {
  return QUALITY.glow ? blurValue * QUALITY.glowScale : 0;
}

// ─── Wiring da UI (painel de Configurações, na tela de menu) ─────
document.querySelectorAll('.quality-btn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.quality-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    setQuality(b.dataset.quality);
    const hintEl = document.getElementById('qualityHint');
    if (hintEl) hintEl.textContent = QUALITY_PRESETS[b.dataset.quality].hint;
  });
});
