/* ================================================================
   SOLARIS — SCRIPT.JS
   Página pública • Interações • Supabase • Analytics

   Arquitetura:
   01. Configuração
   02. Estado
   03. Utilitários
   04. Supabase / API
   05. Tema
   06. Navegação
   07. Carrossel
   08. Sistemas
   09. Simulador
   10. Brasil
   11. Formulário
   12. Analytics
   13. Toast / Feedback
   14. Rodapé
   15. Inicialização

   IMPORTANTE:
   - Este arquivo pertence SOMENTE ao site público.
   - O painel administrativo usa admin.js e admin.css próprios.
   - Nenhuma regra, consulta ou autenticação administrativa fica aqui.
   - Os nomes abaixo correspondem ao index.html atual.
================================================================ */

(() => {
    "use strict";

    const SOLARIS_PUBLIC_JS_VERSION = "2026.10.01-public-v3";
    document.documentElement.dataset.solarisJs = SOLARIS_PUBLIC_JS_VERSION;

    /* ============================================================
       01. CONFIGURAÇÃO
    ============================================================ */

    const CONFIG = Object.freeze({
        supabase: Object.freeze({
            url: "https://tvkocnjtdnvjovzafvyf.supabase.co",
            key: "sb_publishable_3Q1XsL7LctLHRE3y-r7OGw_SnREkSpj"
        }),

        backend: Object.freeze({
            brazilTable: "dados_brasil",
            messageRpc: "enviar_mensagem",
            sessionsTable: "sessoes",
            analyticsTable: "eventos_analytics"
        }),

        limits: Object.freeze({
            requestTimeout: 10000,
            analyticsBatchDelay: 700,
            messageCooldown: 30000,
            carouselSwipeThreshold: 44,
            toastDuration: 4200,
            analyticsBatchMax: 25,
            analyticsQueueMax: 80,
            analyticsRetryLimit: 2
        }),

        storage: Object.freeze({
            theme: "solaris-theme",
            sessionId: "solaris-session-id",
            pageViewPrefix: "solaris-page-view",
            lastMessage: "solaris-last-message"
        })
    });

    let supabaseClient = null;

    /* ============================================================
       02. ESTADO DA APLICAÇÃO
    ============================================================ */

    const state = {
        theme: "light",

        mobileMenu: {
            open: false
        },

        carousel: {
            index: 0,
            paused: false,
            timer: null,
            progressTimer: null,
            progressStartedAt: 0,
            duration: 8000,
            hoverPaused: false,
            focusPaused: false,
            touchStartX: null
        },

        simulator: {
            lastResult: null
        },

        brazil: {
            data: [],
            metric: "capacidade",
            usingFallback: false,
            loading: false,
            requestId: 0
        },

        analytics: {
            sessionId: null,
            pending: [],
            queue: [],
            flushTimer: null,
            flushing: false,
            initialized: false,
            pageViewTracked: false
        }
    };

    /* ============================================================
       03. UTILITÁRIOS
    ============================================================ */

    /*
     * Proteção de compatibilidade: caso uma versão anterior do script seja
     * carregada junto com esta, garantimos que o estado do Brasil exista
     * antes de qualquer leitura em loadBrazilData().
     */
    state.brasil ??= {
        data: [],
        metric: "capacidade",
        usingFallback: false,
        loading: false,
        requestId: 0
    };

    const $ = (selector, context = document) => {
        try {
            return context.querySelector(selector);
        } catch {
            return null;
        }
    };

    const $$ = (selector, context = document) => {
        try {
            return [...context.querySelectorAll(selector)];
        } catch {
            return [];
        }
    };

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const toNumber = (value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const formatNumber = (value, digits = 1) => new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits
    }).format(toNumber(value));

    const escapeHtml = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const safeUrl = (value) => {
        if (!value) return null;

        try {
            const url = new URL(String(value), window.location.href);
            if (!["http:", "https:"].includes(url.protocol)) return null;
            return url.href;
        } catch {
            return null;
        }
    };


    const withTimeout = async (promise, ms = CONFIG.limits.requestTimeout) => {
        let timeoutId = null;

        const timeout = new Promise((_, reject) => {
            timeoutId = window.setTimeout(() => {
                reject(new Error("Tempo limite excedido."));
            }, ms);
        });

        try {
            return await Promise.race([promise, timeout]);
        } finally {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        }
    };

    const prefersReducedMotion = () => {
        return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    };

    const safeStorage = {
        get(storage, key) {
            try {
                return storage?.getItem(key) ?? null;
            } catch {
                return null;
            }
        },

        set(storage, key, value) {
            try {
                storage?.setItem(key, value);
                return true;
            } catch {
                return false;
            }
        },

        remove(storage, key) {
            try {
                storage?.removeItem(key);
                return true;
            } catch {
                return false;
            }
        }
    };

    const announce = (element, text) => {
        if (element) element.textContent = text;
    };

    const setHidden = (element, hidden) => {
        if (!element) return;
        element.hidden = Boolean(hidden);
    };

    const generateUuid = () => {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();

        if (window.crypto?.getRandomValues) {
            const bytes = new Uint8Array(16);
            window.crypto.getRandomValues(bytes);
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;

            const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
            return [
                hex.slice(0, 4).join(""),
                hex.slice(4, 6).join(""),
                hex.slice(6, 8).join(""),
                hex.slice(8, 10).join(""),
                hex.slice(10, 16).join("")
            ].join("-");
        }

        const random = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
        return `${random()}${random()}-${random()}-4${random().slice(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${random().slice(1)}-${random()}${random()}${random()}`;
    };

    const isValidEmail = (value) => {
        const normalized = String(value || "").trim();
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
    };

    const getPageName = () => {
        const pathname = window.location.pathname || "/";
        return pathname || "/";
    };

    /* ============================================================
       04. SUPABASE / API
    ============================================================ */

    function createSupabaseClient() {
        if (!window.supabase?.createClient) {
            console.warn("Solaris: biblioteca do Supabase não encontrada.");
            return null;
        }

        try {
            return window.supabase.createClient(
                CONFIG.supabase.url,
                CONFIG.supabase.key,
                {
                    auth: {
                        persistSession: false,
                        autoRefreshToken: false,
                        detectSessionInUrl: false
                    }
                }
            );
        } catch (error) {
            console.error("Solaris: não foi possível criar o cliente Supabase.", error);
            return null;
        }
    }

    async function apiSelectBrazil() {
        if (!supabaseClient) {
            throw new Error("Supabase indisponível.");
        }

        /*
         * A consulta usa a tabela principal diretamente e traz a fonte pela
         * relação FK. Isso evita depender da view para a camada pública e
         * mantém o mesmo conjunto de informações usado pelo gráfico.
         */
        return withTimeout(
            supabaseClient
                .from(CONFIG.backend.brazilTable)
                .select(`
                    ano,
                    capacidade_gw,
                    geracao_twh,
                    participacao_percentual,
                    fonte_id,
                    fonte:fontes (
                        instituicao,
                        titulo,
                        ano,
                        url
                    )
                `)
                .order("ano", { ascending: true })
        );
    }

    async function apiSendMessage(payload) {
        if (!supabaseClient) {
            throw new Error("Supabase indisponível.");
        }

        return withTimeout(
            supabaseClient.rpc(CONFIG.backend.messageRpc, payload)
        );
    }

    async function apiCreateSession(payload) {
        if (!supabaseClient) return null;

        const existing = safeStorage.get(window.sessionStorage, CONFIG.storage.sessionId);
        if (existing) {
            return {
                data: { id: existing },
                error: null
            };
        }

        /*
         * O visitante pode INSERT em sessoes, mas não precisa ler a linha.
         * O UUID é criado no navegador e devolvido localmente depois do INSERT.
         * Isso respeita o RLS atual e evita depender de SELECT público.
         */
        const id = generateUuid();

        const { error } = await withTimeout(
            supabaseClient
                .from(CONFIG.backend.sessionsTable)
                .insert({
                    id,
                    ...payload
                })
        );

        if (error) throw error;

        safeStorage.set(window.sessionStorage, CONFIG.storage.sessionId, id);

        return {
            data: { id },
            error: null
        };
    }

    async function apiSendAnalytics(events) {
        if (!supabaseClient || !Array.isArray(events) || !events.length) return;

        const cleanEvents = events
            .filter((event) => event && event.sessao_id && event.tipo)
            .map((event) => ({
                sessao_id: event.sessao_id,
                tipo: event.tipo,
                pagina: event.pagina || null,
                criado_em: event.criado_em || new Date().toISOString(),
                metadata: event.metadata && typeof event.metadata === "object"
                    ? event.metadata
                    : {}
            }));

        if (!cleanEvents.length) return;

        const { error } = await withTimeout(
            supabaseClient
                .from(CONFIG.backend.analyticsTable)
                .insert(cleanEvents)
        );

        if (error) throw error;
    }

    /* ============================================================
       05. TEMA
    ============================================================ */

    function initTheme() {
        const body = document.body;
        const button = $("#toggle-tema");
        const label = $("[data-theme-label]", button || document);
        const icon = $("span[aria-hidden]", button || document);
        const media = window.matchMedia?.("(prefers-color-scheme: dark)");

        if (!body) return;

        const getInitialTheme = () => {
            const stored = safeStorage.get(window.localStorage, CONFIG.storage.theme);
            if (stored === "dark" || stored === "light") return stored;
            return media?.matches ? "dark" : "light";
        };

        const applyTheme = (theme, persist = true) => {
            const normalized = theme === "dark" ? "dark" : "light";
            const isDark = normalized === "dark";

            state.theme = normalized;
            body.dataset.theme = normalized;

            button?.setAttribute("aria-pressed", String(isDark));
            button?.setAttribute(
                "aria-label",
                isDark ? "Ativar modo claro" : "Ativar modo escuro"
            );

            announce(label, isDark ? "Modo claro" : "Modo escuro");
            announce(icon, isDark ? "☀" : "☾");

            if (persist) {
                safeStorage.set(window.localStorage, CONFIG.storage.theme, normalized);
            }

            const themeMeta = $('meta[name="theme-color"]');
            themeMeta?.setAttribute("content", isDark ? "#0A100D" : "#01260A");
        };

        applyTheme(getInitialTheme(), false);

        button?.addEventListener("click", () => {
            applyTheme(state.theme === "dark" ? "light" : "dark", true);
        });

        media?.addEventListener?.("change", (event) => {
            if (!safeStorage.get(window.localStorage, CONFIG.storage.theme)) {
                applyTheme(event.matches ? "dark" : "light", false);
            }
        });
    }

    /* ============================================================
       06. NAVEGAÇÃO
    ============================================================ */

    function initNavigation() {
        const menuButton = $("#menu-toggle");
        const menu = $("#menu-principal");
        const explore = $(".nav-explore");

        const setMenu = (open) => {
            const shouldOpen = Boolean(open);

            state.mobileMenu.open = shouldOpen;
            setHidden(menu, !shouldOpen);
            menuButton?.setAttribute("aria-expanded", String(shouldOpen));
            menuButton?.setAttribute(
                "aria-label",
                shouldOpen ? "Fechar menu" : "Abrir menu"
            );

            const icon = $("span[aria-hidden]", menuButton || document);
            announce(icon, shouldOpen ? "×" : "☰");
            document.body.classList.toggle("menu-aberto", shouldOpen);
        };

        menuButton?.addEventListener("click", () => {
            setMenu(!state.mobileMenu.open);
        });

        $$('a[href^="#"]', menu || document).forEach((link) => {
            link.addEventListener("click", () => setMenu(false));
        });

        $$(".nav-explore-panel a", explore || document).forEach((link) => {
            link.addEventListener("click", () => {
                if (explore) explore.open = false;
            });
        });

        document.addEventListener("click", (event) => {
            const target = event.target;

            if (state.mobileMenu.open && menu && menuButton) {
                const clickedOutside = !menu.contains(target) && !menuButton.contains(target);
                if (clickedOutside) setMenu(false);
            }

            if (explore?.open && !explore.contains(target)) {
                explore.open = false;
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            setMenu(false);
            if (explore) explore.open = false;
        });

        initActiveSection();
    }

    function initActiveSection() {
        const sections = $$('main > section[id]');
        const directLinks = $$('nav a[href^="#"]');

        if (!sections.length || !directLinks.length || !("IntersectionObserver" in window)) {
            return;
        }

        const update = (id) => {
            directLinks.forEach((link) => {
                if (link.closest(".nav-explore-panel")) return;

                const active = link.getAttribute("href") === `#${id}`;
                if (active) {
                    link.setAttribute("aria-current", "location");
                } else {
                    link.removeAttribute("aria-current");
                }
            });
        };

        const observer = new IntersectionObserver((entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

            if (visible?.target?.id) update(visible.target.id);
        }, {
            rootMargin: "-28% 0px -62% 0px",
            threshold: [0.05, 0.15, 0.3, 0.5]
        });

        sections.forEach((section) => observer.observe(section));
    }

    /* ============================================================
       07. CARROSSEL
    ============================================================ */

    function initCarousel() {
        const root = $("[data-carousel='root']");
        if (!root) return;

        const slides = $$('[data-carousel-slide]', root);
        const previous = $("[data-carousel-prev]", root);
        const next = $("[data-carousel-next]", root);
        const progress = $("[data-carousel-progress]", root);
        const progressFill = $("[data-carousel-progress-fill]", root);
        const pauseControl = $("[data-carousel-pause]", root);
        const duration = Math.max(1000, toNumber(root.dataset.autoplay, 8000));

        if (slides.length < 1) return;

        state.carousel.duration = duration;

        const initialIndex = slides.findIndex((slide) => slide.classList.contains("is-active"));
        state.carousel.index = initialIndex >= 0 ? initialIndex : 0;

        const stopTimers = () => {
            if (state.carousel.timer !== null) {
                window.clearTimeout(state.carousel.timer);
                state.carousel.timer = null;
            }

            if (state.carousel.progressTimer !== null) {
                window.clearInterval(state.carousel.progressTimer);
                state.carousel.progressTimer = null;
            }
        };

        const updateProgress = (percent) => {
            const value = clamp(percent, 0, 100);
            if (progressFill) {
                progressFill.style.width = `${value}%`;
            }
            if (progress) {
                progress.setAttribute("aria-valuenow", String(Math.round(value)));
            }
        };

        const updatePauseButton = () => {
            if (!pauseControl) return;

            const paused = Boolean(state.carousel.paused);
            pauseControl.setAttribute("aria-pressed", String(paused));
            pauseControl.setAttribute(
                "aria-label",
                paused ? "Retomar carrossel" : "Pausar carrossel"
            );
            pauseControl.textContent = paused ? "Retomar" : "Pausar";
        };

        const updateSlides = () => {
            slides.forEach((slide, index) => {
                const active = index === state.carousel.index;
                slide.classList.toggle("is-active", active);
                slide.hidden = !active;
                slide.setAttribute("aria-hidden", String(!active));
            });
        };

        const canAutoplay = () => {
            return slides.length > 1
                && !state.carousel.paused
                && !state.carousel.hoverPaused
                && !state.carousel.focusPaused
                && !document.hidden
                && !prefersReducedMotion();
        };

        const start = () => {
            stopTimers();
            updatePauseButton();
            updateProgress(0);

            if (!canAutoplay()) return;

            state.carousel.progressStartedAt = performance.now();

            state.carousel.progressTimer = window.setInterval(() => {
                const elapsed = performance.now() - state.carousel.progressStartedAt;
                updateProgress((elapsed / duration) * 100);
            }, 40);

            state.carousel.timer = window.setTimeout(() => {
                goTo(state.carousel.index + 1, false);
                start();
            }, duration);
        };

        const goTo = (index, restart = true) => {
            state.carousel.index = (index + slides.length) % slides.length;
            updateSlides();
            updateProgress(0);

            if (restart) start();
        };

        previous?.addEventListener("click", () => goTo(state.carousel.index - 1));
        next?.addEventListener("click", () => goTo(state.carousel.index + 1));

        pauseControl?.addEventListener("click", () => {
            state.carousel.paused = !state.carousel.paused;
            if (state.carousel.paused) {
                stopTimers();
            }
            start();
        });

        root.addEventListener("pointerdown", (event) => {
            state.carousel.touchStartX = event.clientX;
        }, { passive: true });

        root.addEventListener("pointerup", (event) => {
            if (state.carousel.touchStartX === null) return;

            const distance = event.clientX - state.carousel.touchStartX;
            state.carousel.touchStartX = null;

            if (Math.abs(distance) < CONFIG.limits.carouselSwipeThreshold) return;
            goTo(state.carousel.index + (distance < 0 ? 1 : -1));
        }, { passive: true });

        root.addEventListener("pointercancel", () => {
            state.carousel.touchStartX = null;
        }, { passive: true });

        root.addEventListener("mouseenter", () => {
            state.carousel.hoverPaused = true;
            stopTimers();
        });

        root.addEventListener("mouseleave", () => {
            state.carousel.hoverPaused = false;
            start();
        });

        root.addEventListener("focusin", () => {
            state.carousel.focusPaused = true;
            stopTimers();
        });

        root.addEventListener("focusout", (event) => {
            if (root.contains(event.relatedTarget)) return;
            state.carousel.focusPaused = false;
            start();
        });

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) stopTimers();
            else start();
        });

        const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
        motionQuery?.addEventListener?.("change", () => start());

        updateSlides();
        updatePauseButton();
        start();
    }

    /* ============================================================
       08. SISTEMAS
    ============================================================ */

    function initSystems() {
        const root = $("#sistemas");
        const tabs = $$('[data-system-tab]', root || document);
        const panels = $$('[data-system-panel]', root || document);

        if (!tabs.length || !panels.length) return;

        const select = (name, focus = false) => {
            tabs.forEach((tab) => {
                const active = tab.dataset.systemTab === name;

                tab.classList.toggle("is-active", active);
                tab.setAttribute("aria-selected", String(active));
                tab.setAttribute("tabindex", active ? "0" : "-1");

                if (active && focus) tab.focus();
            });

            panels.forEach((panel) => {
                const active = panel.dataset.systemPanel === name;

                panel.classList.toggle("is-active", active);
                panel.hidden = !active;
                panel.setAttribute("aria-hidden", String(!active));
            });
        };

        tabs.forEach((tab, index) => {
            tab.addEventListener("click", () => {
                select(tab.dataset.systemTab);
            });

            tab.addEventListener("keydown", (event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();

                let nextIndex = index;
                if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
                if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
                if (event.key === "Home") nextIndex = 0;
                if (event.key === "End") nextIndex = tabs.length - 1;

                select(tabs[nextIndex].dataset.systemTab, true);
            });
        });

        const initial = tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0];
        select(initial.dataset.systemTab);
    }

    /* ============================================================
       09. SIMULADOR
    ============================================================ */

    function initSimulator() {
        const root = $(`[data-simulator-root]`);
        const form = $("#simulador-geracao", root || document);

        if (!root || !form) return;

        const fields = {
            irradiacao: $("#irradiacao", form),
            temperatura: $("#temperatura", form),
            sombreamento: $("#sombreamento", form),
            orientacao: $("#orientacao", form),
            sujeira: $("#sujeira", form),
            eficiencia: $("#eficiencia", form)
        };

        const outputs = {
            irradiacao: $("#valor-irradiacao", root),
            temperatura: $("#valor-temperatura", root),
            sombreamento: $("#valor-sombreamento", root),
            orientacao: $("#valor-orientacao", root),
            sujeira: $("#valor-sujeira", root),
            eficiencia: $("#valor-eficiencia", root),
            potencia: $("[data-result='potencia']", root),
            energia: $("[data-result='energia']", root),
            desempenho: $("[data-result='desempenho']", root)
        };

        const presets = Object.freeze({
            ideal: Object.freeze({
                irradiacao: 100,
                temperatura: 38,
                sombreamento: 0,
                orientacao: 100,
                sujeira: 0,
                eficiencia: 100
            }),

            normal: Object.freeze({
                irradiacao: 80,
                temperatura: 50,
                sombreamento: 10,
                orientacao: 80,
                sujeira: 10,
                eficiencia: 80
            }),

            sombreado: Object.freeze({
                irradiacao: 75,
                temperatura: 58,
                sombreamento: 45,
                orientacao: 68,
                sujeira: 18,
                eficiencia: 78
            })
        });

        const updatePresetState = (activeName = null) => {
            $$('[data-scenario]', root).forEach((button) => {
                const active = activeName !== null && button.dataset.scenario === activeName;
                button.classList.toggle("is-active", active);
                button.setAttribute("aria-pressed", String(active));
            });
        };

        const calculate = () => {
            const irradiacao = toNumber(fields.irradiacao?.value) / 100;
            const temperaturaSlider = toNumber(fields.temperatura?.value);
            const sombreamento = toNumber(fields.sombreamento?.value) / 100;
            const orientacao = toNumber(fields.orientacao?.value) / 100;
            const sujeira = toNumber(fields.sujeira?.value) / 100;
            const eficiencia = toNumber(fields.eficiencia?.value) / 100;

            /*
             * Modelo didático baseado no simulador anterior:
             * - sistema de referência de 5 kW;
             * - fator diário fixo de 5,5 h equivalentes;
             * - temperatura convertida de 0–100 para 10–50 °C;
             * - perdas simplificadas por sombra, orientação e sujeira.
             */
            const temperatura = 10 + temperaturaSlider * 0.4;
            const temperaturaFactor = Math.max(
                0,
                1 - Math.max(0, temperatura - 25) * 0.004
            );
            const sombraFactor = 1 - sombreamento;
            const orientacaoFactor = 0.55 + orientacao * 0.45;
            const sujeiraFactor = 1 - sujeira * 0.5;

            const performance = clamp(
                irradiacao
                * temperaturaFactor
                * sombraFactor
                * orientacaoFactor
                * sujeiraFactor
                * eficiencia,
                0,
                1
            );

            const potencia = 5 * performance;
            const energia = potencia * 5.5;
            const desempenho = performance * 100;

            announce(outputs.irradiacao, `${Math.round(toNumber(fields.irradiacao?.value))}%`);
            announce(outputs.temperatura, `${Math.round(temperatura)} °C`);
            announce(outputs.sombreamento, `${Math.round(toNumber(fields.sombreamento?.value))}%`);
            announce(outputs.orientacao, `${Math.round(toNumber(fields.orientacao?.value))}%`);
            announce(outputs.sujeira, `${Math.round(toNumber(fields.sujeira?.value))}%`);
            announce(outputs.eficiencia, `${Math.round(toNumber(fields.eficiencia?.value))}%`);
            announce(outputs.potencia, `${potencia.toFixed(2)} kW`);
            announce(outputs.energia, `${energia.toFixed(2)} kWh`);
            announce(outputs.desempenho, `${desempenho.toFixed(0)}%`);

            state.simulator.lastResult = {
                potencia,
                energia,
                desempenho
            };

            return state.simulator.lastResult;
        };

        const applyPreset = (name, track = false) => {
            const preset = presets[name];
            if (!preset) return null;

            Object.entries(preset).forEach(([field, value]) => {
                if (fields[field]) fields[field].value = String(value);
            });

            updatePresetState(name);
            const result = calculate();

            if (track) {
                analyticsTrack("simulador_usado", {
                    cenario: name,
                    desempenho: Number(result.desempenho.toFixed(2))
                });
            }

            return result;
        };

        Object.values(fields).forEach((field) => {
            field?.addEventListener("input", () => {
                updatePresetState(null);
                calculate();
            });
        });

        $$('[data-scenario]', root).forEach((button) => {
            button.addEventListener("click", () => {
                applyPreset(button.dataset.scenario, true);
            });
        });

        applyPreset("normal", false);
    }

    /* ============================================================
       10. DADOS DO BRASIL
    ============================================================ */

    const BRASIL_FALLBACK = Object.freeze([
        {
            ano: 2025,
            capacidade_gw: 64.793,
            geracao_twh: 88.1,
            participacao_percentual: 11.4,
            fonte_instituicao: "EPE",
            fonte_titulo: "Balanço Energético Nacional 2026",
            fonte_ano: 2026,
            fonte_url: "https://www.epe.gov.br/"
        },
        {
            ano: 2024,
            capacidade_gw: 48.468,
            geracao_twh: 70.7,
            participacao_percentual: 9.4,
            fonte_instituicao: "EPE",
            fonte_titulo: "Balanço Energético Nacional 2026",
            fonte_ano: 2026,
            fonte_url: "https://www.epe.gov.br/"
        },
        {
            ano: 2023,
            capacidade_gw: 37.843,
            geracao_twh: 50.633,
            participacao_percentual: 7,
            fonte_instituicao: "EPE",
            fonte_titulo: "Balanço Energético Nacional 2024",
            fonte_ano: 2024,
            fonte_url: "https://www.epe.gov.br/"
        },
        {
            ano: 2022,
            capacidade_gw: 24.453,
            geracao_twh: 30.127,
            participacao_percentual: 4.4,
            fonte_instituicao: "EPE",
            fonte_titulo: "Balanço Energético Nacional 2023",
            fonte_ano: 2023,
            fonte_url: "https://www.epe.gov.br/"
        },
        {
            ano: 2021,
            capacidade_gw: 13.404,
            geracao_twh: 16.752,
            participacao_percentual: 2.6,
            fonte_instituicao: "EPE",
            fonte_titulo: "Anuário Estatístico 2024",
            fonte_ano: 2024,
            fonte_url: "https://www.epe.gov.br/"
        }
    ]);

    const BRASIL_METRICS = Object.freeze({
        capacidade: Object.freeze({
            key: "capacidade_gw",
            label: "Capacidade solar instalada",
            unit: "GW",
            digits: 1
        }),
        geracao: Object.freeze({
            key: "geracao_twh",
            label: "Geração solar",
            unit: "TWh",
            digits: 1
        }),
        participacao: Object.freeze({
            key: "participacao_percentual",
            label: "Participação na geração elétrica",
            unit: "%",
            digits: 1
        })
    });

    function normalizeBrazilRow(row) {
        const source = Array.isArray(row?.fonte)
            ? row.fonte[0] || {}
            : (row?.fonte || {});

        return {
            ano: toNumber(row?.ano, NaN),
            capacidade_gw: toNumber(row?.capacidade_gw, NaN),
            geracao_twh: toNumber(row?.geracao_twh, NaN),
            participacao_percentual: toNumber(
                row?.participacao_percentual ?? row?.participacao,
                NaN
            ),
            fonte_id: row?.fonte_id ?? null,
            fonte_instituicao: String(
                row?.fonte_instituicao ?? source?.instituicao ?? ""
            ).trim(),
            fonte_titulo: String(
                row?.fonte_titulo ?? source?.titulo ?? ""
            ).trim(),
            fonte_ano: toNumber(
                row?.fonte_ano ?? source?.ano,
                NaN
            ),
            fonte_url: String(
                row?.fonte_url ?? source?.url ?? ""
            ).trim()
        };
    }

    function getLatestBrazil() {
        return [...state.brasil.data]
            .filter((row) => Number.isFinite(row.ano))
            .sort((a, b) => b.ano - a.ano)[0] || null;
    }

    function updateBrazilHighlights() {
        const root = $("[data-brazil-root]");
        const latest = getLatestBrazil();

        if (!root || !latest) return;

        const definitions = [
            ["capacidade_gw", latest.capacidade_gw, "GW", "capacidade solar instalada"],
            ["geracao_twh", latest.geracao_twh, "TWh", "geração solar"],
            ["participacao", latest.participacao_percentual, "%", "participação na geração elétrica"]
        ];

        definitions.forEach(([cardName, value, unit, label]) => {
            const output = $(`[data-brazil-value="${cardName}"]`, root);
            const year = $(`[data-brazil-year="${cardName}"]`, root);

            if (output && Number.isFinite(value)) {
                output.textContent = `${formatNumber(value, 1)} ${unit}`;
            }

            if (year) {
                year.textContent = `${label} — ${latest.ano}`;
            }
        });

        const status = $("[data-brazil-status]", root);
        const meta = $("[data-brazil-meta]", root);
        const sourceLink = $("[data-brazil-source-link]", root);

        const institution = latest.fonte_instituicao || "Fonte registrada no banco";
        const sourceYear = Number.isFinite(latest.fonte_ano)
            ? ` • fonte ${latest.fonte_ano}`
            : "";

        announce(
            status,
            state.brasil.usingFallback
                ? `Dados de referência até ${latest.ano}`
                : `Dados do banco até ${latest.ano}`
        );

        announce(
            meta,
            `Dados históricos • atualizado até ${latest.ano} • ${institution}${sourceYear}`
        );

        const sourceUrl = safeUrl(latest.fonte_url);
        if (sourceLink) {
            if (sourceUrl) {
                sourceLink.href = sourceUrl;
                sourceLink.target = "_blank";
                sourceLink.rel = "noopener noreferrer";
                sourceLink.textContent = `Fonte: ${institution}`;
                sourceLink.removeAttribute("aria-disabled");
            } else {
                sourceLink.href = "#fontes-brasil";
                sourceLink.removeAttribute("target");
                sourceLink.removeAttribute("rel");
                sourceLink.textContent = "Ver fonte";
                sourceLink.setAttribute("aria-disabled", "true");
            }
        }
    }

    function updateBrazilMetricButtons(metricName) {
        const root = $("[data-brazil-root]");
        $$('[data-brazil-metric]', root || document).forEach((button) => {
            const active = button.dataset.brazilMetric === metricName;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function renderBrazilChart(metricName = state.brasil.metric) {
        const chart = $("#grafico-brasil");
        if (!chart) return;

        const config = BRASIL_METRICS[metricName] || BRASIL_METRICS.capacidade;
        state.brasil.metric = BRASIL_METRICS[metricName] ? metricName : "capacidade";
        updateBrazilMetricButtons(state.brasil.metric);

        const rows = [...state.brasil.data]
            .filter((row) => Number.isFinite(row.ano) && Number.isFinite(row[config.key]))
            .sort((a, b) => a.ano - b.ano);

        if (!rows.length) {
            chart.innerHTML = '<p class="chart-placeholder">Ainda não há dados históricos disponíveis.</p>';
            chart.setAttribute("aria-label", "Ainda não há dados históricos disponíveis.");
            return;
        }

        const width = 900;
        const height = 360;
        const left = 62;
        const right = 24;
        const top = 30;
        const bottom = 54;
        const innerWidth = width - left - right;
        const innerHeight = height - top - bottom;

        const values = rows.map((row) => Number(row[config.key]));
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = Math.max(max - min, Math.abs(max) * 0.08, 1);
        const low = Math.max(0, min - range * 0.12);
        const high = max + range * 0.12;
        const span = Math.max(high - low, 1);

        const points = rows.map((row, index) => ({
            x: left + (index / Math.max(rows.length - 1, 1)) * innerWidth,
            y: top + innerHeight - ((row[config.key] - low) / span) * innerHeight,
            value: row[config.key],
            year: row.ano
        }));

        const line = points
            .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
            .join(" ");

        const baseline = top + innerHeight;
        const area = `${left},${baseline} ${line} ${left + innerWidth},${baseline}`;
        const latest = rows.at(-1);

        chart.setAttribute(
            "aria-label",
            `${config.label}, de ${rows[0].ano} a ${latest.ano}. Último valor: ${formatNumber(latest[config.key], config.digits)} ${config.unit}.`
        );
        chart.setAttribute("aria-busy", "false");

        const grid = [0, 0.5, 1].map((ratio) => {
            const y = top + innerHeight - ratio * innerHeight;
            const value = low + span * ratio;

            return `
                <line
                    class="chart-grid"
                    x1="${left}"
                    y1="${y.toFixed(1)}"
                    x2="${left + innerWidth}"
                    y2="${y.toFixed(1)}"
                ></line>
                <text
                    class="chart-axis-label"
                    x="${left - 10}"
                    y="${(y + 4).toFixed(1)}"
                    text-anchor="end"
                >${escapeHtml(formatNumber(value, config.digits))}</text>
            `;
        }).join("");

        chart.innerHTML = `
            <div class="grafico-titulo-dinamico">
                <strong>${escapeHtml(config.label)}</strong>
                <span>${escapeHtml(formatNumber(latest[config.key], config.digits))} ${escapeHtml(config.unit)} • ${escapeHtml(latest.ano)}</span>
            </div>

            <svg
                class="brasil-chart"
                viewBox="0 0 ${width} ${height}"
                role="img"
                aria-hidden="true"
                focusable="false"
            >
                ${grid}

                <polygon
                    class="chart-area"
                    points="${escapeHtml(area)}"
                ></polygon>

                <polyline
                    class="chart-line"
                    points="${escapeHtml(line)}"
                ></polyline>

                ${points.map((point) => `
                    <g>
                        <title>${escapeHtml(point.year)}: ${escapeHtml(formatNumber(point.value, config.digits))} ${escapeHtml(config.unit)}</title>
                        <circle
                            class="chart-point"
                            cx="${point.x.toFixed(1)}"
                            cy="${point.y.toFixed(1)}"
                            r="5"
                        ></circle>
                        <text
                            class="chart-label"
                            x="${point.x.toFixed(1)}"
                            y="${height - 18}"
                            text-anchor="middle"
                        >${escapeHtml(point.year)}</text>
                    </g>
                `).join("")}
            </svg>

            <div class="grafico-unidade">Unidade: ${escapeHtml(config.unit)}</div>
        `;
    }

    async function loadBrazilData() {
        if (state.brasil.loading) return;

        state.brasil.loading = true;
        const requestId = ++state.brasil.requestId;
        const chart = $("#grafico-brasil");
        const status = $("[data-brazil-status]");

        /*
         * Fallback primeiro: a página nunca fica dependente da resposta do
         * Supabase para apresentar o histórico educacional inicial.
         */
        state.brasil.data = BRASIL_FALLBACK
            .map(normalizeBrazilRow)
            .filter((row) => Number.isFinite(row.ano))
            .sort((a, b) => a.ano - b.ano);
        state.brasil.usingFallback = true;

        updateBrazilHighlights();
        renderBrazilChart(state.brasil.metric);

        chart?.setAttribute("aria-busy", "false");
        announce(status, "Dados de referência carregados; verificando atualização…");

        if (!supabaseClient) {
            state.brasil.loading = false;
            chart?.setAttribute("aria-busy", "false");
            announce(status, "Dados de referência disponíveis.");
            return;
        }

        try {
            const { data, error } = await apiSelectBrazil();
            if (error) throw error;

            const rows = (data || [])
                .map(normalizeBrazilRow)
                .filter((row) => Number.isFinite(row.ano));

            if (requestId !== state.brasil.requestId) return;

            if (rows.length) {
                state.brasil.data = rows.sort((a, b) => a.ano - b.ano);
                state.brasil.usingFallback = false;
                updateBrazilHighlights();
                renderBrazilChart(state.brasil.metric);
            }

            const latest = getLatestBrazil();
            if (latest) {
                announce(
                    status,
                    state.brasil.usingFallback
                        ? `Dados de referência até ${latest.ano}`
                        : `Dados do banco até ${latest.ano}`
                );
            }
        } catch (error) {
            console.warn(
                "Solaris: não foi possível atualizar os dados do Brasil; fallback mantido.",
                error?.message || error
            );

            const latest = getLatestBrazil();
            announce(
                status,
                latest
                    ? `Dados de referência até ${latest.ano}`
                    : "Dados de referência disponíveis."
            );
        } finally {
            state.brasil.loading = false;
            chart?.setAttribute("aria-busy", "false");
        }
    }

    function initBrazil() {
        const root = $("[data-brazil-root]");
        const buttons = $$('[data-brazil-metric]', root || document);

        buttons.forEach((button, index) => {
            button.addEventListener("click", () => {
                renderBrazilChart(button.dataset.brazilMetric || "capacidade");
            });

            button.addEventListener("keydown", (event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();

                let nextIndex = index;
                if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
                if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
                if (event.key === "Home") nextIndex = 0;
                if (event.key === "End") nextIndex = buttons.length - 1;

                buttons[nextIndex]?.focus();
                renderBrazilChart(buttons[nextIndex]?.dataset.brazilMetric || "capacidade");
            });
        });

        window.addEventListener("online", () => {
            loadBrazilData();
        }, { passive: true });

        loadBrazilData();
    }

    /* ============================================================
       11. FORMULÁRIO DE CONTATO
    ============================================================ */

    function initContactForm() {
        const form = $("[data-contact-form]");
        if (!form) return;

        const phone = $("#telefone", form);
        const feedback = $("[data-form-status]", form);
        const honeypot = $("#website", form);
        const submit = $("button[type='submit']", form);
        let submitting = false;
        let formStarted = false;

        const showFeedback = (message, status = "") => {
            announce(feedback, message);

            if (!feedback) return;
            if (status) {
                feedback.dataset.status = status;
            } else {
                delete feedback.dataset.status;
            }
        };

        const formatPhone = (value) => {
            const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
            if (!digits) return "";
            if (digits.length <= 2) return `(${digits}`;
            if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
            if (digits.length <= 10) {
                return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
            }
            return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
        };

        phone?.addEventListener("input", () => {
            phone.value = formatPhone(phone.value);
        });

        const markStarted = () => {
            if (formStarted) return;
            formStarted = true;
            analyticsTrack("formulario_iniciado", {});
        };

        form.addEventListener("input", (event) => {
            if (event.target?.name !== "website") markStarted();
            if (feedback?.textContent) showFeedback("");
        });

        form.addEventListener("change", (event) => {
            if (event.target?.name !== "website") markStarted();
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (submitting) return;

            markStarted();

            if (honeypot?.value.trim()) {
                showFeedback("Não foi possível enviar a mensagem.", "error");
                return;
            }

            if (!form.checkValidity()) {
                form.reportValidity();
                showFeedback("Revise os campos obrigatórios antes de enviar.", "error");
                return;
            }

            const now = Date.now();
            const lastSubmission = toNumber(
                safeStorage.get(window.localStorage, CONFIG.storage.lastMessage),
                0
            );

            if (now - lastSubmission < CONFIG.limits.messageCooldown) {
                showFeedback(
                    "Aguarde alguns segundos antes de enviar outra mensagem.",
                    "error"
                );
                return;
            }

            const nome = $("#nome", form)?.value.trim() || "";
            const email = $("#email", form)?.value.trim().toLowerCase() || "";
            const telefone = $("#telefone", form)?.value.trim() || "";
            const perfilRaw = $("#perfil", form)?.value || "";
            const empresa = $("#empresa", form)?.value.trim() || "";
            const assunto = $("#assunto", form)?.value || "";
            const mensagem = $("#mensagem", form)?.value.trim() || "";
            const interesses = $$('input[name="interesses[]"]:checked', form)
                .map((input) => input.value)
                .filter(Boolean);

            const allowedProfiles = new Set([
                "estudante",
                "empresa",
                "profissional",
                "pesquisador",
                "outro"
            ]);

            const perfil = allowedProfiles.has(perfilRaw) ? perfilRaw : null;

            if (
                nome.length < 2
                || nome.length > 100
                || !isValidEmail(email)
                || email.length > 254
                || assunto.length < 2
                || assunto.length > 150
                || mensagem.length < 5
                || mensagem.length > 5000
            ) {
                showFeedback("Revise o tamanho e o formato dos campos informados.", "error");
                return;
            }

            if (!supabaseClient) {
                showFeedback(
                    "O serviço de envio não está disponível no momento.",
                    "error"
                );
                return;
            }

            submitting = true;
            submit?.classList.add("is-loading");
            submit?.setAttribute("aria-busy", "true");
            submit?.setAttribute("disabled", "true");

            const originalText = submit?.textContent?.trim() || "Enviar mensagem";
            if (submit) submit.dataset.originalText = originalText;
            if (submit) submit.textContent = "Enviando…";

            const payload = {
                p_nome: nome,
                p_email: email,
                p_telefone: telefone,
                p_empresa: empresa,
                p_perfil: perfil,
                p_assunto: assunto,
                p_interesses: interesses,
                p_mensagem: mensagem
            };

            try {
                const { data, error } = await apiSendMessage(payload);
                if (error) throw error;

                form.reset();
                safeStorage.set(
                    window.localStorage,
                    CONFIG.storage.lastMessage,
                    String(Date.now())
                );

                showFeedback(
                    "Mensagem enviada com sucesso! Obrigado pelo contato.",
                    "success"
                );

                showToast("Mensagem enviada com sucesso.", "success");

                analyticsTrack("formulario_enviado", {
                    assunto,
                    perfil: perfil || null,
                    mensagem_id: typeof data === "string" ? data : null
                });
            } catch (error) {
                console.error("Solaris: erro ao enviar mensagem.", error);
                showFeedback(
                    "Não foi possível enviar sua mensagem. Tente novamente.",
                    "error"
                );
                showToast("Não foi possível enviar a mensagem.", "error");
            } finally {
                submitting = false;
                submit?.classList.remove("is-loading");
                submit?.removeAttribute("aria-busy");
                submit?.removeAttribute("disabled");
                if (submit) {
                    submit.textContent = submit.dataset.originalText || "Enviar mensagem";
                }
            }
        });
    }

    /* ============================================================
       12. ANALYTICS / SESSÃO
    ============================================================ */

    function getDeviceType() {
        const width = window.innerWidth;
        if (width < 768) return "mobile";
        if (width < 1200) return "tablet";
        return "desktop";
    }

    function queueAnalyticsEvent(type, metadata = {}) {
        const event = {
            tipo: String(type),
            pagina: getPageName(),
            criado_em: new Date().toISOString(),
            metadata: metadata && typeof metadata === "object" ? metadata : {}
        };

        if (state.analytics.sessionId) {
            state.analytics.queue.push({
                ...event,
                sessao_id: state.analytics.sessionId
            });
            if (state.analytics.queue.length > CONFIG.limits.analyticsQueueMax) {
                state.analytics.queue.splice(0, state.analytics.queue.length - CONFIG.limits.analyticsQueueMax);
            }
        } else {
            state.analytics.pending.push(event);
            if (state.analytics.pending.length > CONFIG.limits.analyticsQueueMax) {
                state.analytics.pending.splice(0, state.analytics.pending.length - CONFIG.limits.analyticsQueueMax);
            }
        }

        clearTimeout(state.analytics.flushTimer);
        state.analytics.flushTimer = window.setTimeout(() => {
            analyticsFlush();
        }, CONFIG.limits.analyticsBatchDelay);
    }

    function analyticsTrack(type, metadata = {}, options = {}) {
        const onlyIfSession = options.onlyIfSession === true;
        const eventType = options.eventType || type;

        /*
         * Alguns componentes apenas querem registrar eventos quando já
         * existe sessão. Isso impede que interações antes do bootstrap
         * sejam associadas a uma sessão inexistente.
         */
        if (onlyIfSession && !state.analytics.sessionId) return;

        /*
         * O banco possui um CHECK de tipo. Mantemos os quatro eventos
         * efetivamente existentes na implementação pública original.
         * Outros eventos podem ser adicionados no futuro somente depois
         * de o contrato do banco ser ampliado.
         */
        const allowedTypes = new Set([
            "page_view",
            "simulador_usado",
            "formulario_iniciado",
            "formulario_enviado"
        ]);

        if (!allowedTypes.has(eventType)) {
            return;
        }

        queueAnalyticsEvent(eventType, metadata);
    }

    async function analyticsFlush() {
        if (state.analytics.flushing || !state.analytics.queue.length) return;
        if (!supabaseClient) return;

        state.analytics.flushing = true;
        const batch = state.analytics.queue.splice(
            0,
            Math.min(CONFIG.limits.analyticsBatchMax, state.analytics.queue.length)
        );

        try {
            await apiSendAnalytics(batch);
        } catch (error) {
            const retryable = batch.filter((event) => {
                const attempts = toNumber(event.__attempts, 0) + 1;
                event.__attempts = attempts;
                return attempts <= CONFIG.limits.analyticsRetryLimit;
            });

            if (retryable.length) {
                state.analytics.queue.unshift(...retryable);
            }

            console.warn(
                "Solaris: analytics não enviado.",
                error?.message || error
            );
        } finally {
            state.analytics.flushing = false;

            if (state.analytics.queue.length) {
                clearTimeout(state.analytics.flushTimer);
                state.analytics.flushTimer = window.setTimeout(
                    () => analyticsFlush(),
                    CONFIG.limits.analyticsBatchDelay
                );
            }
        }
    }

    function promotePendingAnalytics() {
        if (!state.analytics.sessionId || !state.analytics.pending.length) return;

        const pending = state.analytics.pending.splice(0, state.analytics.pending.length);
        pending.forEach((event) => {
            state.analytics.queue.push({
                ...event,
                sessao_id: state.analytics.sessionId
            });
        });
    }

    async function initAnalytics() {
        if (state.analytics.initialized) return;
        state.analytics.initialized = true;

        if (!supabaseClient) return;

        try {
            const { data, error } = await apiCreateSession({
                pagina_inicial: getPageName(),
                dispositivo: getDeviceType()
            });

            if (error) throw error;

            state.analytics.sessionId = data?.id || null;
            promotePendingAnalytics();

            /*
             * page_view já fica marcado no sessionStorage.
             * Assim, recarregar a mesma aba não cria dezenas de
             * visualizações idênticas para a mesma sessão.
             *
             * A chave também contém a página para que, no futuro,
             * uma navegação real entre páginas continue sendo registrada.
             */
            const pageViewKey = `${CONFIG.storage.pageViewPrefix}:${state.analytics.sessionId}:${getPageName()}`;
            const alreadyTracked = safeStorage.get(window.sessionStorage, pageViewKey) === "1";

            if (state.analytics.sessionId && !alreadyTracked) {
                state.analytics.pageViewTracked = true;
                analyticsTrack("page_view", {
                    referrer: document.referrer || null,
                    device: getDeviceType()
                });
                safeStorage.set(window.sessionStorage, pageViewKey, "1");
            } else {
                state.analytics.pageViewTracked = true;
            }

            await analyticsFlush();
        } catch (error) {
            console.warn(
                "Solaris: sessão de analytics não iniciada.",
                error?.message || error
            );
        }

        const flushOnHide = () => {
            analyticsFlush();
        };

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") flushOnHide();
        });

        window.addEventListener("pagehide", flushOnHide, { passive: true });
        window.addEventListener("online", () => analyticsFlush(), { passive: true });
    }

    /* ============================================================
       13. TOAST / FEEDBACK GLOBAL
    ============================================================ */

    let toastTimer = null;

    function showToast(message, type = "success") {
        const toast = $("[data-toast]");
        if (!toast) return;

        window.clearTimeout(toastTimer);
        toast.textContent = String(message || "");
        toast.dataset.type = type === "error" ? "error" : "success";
        toast.hidden = false;

        toastTimer = window.setTimeout(() => {
            toast.hidden = true;
        }, CONFIG.limits.toastDuration);
    }

    /* ============================================================
       14. RODAPÉ + BOOTSTRAP
    ============================================================ */

    function initFooter() {
        const year = $("#footer-year");
        if (year) year.textContent = String(new Date().getFullYear());
    }

    async function init() {
        if (document.body?.dataset.page !== "home") return;

        /*
         * O Supabase é opcional para a renderização local: o site deve
         * continuar utilizável mesmo quando a API estiver indisponível.
         */
        supabaseClient = createSupabaseClient();

        initTheme();
        initNavigation();
        initCarousel();
        initSystems();
        initSimulator();
        initBrazil();
        initContactForm();
        initFooter();

        /*
         * Analytics é o último bootstrap: assim todos os componentes
         * locais ficam utilizáveis mesmo que o Supabase não responda.
         */
        await initAnalytics();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            init().catch((error) => {
                console.error("Solaris: falha inesperada na inicialização.", error);
            });
        }, { once: true });
    } else {
        init().catch((error) => {
            console.error("Solaris: falha inesperada na inicialização.", error);
        });
    }
})();
