/**
 * mobile-controls.js
 * Sistema de controles mobile (D-pad + repasse de toque pro canvas).
 *
 * Só entra em ação em dispositivo móvel de verdade (toque + ponteiro
 * "grosso" como principal) — em PC/notebook, mesmo com tela touch, este
 * arquivo não injeta nada. A detecção fica em `window.IS_MOBILE_DEVICE`,
 * que game.js também lê (via `typeof`, com fallback seguro) pra afastar o
 * HUD de armas/teleporte do D-pad na tela.
 *
 * O D-pad só fica visível enquanto uma partida está rodando (mesmo
 * mostrar/esconder do #hud) — não aparece por cima do menu.
 */
'use strict';

function _detectMobileDevice(){
  const hasTouch = ('ontouchstart' in window) ||
                   (navigator.maxTouchPoints > 0) ||
                   (navigator.msMaxTouchPoints > 0);
  const coarsePointer = typeof window.matchMedia === 'function' &&
                        window.matchMedia('(pointer: coarse)').matches;
  // Exige as duas condições: só toque não basta (ex: notebook touch com
  // mouse como ponteiro principal continua sendo "fine"), e só pointer
  // grosso sem toque também não deveria acontecer, mas não custa checar.
  return hasTouch && coarsePointer;
}

window.IS_MOBILE_DEVICE = _detectMobileDevice();

class MobileControls {
    constructor() {
        if (!window.IS_MOBILE_DEVICE) return; // nada de D-pad fora de mobile

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    init() {
        this.createDPad();
        this.setupCanvasTouch();
        this.syncVisibilityWithHud();
    }

    createDPad() {
        const touchUI = document.createElement('div');
        touchUI.id = 'mobile-dpad';
        this.dpadEl = touchUI;

        // Estilo otimizado, responsivo e seguro contra toques duplos/zoom.
        // bottom/left somam a área segura (notch/home-indicator) via env().
        Object.assign(touchUI.style, {
            position: 'fixed',
            bottom: 'calc(40px + env(safe-area-inset-bottom, 0px))',
            left: 'calc(20px + env(safe-area-inset-left, 0px))',
            zIndex: '9999',
            display: 'none', // syncVisibilityWithHud() decide quando mostrar
            gridTemplateColumns: 'repeat(3, 70px)',
            gridTemplateRows: 'repeat(2, 70px)',
            gap: '10px',
            userSelect: 'none',
            WebkitUserSelect: 'none', // Previne seleção no iOS
            touchAction: 'none'       // Evita scroll/zoom no D-Pad
        });

        const keys = [
            { text: '⬆️', key: 'ArrowUp', col: 2, row: 1 },
            { text: '⬅️', key: 'ArrowLeft', col: 1, row: 2 },
            { text: '⬇️', key: 'ArrowDown', col: 2, row: 2 },
            { text: '➡️', key: 'ArrowRight', col: 3, row: 2 }
        ];

        keys.forEach(k => {
            const btn = this.createButton(k.text, k.key, k.col, k.row);
            touchUI.appendChild(btn);
        });

        document.body.appendChild(touchUI);
    }

    createButton(text, keyName, col, row) {
        const btn = document.createElement('button');
        btn.innerHTML = text;

        // Estilos modernos do botão com transições para animação
        Object.assign(btn.style, {
            gridColumn: col,
            gridRow: row,
            fontSize: '32px',
            background: 'rgba(0, 20, 40, 0.7)', // Fundo escuro levemente azulado
            color: '#0ff',
            border: '2px solid rgba(0, 255, 255, 0.4)',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 10px rgba(0, 0, 0, 0.5)',
            transition: 'background 0.1s ease, transform 0.1s ease, border-color 0.1s ease',
            outline: 'none',
            cursor: 'pointer'
        });

        // Disparador de eventos de teclado simulando o PC
        const triggerKey = (type) => {
            window.dispatchEvent(new KeyboardEvent(type, {
                key: keyName,
                code: keyName,
                bubbles: true
            }));
        };

        // Eventos de Toque com feedback visual (brilho e "afundamento")
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Impede clique fantasma do mobile
            btn.style.background = 'rgba(0, 255, 255, 0.3)';
            btn.style.borderColor = 'rgba(0, 255, 255, 1)';
            btn.style.transform = 'scale(0.92)'; // Botão "afunda"
            triggerKey('keydown');
        }, { passive: false });

        const releaseKey = (e) => {
            e.preventDefault();
            btn.style.background = 'rgba(0, 20, 40, 0.7)'; // Volta ao normal
            btn.style.borderColor = 'rgba(0, 255, 255, 0.4)';
            btn.style.transform = 'scale(1)'; // Botão levanta
            triggerKey('keyup');
        };

        // Trata tanto quando o dedo solta quanto quando o dedo escorrega para fora do botão
        btn.addEventListener('touchend', releaseKey, { passive: false });
        btn.addEventListener('touchcancel', releaseKey, { passive: false });

        return btn;
    }

    setupCanvasTouch() {
        // Usamos delegação de eventos no document.
        // Assim, não importa em que momento o `#gameCanvas` é renderizado na tela.
        document.addEventListener('touchstart', (e) => {
            // Se o dedo tocou exatamente em cima do canvas do jogo...
            if (e.target && e.target.id === 'gameCanvas') {
                const touch = e.touches[0];
                const mouseEvent = new MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                e.target.dispatchEvent(mouseEvent);
            }
        }, { passive: false });

        document.addEventListener('touchend', (e) => {
            if (e.target && e.target.id === 'gameCanvas') {
                const mouseEvent = new MouseEvent('mouseup', {
                    bubbles: true,
                    cancelable: true
                });
                e.target.dispatchEvent(mouseEvent);
            }
        }, { passive: false });
    }

    // O D-pad só faz sentido durante a partida — escondido no menu, nas
    // telas de fim de jogo etc. Em vez de o jogo precisar saber que este
    // arquivo existe, observamos a classe do próprio #hud (que game.js já
    // alterna com show/hide) e espelhamos no D-pad.
    syncVisibilityWithHud(){
        const hudEl = document.getElementById('hud');
        if(!hudEl || !this.dpadEl) return;

        const apply = () => {
            const hudVisible = !hudEl.classList.contains('hidden');
            this.dpadEl.style.display = hudVisible ? 'grid' : 'none';
        };
        apply();

        const observer = new MutationObserver(apply);
        observer.observe(hudEl, { attributes: true, attributeFilter: ['class'] });
    }
}

// Arranca o sistema de controles assim que o script for lido — o próprio
// construtor decide se faz alguma coisa (só em mobile).
new MobileControls();
