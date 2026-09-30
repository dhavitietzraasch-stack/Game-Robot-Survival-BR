/**
 * mobile-controls.js
 * Controles mobile: joystick analógico, botões de ação (🔫 tiro on/off e
 * 🌀 teleporte) e repasse de toque pro canvas. Também tenta colocar o celular
 * na horizontal (fullscreen + screen.orientation.lock) e, se o navegador não
 * deixar (ex: iPhone/Safari), mostra um aviso pedindo pra girar o aparelho.
 *
 * Só entra em ação em dispositivo móvel de verdade (toque + ponteiro
 * "grosso" como principal) — em PC/notebook, mesmo com tela touch, este
 * arquivo não injeta nada. A detecção fica em `window.IS_MOBILE_DEVICE`,
 * que game.js também lê (via `typeof`, com fallback seguro).
 *
 * O joystick escreve a direção em `window.analogMove` ({x,y} de -1 a 1, com
 * zona morta) — game.js lê isso em updateRobot(). Os controles só ficam
 * visíveis enquanto uma partida está rodando (mesmo mostrar/esconder do #hud).
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
        if (!window.IS_MOBILE_DEVICE) return; // nada de joystick fora de mobile

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    init() {
        window.analogMove = { x: 0, y: 0 };
        this.createJoystick();
        this.createActionButtons();
        this.createRotateHint();
        this.setupOrientation();
        this.setupCanvasTouch();
        this.syncVisibilityWithHud();
    }

    // ── Joystick analógico ─────────────────────────────────────────
    // Base fixa no canto inferior esquerdo; o "knob" segue o dedo dentro de
    // um raio e a intensidade (0..1) vira a força do movimento. Rastreia o
    // dedo pelo `identifier`, então dá pra mexer o stick e tocar nos botões
    // da direita ao mesmo tempo.
    createJoystick() {
        const SIZE = 136, KNOB = 58;
        this.stickMaxR = 46;   // quanto o knob pode se afastar do centro (px)
        this.stickDead = 0.14; // zona morta (fração do raio)
        this.stickId = null;

        const base = document.createElement('div');
        base.id = 'mobile-joystick';
        this.stickEl = base;
        Object.assign(base.style, {
            position: 'fixed',
            left: 'calc(26px + env(safe-area-inset-left, 0px))',
            bottom: 'calc(22px + env(safe-area-inset-bottom, 0px))',
            width: SIZE + 'px',
            height: SIZE + 'px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,40,70,0.35) 0%, rgba(0,20,40,0.55) 100%)',
            border: '2px solid rgba(0, 255, 255, 0.35)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45), inset 0 0 18px rgba(0, 255, 255, 0.08)',
            zIndex: '9999',
            display: 'none', // syncVisibilityWithHud() decide quando mostrar
            userSelect: 'none',
            WebkitUserSelect: 'none',
            touchAction: 'none'
        });

        const knob = document.createElement('div');
        this.knobEl = knob;
        Object.assign(knob.style, {
            position: 'absolute',
            left: ((SIZE - KNOB) / 2 - 2) + 'px', // -2 compensa a borda da base
            top: ((SIZE - KNOB) / 2 - 2) + 'px',
            width: KNOB + 'px',
            height: KNOB + 'px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%, rgba(120,255,255,0.55), rgba(0,200,230,0.3))',
            border: '2px solid rgba(0, 255, 255, 0.85)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
            pointerEvents: 'none',
            willChange: 'transform'
        });
        base.appendChild(knob);
        document.body.appendChild(base);

        const findTouch = (list) => {
            for (let i = 0; i < list.length; i++) {
                if (list[i].identifier === this.stickId) return list[i];
            }
            return null;
        };

        base.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.stickId !== null) return; // já tem um dedo no stick
            const t = e.changedTouches[0];
            this.stickId = t.identifier;
            this.updateStick(t);
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (this.stickId === null) return;
            const t = findTouch(e.changedTouches);
            if (!t) return;
            e.preventDefault();
            this.updateStick(t);
        }, { passive: false });

        const end = (e) => {
            if (this.stickId === null) return;
            if (!findTouch(e.changedTouches)) return;
            e.preventDefault();
            this.resetStick();
        };
        document.addEventListener('touchend', end, { passive: false });
        document.addEventListener('touchcancel', end, { passive: false });
    }

    updateStick(touch) {
        const r = this.stickEl.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let dx = touch.clientX - cx, dy = touch.clientY - cy;
        const dist = Math.hypot(dx, dy);
        const R = this.stickMaxR;
        const clamped = Math.min(dist, R);
        const ux = dist > 0 ? dx / dist : 0, uy = dist > 0 ? dy / dist : 0;

        this.knobEl.style.transform = `translate(${ux * clamped}px, ${uy * clamped}px)`;

        const norm = clamped / R;
        if (norm < this.stickDead) {
            window.analogMove = { x: 0, y: 0 };
        } else {
            const mag = (norm - this.stickDead) / (1 - this.stickDead); // 0..1 já sem a zona morta
            window.analogMove = { x: ux * mag, y: uy * mag };
        }
    }

    resetStick() {
        this.stickId = null;
        window.analogMove = { x: 0, y: 0 };
        if (this.knobEl) this.knobEl.style.transform = 'translate(0px, 0px)';
    }

    // Botões do lado direito (acima do minimapa): 🔫 liga/desliga o tiro e
    // 🌀 teleporte (pausa o jogo e o jogador toca no destino). O jogo expõe
    // as ações em window.gameMobileAPI (game.js) — este arquivo só desenha e
    // repassa o toque.
    createActionButtons() {
        const wrap = document.createElement('div');
        wrap.id = 'mobile-actions';
        this.actionsEl = wrap;
        Object.assign(wrap.style, {
            position: 'fixed',
            right: 'calc(10px + env(safe-area-inset-right, 0px))',
            bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))',
            zIndex: '9999',
            display: 'none',
            flexDirection: 'row',
            gap: '10px',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            touchAction: 'none'
        });

        this.teleBtn = this.createRoundButton('🌀', 'Teleporte', () => {
            const api = window.gameMobileAPI;
            if (api) api.toggleTeleportTargeting();
        });
        this.fireBtn = this.createRoundButton('🔫', 'Ligar/desligar tiro', () => {
            const api = window.gameMobileAPI;
            if (api) api.toggleFire();
        });
        // teleporte à esquerda, tiro no canto direito
        wrap.appendChild(this.teleBtn);
        wrap.appendChild(this.fireBtn);
        document.body.appendChild(wrap);

        // Estado visual (tiro off, teleporte bloqueado/recarga/mirando)
        setInterval(() => this.refreshActionButtons(), 120);
    }

    createRoundButton(text, label, onTap) {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.setAttribute('aria-label', label);
        Object.assign(btn.style, {
            width: '58px',
            height: '58px',
            fontSize: '26px',
            borderRadius: '50%',
            background: 'rgba(0, 20, 40, 0.7)',
            color: '#0ff',
            border: '2px solid rgba(0, 255, 255, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0',
            boxShadow: '0 4px 10px rgba(0, 0, 0, 0.5)',
            transition: 'background 0.12s ease, transform 0.1s ease, border-color 0.12s ease, opacity 0.12s ease',
            outline: 'none',
            cursor: 'pointer'
        });
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault(); // sem clique fantasma
            btn.style.transform = 'scale(0.92)';
            onTap();
        }, { passive: false });
        const release = (e) => { e.preventDefault(); btn.style.transform = 'scale(1)'; };
        btn.addEventListener('touchend', release, { passive: false });
        btn.addEventListener('touchcancel', release, { passive: false });
        return btn;
    }

    refreshActionButtons() {
        const api = window.gameMobileAPI;
        if (!api || !this.fireBtn || !this.teleBtn) return;

        const fireOff = api.isFireDisabled();
        this.fireBtn.textContent = fireOff ? '🚫' : '🔫';
        this.fireBtn.style.borderColor = fireOff ? 'rgba(248, 113, 113, 0.9)' : 'rgba(0, 255, 255, 0.4)';
        this.fireBtn.style.background = fireOff ? 'rgba(80, 10, 10, 0.75)' : 'rgba(0, 20, 40, 0.7)';

        const t = api.teleportState();
        this.teleBtn.textContent = t.targeting ? '✕' : '🌀';
        this.teleBtn.style.opacity = (!t.owned || t.disabled) ? '0.35' : (t.cooling ? '0.6' : '1');
        this.teleBtn.style.borderColor = t.targeting ? 'rgba(125, 211, 252, 1)' : 'rgba(0, 255, 255, 0.4)';
        this.teleBtn.style.background = t.targeting ? 'rgba(56, 189, 248, 0.35)' : 'rgba(0, 20, 40, 0.7)';
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

    // Os controles só fazem sentido durante a partida — escondidos no menu, nas
    // telas de fim de jogo etc. Em vez de o jogo precisar saber que este
    // arquivo existe, observamos a classe do próprio #hud (que game.js já
    // alterna com show/hide) e espelhamos nos controles.
    syncVisibilityWithHud(){
        const hudEl = document.getElementById('hud');
        if(!hudEl || !this.stickEl) return;

        const apply = () => {
            const hudVisible = !hudEl.classList.contains('hidden');
            this.stickEl.style.display = hudVisible ? 'block' : 'none';
            if (this.actionsEl) this.actionsEl.style.display = hudVisible ? 'flex' : 'none';
            if (!hudVisible) this.resetStick();
            this.hudVisible = hudVisible;
            this.updateRotateHint();
        };
        apply();

        const observer = new MutationObserver(apply);
        observer.observe(hudEl, { attributes: true, attributeFilter: ['class'] });
    }

    // ── Orientação: paisagem ───────────────────────────────────────
    // 1) Ao tocar em Novo Jogo / Mundo Aleatório / Continuar / Jogar Novamente
    //    (gesto do usuário, exigido pelos navegadores), tenta fullscreen +
    //    travar em horizontal. Funciona no Chrome/Android; o Safari do iPhone
    //    não suporta — aí cai no aviso do item 2.
    // 2) Se mesmo assim a tela estiver em pé durante a partida, mostra um
    //    aviso pedindo pra girar e pausa o jogo até girar (ou tocar em
    //    "Jogar assim mesmo").
    setupOrientation() {
        const ids = ['btnStart', 'btnRandom', 'btnContinue', 'btnRestart'];
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', () => this.enterLandscape(), true);
        });

        const refresh = () => this.updateRotateHint();
        window.addEventListener('resize', refresh);
        window.addEventListener('orientationchange', refresh);
        if (screen.orientation && screen.orientation.addEventListener) {
            screen.orientation.addEventListener('change', refresh);
        }
    }

    async enterLandscape() {
        try {
            const el = document.documentElement;
            if (!document.fullscreenElement && el.requestFullscreen) {
                await el.requestFullscreen({ navigationUI: 'hide' });
            }
        } catch (e) { /* fullscreen negado — segue sem */ }
        try {
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock('landscape');
            }
        } catch (e) { /* lock não suportado (iOS) — o aviso de girar cobre */ }
        this.updateRotateHint();
    }

    isPortrait() {
        return window.innerHeight > window.innerWidth;
    }

    createRotateHint() {
        const box = document.createElement('div');
        box.id = 'mobile-rotate-hint';
        this.rotateEl = box;
        this.rotateDismissed = false;
        Object.assign(box.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '10002',
            display: 'none',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '14px',
            background: 'rgba(2, 5, 14, 0.94)',
            color: '#cfeeff',
            fontFamily: "'Share Tech Mono', monospace",
            textAlign: 'center',
            padding: '24px'
        });

        const icon = document.createElement('div');
        icon.textContent = '📱';
        Object.assign(icon.style, { fontSize: '54px', transform: 'rotate(90deg)' });

        const msg = document.createElement('div');
        msg.textContent = 'Gire o celular para a horizontal';
        Object.assign(msg.style, { fontSize: '16px', letterSpacing: '0.08em', color: '#00e5ff' });

        const sub = document.createElement('div');
        sub.textContent = 'O jogo fica pausado até você girar a tela.';
        Object.assign(sub.style, { fontSize: '11px', opacity: '0.7' });

        const skip = document.createElement('button');
        skip.textContent = 'Jogar assim mesmo';
        Object.assign(skip.style, {
            marginTop: '8px',
            padding: '10px 18px',
            fontFamily: 'inherit',
            fontSize: '11px',
            color: '#9bd8ee',
            background: 'transparent',
            border: '1px solid rgba(0, 229, 255, 0.35)',
            borderRadius: '8px'
        });
        skip.addEventListener('click', () => {
            this.rotateDismissed = true;
            this.updateRotateHint();
        });

        box.append(icon, msg, sub, skip);
        document.body.appendChild(box);
    }

    updateRotateHint() {
        if (!this.rotateEl) return;
        const portrait = this.isPortrait();
        if (!portrait) this.rotateDismissed = false; // girou: volta a avisar da próxima vez
        const show = !!this.hudVisible && portrait && !this.rotateDismissed;
        this.rotateEl.style.display = show ? 'flex' : 'none';
        // Pausa pelo sistema de motivos do game.js (não destrava outras pausas)
        if (show && typeof addPause === 'function') addPause('rotate');
        else if (typeof removePause === 'function') removePause('rotate');
    }
}

// Arranca o sistema de controles assim que o script for lido — o próprio
// construtor decide se faz alguma coisa (só em mobile).
new MobileControls();
