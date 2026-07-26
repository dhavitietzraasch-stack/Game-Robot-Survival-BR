// modificadores-mundo.js
// Ordem de geração + alteradores de bioma + sistema de modificadores.
// Vanilla JS, sem módulos — cole as partes que quiser dentro de world-gen.js.
// Ajuste os nomes de bioma abaixo para bater com os que já existem em biomes.js
// (usei: floresta, gracial, agua, praia, pantano, planicie, montanha).

// ─────────────────────────────────────────────
// 1) CHANCE DE SÓLIDO POR BIOMA
// ─────────────────────────────────────────────
// Valores baixos = menos pedra. São só ponto de partida — ajuste testando.
const CHANCE_SOLIDO_POR_BIOMA = {
  floresta: 0.05,
  gracial: 0.05,
  agua: 0,        // água nunca vira sólido por conta própria
  praia: 0.04,
  pantano: 0.12,
  planicie: 0.20,
  montanha: 0.45,
};
const CHANCE_SOLIDO_PADRAO = 0.12; // bioma que não está na lista acima

// ─────────────────────────────────────────────
// 2) ALTERADOR: pântano encostado em água → pedra
// ─────────────────────────────────────────────
const CHANCE_PANTANO_VIRA_PEDRA = 0.20; // 20/100

function vizinhos4(x, y) {
  return [
    { x: x + 1, y }, { x: x - 1, y },
    { x, y: y + 1 }, { x, y: y - 1 },
  ];
}

function encostaEmAgua(grid, x, y) {
  return vizinhos4(x, y).some(({ x: nx, y: ny }) => {
    const vizinho = grid[ny] && grid[ny][nx];
    return vizinho && vizinho.bioma === 'agua';
  });
}

// ─────────────────────────────────────────────
// 3) SISTEMA DE MODIFICADORES (genérico) — temperatura é o primeiro
// ─────────────────────────────────────────────
// Cada bloco carrega um objeto `modificadores` onde qualquer atributo futuro
// pode entrar (temperatura, umidade, radiação...). Hoje só temperatura roda.

const DECAIMENTO = 0.5;      // cada vizinho recebe metade do valor anterior
const MAGNITUDE_MINIMA = 1;  // abaixo disso, para de propagar

// Biomas/blocos que nascem com temperatura extrema (âncoras).
// O bloco-fonte NUNCA perde esse valor — só os vizinhos herdam a metade.
const FONTES_DE_TEMPERATURA = {
  gracial: -16,
  lava: 16,
};

function aplicarModificadorTemperatura(grid) {
  const altura = grid.length;
  const largura = grid[0].length;
  const fila = [];

  // Semeia a fila com todas as fontes de uma vez (BFS multi-origem,
  // então duas fontes próximas se espalham "ao mesmo tempo")
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const bloco = grid[y][x];
      const base = FONTES_DE_TEMPERATURA[bloco.bioma];
      if (base !== undefined) {
        bloco.modificadores.temperatura = base;
        fila.push({ x, y, valor: base });
      }
    }
  }

  let cabeca = 0;
  while (cabeca < fila.length) {
    const { x, y, valor } = fila[cabeca++];
    const proximoValor = valor * DECAIMENTO;
    if (Math.abs(proximoValor) < MAGNITUDE_MINIMA) continue;

    for (const { x: nx, y: ny } of vizinhos4(x, y)) {
      if (nx < 0 || nx >= largura || ny < 0 || ny >= altura) continue;
      const vizinho = grid[ny][nx];
      const atual = vizinho.modificadores.temperatura;

      // se duas fontes disputam a mesma célula, vence a mais extrema
      if (atual === undefined || Math.abs(proximoValor) > Math.abs(atual)) {
        vizinho.modificadores.temperatura = proximoValor;
        fila.push({ x: nx, y: ny, valor: proximoValor });
      }
    }
  }
}

// ─────────────────────────────────────────────
// 4) GERAÇÃO COMPLETA
//    ordem: não-sólido → sólido → alteradores → modificadores
// ─────────────────────────────────────────────
function gerarMundo(largura, altura, funcaoDeBioma, criarBlocoNaoSolido) {
  const grid = [];

  // PASSO 1 — blocos não sólidos primeiro (fecha o mapa de biomas inteiro
  // antes de decidir qualquer sólido, porque o passo 2 e o alterador do
  // passo 3 precisam olhar os vizinhos já definidos)
  for (let y = 0; y < altura; y++) {
    grid[y] = [];
    for (let x = 0; x < largura; x++) {
      const bioma = funcaoDeBioma(x, y); // ex: 'floresta', 'agua', 'pantano'...
      grid[y][x] = {
        bioma,
        solido: false,
        tipoDeBloco: criarBlocoNaoSolido(bioma),
        modificadores: {},
      };
    }
  }

  // PASSO 2 — blocos sólidos, chance por bioma
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const celula = grid[y][x];
      const chance = CHANCE_SOLIDO_POR_BIOMA[celula.bioma] ?? CHANCE_SOLIDO_PADRAO;
      if (Math.random() < chance) {
        celula.solido = true;
        celula.tipoDeBloco = 'pedra';
      }
    }
  }

  // PASSO 3 — alteradores (regras de transição entre biomas)
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const celula = grid[y][x];
      if (celula.bioma === 'pantano' && !celula.solido && encostaEmAgua(grid, x, y)) {
        if (Math.random() < CHANCE_PANTANO_VIRA_PEDRA) {
          celula.solido = true;
          celula.tipoDeBloco = 'pedra';
        }
      }
    }
  }

  // PASSO 4 — modificadores (só roda na geração, nunca durante o jogo)
  aplicarModificadorTemperatura(grid);

  return grid;
}
