// assets/local.js — script de exemplo do painel dev (tecla F3).
// Esse arquivo é o que ATIVA o painel: se você apagar/renomear ele,
// o painel some por completo. Edite à vontade e clique em
// "Recarregar local.js" no painel pra aplicar sem reiniciar o jogo.
//
// Lembrete de sintaxe (documentação completa no topo de dev-panel.js):
//   zone NOME = circle(cx, cy, raio);
//   zone NOME = rect(x1, y1, x2, y2);
//   effect NOME to @s;
//   if CONDIÇÃO: AÇÃO, AÇÃO, ...;
// LIFE / ENERGY / HEAT sempre maiúsculo. Coordenadas de zone em pixels
// do mundo (mesmo espaço de robot.x/robot.y — 1 tile = 32px).

// autoheal: se a vida cair abaixo de 50%, recupera 10% e espera
// 1 dev-tick (500ms) antes de poder disparar de novo.
if HEAT < 100%: HEAT-100%, tick(5);
if ENERGY < 100%: ENERGY+100%, tick(3);

// exemplo de zona + condição "@s in X": uma área de 300px de raio
// perto da origem do mapa que esfria o robô enquanto ele estiver lá.
zone COOLZONE = circle(30, 30, 3000);
if @s in COOLZONE: effect regen to @s, tick(1);
