/* =========================================================
   SOLARIS — SCRIPT.JS V6
   Interação • Tema • Jornada • Simuladores • Supabase

   BACKEND V6 — contrato usado pelo frontend
   ---------------------------------------------
   View pública de leitura:
   1) vw_dados_brasil
      - ano
      - capacidade_gw
      - geracao_twh
      - participacao_percentual
      - fonte_instituicao
      - fonte_titulo
      - fonte_ano
      - fonte_url

   A view reúne dados_brasil + fontes e deixa o frontend
   independente da estrutura interna dessas tabelas.

   Formulário público:
   - RPC atual: enviar_mensagem (legado, já existente)
   - RPC V6 preferida: enviar_mensagem_v6
     Parâmetros:
       p_nome
       p_email
       p_telefone
       p_perfil
       p_empresa
       p_assunto
       p_interesses   JSONB/text[] aceito pelo backend
       p_mensagem

   O JS tenta primeiro a RPC V6. Se ela ainda não existir,
   usa a RPC legado para manter o formulário funcional enquanto
   o banco é migrado.
========================================================= */

(() => {
    "use strict";

    /* =========================================================
       00. CONFIGURAÇÃO
    ========================================================== */

    const SUPABASE_URL = "https://tvkocnjtdnvjovzafvyf.supabase.co";
    const SUPABASE_KEY = "sb_publishable_3Q1XsL7LctLHRE3y-r7OGw_SnREkSpj";

    const BACKEND = {
        brasilView: "vw_dados_brasil",
        formRpcV6: "enviar_mensagem_v6",
        formRpcLegacy: "enviar_mensagem"
    };

    let clienteSupabase = null;
    let preferenciaRpcV6 = null;

    const criarClienteSupabase = () => {
        if (!window.supabase?.createClient) {
            throw new Error("Biblioteca do Supabase não carregada.");
        }
        return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });
    };

    /* =========================================================
       01. UTILITÁRIOS
    ========================================================== */

    const $ = (selector, context = document) => context.querySelector(selector);
    const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const safeNumber = (value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const formatPtNumber = (value, maximumFractionDigits = 1) =>
        new Intl.NumberFormat("pt-BR", {
            minimumFractionDigits: 0,
            maximumFractionDigits
        }).format(safeNumber(value));

    const escapeSvgText = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");

    const escapeHtml = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const isEditableTarget = (target) =>
        target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);

    const withTimeout = (promise, ms, message = "Tempo limite excedido.") =>
        Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
        ]);



    if (document.body.dataset.page === "admin") {
        try {
            clienteSupabase = criarClienteSupabase();
        } catch (error) {
            console.error(error);
        }
        initAdmin(clienteSupabase);
        return;
    }

    try {
        clienteSupabase = criarClienteSupabase();
    } catch (error) {
        console.error(error);
    }

    /* =========================================================
       02. TEMA — CLARO / ESCURO
    ========================================================== */

    const themeToggle = $("#toggle-tema");
    const themeIcon = themeToggle?.querySelector("span[aria-hidden]");
    const themeLabel = themeToggle?.querySelector(".texto-tema");
    const siteBody = document.body;
    const themeStorageKey = "solaris-theme";
    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");

    const getStoredTheme = () => {
        try {
            const stored = localStorage.getItem(themeStorageKey);
            return stored === "dark" || stored === "light" ? stored : null;
        } catch {
            return null;
        }
    };

    const getInitialTheme = () => {
        const stored = getStoredTheme();
        if (stored) return stored;
        return systemTheme?.matches ? "dark" : "light";
    };

    const applyTheme = (theme, persist = true) => {
        const normalized = theme === "dark" ? "dark" : "light";
        siteBody.dataset.theme = normalized;

        const dark = normalized === "dark";
        const label = dark ? "Ativar modo claro" : "Ativar modo escuro";

        themeToggle?.setAttribute("aria-pressed", String(dark));
        themeToggle?.setAttribute("aria-label", label);

        if (themeIcon) themeIcon.textContent = dark ? "☀" : "☾";
        if (themeLabel) themeLabel.textContent = dark ? "Modo claro" : "Modo escuro";

        if (persist) {
            try {
                localStorage.setItem(themeStorageKey, normalized);
            } catch {
                /* Preferência local indisponível: tema continua funcionando. */
            }
        }
    };

    const toggleTheme = () => {
        applyTheme(siteBody.dataset.theme === "dark" ? "light" : "dark");
    };

    applyTheme(getInitialTheme(), false);

    themeToggle?.addEventListener("click", toggleTheme);

    systemTheme?.addEventListener?.("change", (event) => {
        if (!getStoredTheme()) {
            applyTheme(event.matches ? "dark" : "light", false);
        }
    });

    /* =========================================================
       03. MENU PRINCIPAL / MENU MOBILE
    ========================================================== */

    const menuToggle = $("#menu-toggle");
    const mobileMenu = $("#menu-principal");
    const navDropdown = $(".nav-dropdown");
    const mobileMenuLinks = $$('a[href^="#"]', mobileMenu || document);

    const setMobileMenu = (open) => {
        if (!mobileMenu || !menuToggle) return;

        mobileMenu.hidden = !open;
        menuToggle.setAttribute("aria-expanded", String(open));
        menuToggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");

        const icon = menuToggle.querySelector("span[aria-hidden]");
        if (icon) icon.textContent = open ? "×" : "☰";

        siteBody.classList.toggle("menu-aberto", open);
    };

    menuToggle?.addEventListener("click", () => {
        setMobileMenu(mobileMenu?.hidden !== false);
    });

    mobileMenuLinks.forEach((link) => {
        link.addEventListener("click", () => setMobileMenu(false));
    });

    document.addEventListener("click", (event) => {
        if (mobileMenu?.hidden === false && !mobileMenu.contains(event.target) && !menuToggle?.contains(event.target)) {
            setMobileMenu(false);
        }

        if (navDropdown?.open && !navDropdown.contains(event.target)) {
            navDropdown.open = false;
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setMobileMenu(false);
            if (navDropdown) navDropdown.open = false;
        }
    });

    /* =========================================================
       04. NAVEGAÇÃO — SEÇÃO ATIVA
    ========================================================== */

    const navSectionLinks = $$('nav a[href^="#"]');
    const mainSections = $$('main > section[id]');

    if ("IntersectionObserver" in window && navSectionLinks.length && mainSections.length) {
        const observer = new IntersectionObserver((entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

            if (!visible) return;

            const currentId = visible.target.id;
            navSectionLinks.forEach((link) => {
                if (link.closest(".nav-dropdown")) return;
                const active = link.getAttribute("href") === `#${currentId}`;
                if (active) link.setAttribute("aria-current", "location");
                else link.removeAttribute("aria-current");
            });
        }, {
            rootMargin: "-28% 0px -62% 0px",
            threshold: [0, 0.15, 0.35, 0.55]
        });

        mainSections.forEach((section) => observer.observe(section));
    }

    /* =========================================================
       05. CARROSSEL — AUTOPLAY + SETAS + PAUSA
    ========================================================== */

    const journey = $("#carrossel");
    if (journey) {
        const slides = $$(".jornada-slide", journey);
        const previousButton = $(".carrossel-anterior", journey);
        const nextButton = $(".carrossel-proxima", journey);
        const pauseButton = $(".carrossel-pausa", journey);
        const progress = $(".carrossel-progresso", journey);
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
        const duration = 8000;
        let current = Math.max(0, slides.findIndex(slide => slide.classList.contains("is-active")));
        let timer = null;
        let progressTimer = null;
        let paused = false;
        let touchStartX = null;

        const stop = () => {
            clearTimeout(timer);
            clearInterval(progressTimer);
        };
        const resetProgress = () => progress?.style.setProperty("--progresso", "0%");

        const render = (index) => {
            if (!slides.length) return;
            current = (index + slides.length) % slides.length;
            slides.forEach((slide, i) => {
                const active = i === current;
                slide.classList.toggle("is-active", active);
                slide.hidden = !active;
                slide.setAttribute("aria-hidden", String(!active));
            });
            resetProgress();
        };

        const start = () => {
            stop();
            if (slides.length < 2 || paused || document.hidden || reducedMotion?.matches) return;
            const started = performance.now();
            progressTimer = setInterval(() => {
                progress?.style.setProperty("--progresso", `${Math.min(((performance.now()-started)/duration)*100,100)}%`);
            }, 80);
            timer = setTimeout(() => { render(current + 1); start(); }, duration);
        };

        const go = (offset) => { render(current + offset); if (!paused) start(); };
        const setPaused = value => {
            paused = Boolean(value);
            stop();
            if (pauseButton) {
                pauseButton.textContent = paused ? "Continuar" : "Pausar";
                pauseButton.setAttribute("aria-label", paused ? "Continuar carrossel" : "Pausar carrossel");
            }
            if (!paused) start();
        };

        previousButton?.addEventListener("click", () => go(-1));
        nextButton?.addEventListener("click", () => go(1));
        pauseButton?.addEventListener("click", () => setPaused(!paused));

        journey.addEventListener("pointerdown", event => { touchStartX = event.clientX; });
        journey.addEventListener("pointerup", event => {
            if (touchStartX == null) return;
            const dx = event.clientX - touchStartX;
            touchStartX = null;
            if (Math.abs(dx) > 44) go(dx < 0 ? 1 : -1);
        });

        document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else start(); });
        reducedMotion?.addEventListener?.("change", () => start());

        render(current);
        start();
    }

    /* =========================================================
       06. COMO FUNCIONA — FLUXO ESTÁTICO
       O diagrama é apenas informativo; não requer interação.
    ========================================================== */

    /* =========================================================
       07. SIMULADOR DE DESEMPENHO
       Simulação didática. Não é dimensionamento real.
    ========================================================== */

    const simulator = $("#simulador-geracao");

    if (simulator) {
        const area = simulator.closest(".simulacao-geracao");

        const fields = {
            irradiacao: $("#irradiacao"),
            temperatura: $("#temperatura"),
            sombreamento: $("#sombreamento"),
            orientacao: $("#orientacao"),
            sujeira: $("#sujeira"),
            eficiencia: $("#eficiencia")
        };

        const outputs = {
            irradiacao: $("#valor-irradiacao"),
            temperatura: $("#valor-temperatura"),
            sombreamento: $("#valor-sombreamento"),
            orientacao: $("#valor-orientacao"),
            sujeira: $("#valor-sujeira"),
            eficiencia: $("#valor-eficiencia"),
            potencia: $("[data-result='potencia']", area || document),
            energia: $("[data-result='energia']", area || document),
            desempenho: $("[data-result='desempenho']", area || document),
            chart: $("[data-chart='desempenho']", area || document)
        };

        const presets = {
            ideal: {
                irradiacao: 100,
                temperatura: 38,
                sombreamento: 0,
                orientacao: 100,
                sujeira: 0,
                eficiencia: 100
            },
            normal: {
                irradiacao: 80,
                temperatura: 50,
                sombreamento: 10,
                orientacao: 80,
                sujeira: 10,
                eficiencia: 80
            },
            sombreado: {
                irradiacao: 75,
                temperatura: 58,
                sombreamento: 45,
                orientacao: 68,
                sujeira: 18,
                eficiencia: 78
            }
        };

        const valueOf = (field) => safeNumber(field?.value, 0);

        const updateSimulator = () => {
            const irradiacao = valueOf(fields.irradiacao) / 100;
            const temperaturaSlider = valueOf(fields.temperatura);
            const sombreamento = valueOf(fields.sombreamento) / 100;
            const orientacao = valueOf(fields.orientacao) / 100;
            const sujeira = valueOf(fields.sujeira) / 100;
            const eficiencia = valueOf(fields.eficiencia) / 100;
            const temperatura = 10 + temperaturaSlider * 0.4;

            const fatorTemperatura = Math.max(
                0,
                1 - Math.max(0, temperatura - 25) * 0.004
            );
            const fatorSombra = 1 - sombreamento;
            const fatorOrientacao = 0.55 + orientacao * 0.45;
            const fatorSujeira = 1 - sujeira * 0.5;

            const fatorTotal =
                irradiacao *
                fatorTemperatura *
                fatorSombra *
                fatorOrientacao *
                fatorSujeira *
                eficiencia;

            const potencia = 5 * fatorTotal;
            const energia = potencia * 5.5;
            const desempenho = clamp(fatorTotal * 100, 0, 100);

            if (outputs.irradiacao) outputs.irradiacao.textContent = `${Math.round(valueOf(fields.irradiacao))}%`;
            if (outputs.temperatura) outputs.temperatura.textContent = `${temperatura.toFixed(0)} °C`;
            if (outputs.sombreamento) outputs.sombreamento.textContent = `${Math.round(valueOf(fields.sombreamento))}%`;
            if (outputs.orientacao) outputs.orientacao.textContent = `${Math.round(valueOf(fields.orientacao))}%`;
            if (outputs.sujeira) outputs.sujeira.textContent = `${Math.round(valueOf(fields.sujeira))}%`;
            if (outputs.eficiencia) outputs.eficiencia.textContent = `${Math.round(valueOf(fields.eficiencia))}%`;

            if (outputs.potencia) outputs.potencia.textContent = `${potencia.toFixed(2)} kW`;
            if (outputs.energia) outputs.energia.textContent = `${energia.toFixed(2)} kWh`;
            if (outputs.desempenho) outputs.desempenho.textContent = `${desempenho.toFixed(0)}%`;


            return { potencia, energia, desempenho };
        };

        const applyPreset = (name) => {
            const preset = presets[name];
            if (!preset) return;

            Object.entries(preset).forEach(([fieldName, value]) => {
                if (fields[fieldName]) fields[fieldName].value = String(value);
            });

            $$('[data-cenario]', area).forEach((button) => {
                button.classList.toggle("is-active", button.dataset.cenario === name);
                button.setAttribute("aria-pressed", String(button.dataset.cenario === name));
            });

            updateSimulator();
        };

        Object.values(fields).forEach((field) => {
            field?.addEventListener("input", () => {
                $$('[data-cenario]', area).forEach((button) => button.classList.remove("is-active"));
                updateSimulator();
            });
        });

        $$('[data-cenario]', area).forEach((button) => {
            button.addEventListener("click", () => applyPreset(button.dataset.cenario));
        });

        applyPreset("normal");
    }

    /* =========================================================
       08. SISTEMAS — ON-GRID / OFF-GRID / HÍBRIDO
    ========================================================== */

    const systemTabs = $$('[data-sistema-tab]');
    const systemPanels = $$('[data-sistema-panel]');

    if (systemTabs.length && systemPanels.length) {
        const changeSystem = (systemName, focus = false) => {
            systemTabs.forEach((tab) => {
                const active = tab.dataset.sistemaTab === systemName;
                tab.classList.toggle("is-active", active);
                tab.setAttribute("aria-selected", String(active));
                tab.setAttribute("tabindex", active ? "0" : "-1");
                if (focus && active) tab.focus();
            });

            systemPanels.forEach((panel) => {
                const active = panel.dataset.sistemaPanel === systemName;
                panel.classList.toggle("is-active", active);
                panel.hidden = !active;
                panel.setAttribute("aria-hidden", String(!active));
            });
        };

        systemTabs.forEach((tab, index) => {
            tab.addEventListener("click", () => changeSystem(tab.dataset.sistemaTab));

            tab.addEventListener("keydown", (event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();

                let nextIndex = index;
                if (event.key === "ArrowRight") nextIndex = (index + 1) % systemTabs.length;
                if (event.key === "ArrowLeft") nextIndex = (index - 1 + systemTabs.length) % systemTabs.length;
                if (event.key === "Home") nextIndex = 0;
                if (event.key === "End") nextIndex = systemTabs.length - 1;

                changeSystem(systemTabs[nextIndex].dataset.sistemaTab, true);
            });
        });

        const initial = systemTabs.find((tab) => tab.classList.contains("is-active")) || systemTabs[0];
        changeSystem(initial.dataset.sistemaTab);
    }

    /* =========================================================
       09. SUSTENTABILIDADE — PROCESSO ESTÁTICO
    ========================================================== */

    /* =========================================================
       10. FORMULÁRIO — VALIDAÇÃO + SUPABASE
    ========================================================== */

    const form = $("#form-contato");
    const phone = $("#telefone");
    const formMessage = $("#mensagem-formulario");

    const showFormMessage = (message, type = "info") => {
        if (!formMessage) return;
        formMessage.textContent = message;
        formMessage.dataset.tipo = type;
    };

    const formatPhone = (value) => {
        const digits = value.replace(/\D/g, "").slice(0, 11);
        if (!digits) return "";
        if (digits.length <= 2) return `(${digits}`;
        if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
        if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    };

    const collectInterests = () =>
        $$('input[name="interesses[]"]:checked', form).map((input) => input.value);

    phone?.addEventListener("input", () => {
        phone.value = formatPhone(phone.value);
    });

    form?.addEventListener("input", () => {
        if (formMessage?.textContent) showFormMessage("");
    });

    const callContactRpc = async (payload) => {
        if (!clienteSupabase) {
            throw new Error("Supabase indisponível.");
        }

        if (preferenciaRpcV6 !== false) {
            const v6 = await clienteSupabase.rpc(BACKEND.formRpcV6, payload);
            if (!v6.error) {
                preferenciaRpcV6 = true;
                return v6;
            }

            const missingV6 = /function|does not exist|schema cache|not found/i.test(v6.error.message || "");
            if (!missingV6) return v6;

            console.warn("RPC V6 ainda não encontrada. Usando a RPC atual do formulário.");
            preferenciaRpcV6 = false;
        }

        const legacyPayload = {
            p_nome: payload.p_nome,
            p_email: payload.p_email,
            p_telefone: payload.p_telefone,
            p_empresa: payload.p_empresa,
            p_assunto: payload.p_assunto,
            p_mensagem: payload.p_mensagem
        };

        return clienteSupabase.rpc(BACKEND.formRpcLegacy, legacyPayload);
    };

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        showFormMessage("");

        const requiredFields = $$('[required]', form);
        const invalid = requiredFields.find((field) => !field.checkValidity());

        if (invalid) {
            invalid.reportValidity();
            showFormMessage("Revise os campos obrigatórios antes de enviar.", "erro");
            invalid.focus();
            return;
        }

        const payload = {
            p_nome: $("#nome", form)?.value.trim() || "",
            p_email: $("#email", form)?.value.trim() || "",
            p_telefone: $("#telefone", form)?.value.trim() || "",
            p_perfil: $("#perfil", form)?.value || null,
            p_empresa: $("#empresa", form)?.value.trim() || "",
            p_assunto: $("#assunto", form)?.value || "",
            p_interesses: collectInterests(),
            p_mensagem: $("#mensagem", form)?.value.trim() || ""
        };

        if (payload.p_mensagem.length < 10) {
            showFormMessage("Escreva uma mensagem com pelo menos 10 caracteres.", "erro");
            $("#mensagem", form)?.focus();
            return;
        }

        if (!clienteSupabase) {
            showFormMessage("Não foi possível conectar ao banco de dados. Tente novamente.", "erro");
            return;
        }

        const button = form.querySelector("button[type='submit']");
        if (button) {
            button.disabled = true;
            button.dataset.originalText = button.textContent;
            button.textContent = "Enviando...";
        }

        try {
            const { error } = await callContactRpc(payload);

            if (error) {
                console.error("Erro ao enviar mensagem:", error);
                showFormMessage("Não foi possível enviar sua mensagem. Tente novamente.", "erro");
                return;
            }

            form.reset();
            showFormMessage("Mensagem enviada com sucesso! Obrigado pelo contato.", "sucesso");
        } catch (error) {
            console.error("Erro de conexão com o Supabase:", error);
            showFormMessage("Não foi possível enviar sua mensagem. Tente novamente.", "erro");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = button.dataset.originalText || "Enviar mensagem";
            }
        }
    });

    /* =========================================================
       11. SUPABASE — DADOS DO BRASIL

       O site continua funcionando com os dados de referência
       presentes no HTML caso o banco esteja vazio ou indisponível.
    ========================================================== */

    const brasilFallback = [
        {
            ano: 2025,
            capacidade_gw: 64.8,
            geracao_twh: 88.1,
            participacao: 11.4,
            fonte_id: null,
            fonte: {
                instituicao: "EPE",
                titulo: "Balanço Energético Nacional",
                ano: 2026,
                url: "https://www.epe.gov.br/"
            }
        }
    ];

    const brasilState = {
        dados: [],
        fontes: [],
        metrica: "capacidade"
    };

    const metricConfig = {
        capacidade: {
            key: "capacidade_gw",
            label: "Capacidade solar instalada",
            unit: "GW",
            digits: 1
        },
        geracao: {
            key: "geracao_twh",
            label: "Geração solar",
            unit: "TWh",
            digits: 1
        },
        participacao: {
            key: "participacao",
            label: "Participação na geração elétrica",
            unit: "%",
            digits: 1
        }
    };

    const normalizeBrasilRow = (row) => {
        const participacao = row.participacao ?? row.participacao_percentual;

        return {
            ...row,
            ano: safeNumber(row.ano, NaN),
            capacidade_gw: safeNumber(row.capacidade_gw, NaN),
            geracao_twh: safeNumber(row.geracao_twh, NaN),
            participacao: safeNumber(participacao, NaN)
        };
    };

    const getLatestBrasilRow = () =>
        [...brasilState.dados]
            .filter((row) => Number.isFinite(row.ano))
            .sort((a, b) => b.ano - a.ano)[0] || null;

    const getSourceForRow = (row) => {
        if (!row) return null;

        if (row.fonte && typeof row.fonte === "object") return row.fonte;

        if (row.fonte_instituicao || row.fonte_titulo || row.fonte_url) {
            return {
                instituicao: row.fonte_instituicao || "Fonte registrada no banco",
                titulo: row.fonte_titulo || "",
                ano: row.fonte_ano || null,
                url: row.fonte_url || null
            };
        }

        return null;
    };

    const formatBrasilMetric = (value, config) =>
        `${formatPtNumber(value, config.digits)} ${config.unit}`;

    const updateBrasilHighlights = () => {
        const latest = getLatestBrasilRow();
        if (!latest) return;

        const mappings = [
            ["capacidade_gw", latest.capacidade_gw, "GW"],
            ["geracao_twh", latest.geracao_twh, "TWh"],
            ["participacao", latest.participacao, "%"]
        ];

        mappings.forEach(([key, value, unit]) => {
            const output = document.querySelector(`[data-valor-brasil="${key}"]`);
            const card = document.querySelector(`[data-dado-brasil="${key}"]`);
            if (!output || !Number.isFinite(value)) return;

            output.textContent = `${formatPtNumber(value, 1)} ${unit}`;
            const label = card?.querySelector("span");
            if (label) label.textContent = `${label.textContent.replace(/—.*$/, "")}— ${latest.ano}`;
        });

        const source = getSourceForRow(latest);
        const updateLabel = $("[data-brasil-atualizacao]");
        const updateMeta = $("[data-brasil-atualizacao-meta]");
        const sourceLink = $("[data-brasil-fonte-link]");
        const sourceName = source?.instituicao || "Fonte registrada no banco";
        const sourceYear = source?.ano ? ` • fonte ${source.ano}` : "";

        if (updateLabel) {
            updateLabel.textContent = `Dados até ${latest.ano}`;
        }

        if (updateMeta) {
            updateMeta.textContent = `Dados históricos • atualizado até ${latest.ano} • ${sourceName}${sourceYear}`;
        }

        if (sourceLink && source?.url) {
            sourceLink.href = source.url;
            sourceLink.target = "_blank";
            sourceLink.rel = "noopener noreferrer";
            sourceLink.textContent = source.instituicao ? `Fonte: ${source.instituicao}` : "Ver fonte";
        }
    };

    const renderBrasilChart = (metricName = brasilState.metrica) => {
        const chart = $("#grafico-brasil");
        const config = metricConfig[metricName] || metricConfig.capacidade;
        if (!chart) return;

        brasilState.metrica = metricName;

        $$('[data-brasil-metrica]').forEach((button) => {
            const active = button.dataset.brasilMetrica === metricName;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", String(active));
            button.setAttribute("tabindex", active ? "0" : "-1");
        });

        const rows = [...brasilState.dados]
            .filter((row) => Number.isFinite(row.ano) && Number.isFinite(row[config.key]))
            .sort((a, b) => a.ano - b.ano);

        if (!rows.length) {
            chart.innerHTML = `<p class="grafico-placeholder">Ainda não há dados históricos disponíveis.</p>`;
            return;
        }

        const width = 900;
        const height = 360;
        const left = 58;
        const right = 24;
        const top = 28;
        const bottom = 54;
        const innerWidth = width - left - right;
        const innerHeight = height - top - bottom;
        const values = rows.map((row) => Number(row[config.key]));
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const range = Math.max(maxValue - minValue, maxValue * 0.08, 1);
        const low = Math.max(0, minValue - range * 0.12);
        const high = maxValue + range * 0.12;

        const points = rows.map((row, index) => {
            const x = left + (index / Math.max(rows.length - 1, 1)) * innerWidth;
            const y = top + innerHeight - ((row[config.key] - low) / Math.max(high - low, 1)) * innerHeight;
            return { x, y, value: row[config.key], ano: row.ano };
        });

        const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
        const baseline = top + innerHeight;
        const areaPath = `${left},${baseline} ${line} ${left + innerWidth},${baseline}`;

        const gridValues = [0, 0.5, 1].map((ratio) => low + (high - low) * ratio);
        const latest = rows[rows.length - 1];

        chart.setAttribute(
            "aria-label",
            `${config.label}. De ${rows[0].ano} até ${latest.ano}. Último valor: ${formatBrasilMetric(latest[config.key], config)}.`
        );

        chart.innerHTML = `
            <div class="grafico-titulo-dinamico">
                <strong>${escapeSvgText(config.label)}</strong>
                <span>${escapeSvgText(formatBrasilMetric(latest[config.key], config))} • ${escapeSvgText(latest.ano)}</span>
            </div>
            <svg class="brasil-chart" viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">
                <defs>
                    <linearGradient id="brasilAreaGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color="currentColor" stop-opacity=".25"></stop>
                        <stop offset="100%" stop-color="currentColor" stop-opacity="0"></stop>
                    </linearGradient>
                </defs>
                ${gridValues.map((value, index) => {
                    const y = top + innerHeight - (index / 2) * innerHeight;
                    return `
                        <line x1="${left}" y1="${y.toFixed(1)}" x2="${left + innerWidth}" y2="${y.toFixed(1)}" class="chart-grid"></line>
                        <text x="${left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">${escapeSvgText(formatPtNumber(value, config.digits))}</text>
                    `;
                }).join("")}
                <polygon points="${escapeSvgText(areaPath)}" class="chart-area"></polygon>
                <polyline points="${escapeSvgText(line)}" class="chart-line"></polyline>
                ${points.map((point) => `
                    <g>
                        <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5" class="chart-point"></circle>
                        <text x="${point.x.toFixed(1)}" y="${height - 18}" text-anchor="middle" class="chart-label">${escapeSvgText(point.ano)}</text>
                    </g>
                `).join("")}
            </svg>
            <div class="grafico-unidade">Unidade: ${escapeSvgText(config.unit)}</div>
        `;
    };

    const loadBrasilData = async () => {
        brasilState.dados = brasilFallback.map(normalizeBrasilRow);
        brasilState.fontes = [];
        updateBrasilHighlights();
        renderBrasilChart("capacidade");

        if (!clienteSupabase) return;

        try {
            const { data, error } = await clienteSupabase
                .from(BACKEND.brasilView)
                .select("ano, capacidade_gw, geracao_twh, participacao_percentual, fonte_instituicao, fonte_titulo, fonte_ano, fonte_url")
                .order("ano", { ascending: true });

            if (error) {
                console.warn("Não foi possível carregar vw_dados_brasil:", error.message);
                return;
            }

            brasilState.dados = (data || [])
                .map(normalizeBrasilRow)
                .filter((row) => Number.isFinite(row.ano));

            if (!brasilState.dados.length) {
                brasilState.dados = brasilFallback.map(normalizeBrasilRow);
            }

            updateBrasilHighlights();
            renderBrasilChart(brasilState.metrica);
        } catch (error) {
            console.warn("Falha ao consultar vw_dados_brasil:", error);
        }
    };

    $$('[data-brasil-metrica]').forEach((button, index, buttons) => {
        button.addEventListener("click", () => renderBrasilChart(button.dataset.brasilMetrica));

        button.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();

            let nextIndex = index;
            if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
            if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = buttons.length - 1;

            buttons[nextIndex]?.focus();
            renderBrasilChart(buttons[nextIndex].dataset.brasilMetrica);
        });
    });

    loadBrasilData();

    /* =========================================================
       13. PROFISSÕES — LISTA INFORMATIVA
    ========================================================== */

    /* =========================================================
       14. ANO DO RODAPÉ
    ========================================================== */

    const footerYear = $("#footer-year");
    if (footerYear) footerYear.textContent = String(new Date().getFullYear());

    /* =========================================================
       ÁREA ADMINISTRATIVA
    ========================================================== */

  async function initAdmin(clienteSupabase) {
    const root = $("#admin-root");
    if (!root) return;
    if (!clienteSupabase) {
      root.innerHTML = '<section class="admin-screen"><div class="admin-card"><p class="eyebrow">SOLARIS</p><h1>Área administrativa</h1><p>Não foi possível carregar o sistema de acesso.</p></div></section>';
      return;
    }

    const state = { user:null, admin:null, messages:[], brazil:[], sources:[], tab:"mensagens" };
    const profileLabels = { estudante:"Estudante", professor:"Professor(a)", profissional:"Profissional", "empresa-instituicao":"Empresa / instituição", visitante:"Visitante", outro:"Outro" };
    const formatDate = value => {
      if (!value) return "—";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"short" }).format(date);
    };
    const profile = value => profileLabels[value] || value || "—";
    const interests = value => Array.isArray(value) && value.length ? value.join(", ") : "—";
    const message = (text, type="") => `<p class="admin-feedback${type ? ` ${type}` : ""}" role="status">${escapeHtml(text)}</p>`;

    function renderLogin(feedback="") {
      root.innerHTML = `
        <section class="admin-screen admin-login-screen">
          <div class="admin-login-brand"><span class="admin-brand-mark">S</span><div><strong>SOLARIS</strong><small>Área administrativa</small></div></div>
          <form class="admin-card admin-login-card" id="admin-login-form" novalidate>
            <p class="eyebrow">ACESSO RESTRITO</p>
            <h1>Área administrativa</h1>
            <p class="admin-login-note">Entre com a conta administrativa cadastrada no Supabase.</p>
            <label><span>E-mail</span><input id="admin-email" name="email" type="email" autocomplete="username" required></label>
            <label><span>Senha</span><input id="admin-password" name="password" type="password" autocomplete="current-password" required></label>
            <button class="admin-primary" type="submit">Entrar</button>
            ${feedback ? message(feedback,"error") : ""}
          </form>
        </section>`;
      $("#admin-login-form")?.addEventListener("submit", login);
      $("#admin-email")?.focus();
    }

    async function login(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const email = $("#admin-email")?.value.trim() || "";
      const password = $("#admin-password")?.value || "";
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const button = $("button[type='submit']", form);
      if (button) { button.disabled=true; button.textContent="Entrando…"; }
      let data;
      try {
        const result = await withTimeout(
          clienteSupabase.auth.signInWithPassword({ email, password }),
          12000,
          "auth-timeout"
        );
        data = result.data;
        if (result.error || !data.session) {
          if (button) { button.disabled=false; button.textContent="Entrar"; }
          renderLogin("E-mail ou senha inválidos. Confira a conta administrativa.");
          return;
        }
      } catch (error) {
        console.error("Falha no login:", error);
        if (button) { button.disabled=false; button.textContent="Entrar"; }
        renderLogin(error.message === "auth-timeout"
          ? "O acesso demorou demais para responder. Verifique a conexão e tente novamente."
          : "Não foi possível realizar o acesso administrativo.");
        return;
      }

      try {
        if (button) { button.disabled=false; button.textContent="Entrar"; }
        const { data: admin, error: adminError } = await withTimeout(
          clienteSupabase
            .from("admin_usuarios")
            .select("user_id, nome, created_at")
            .eq("user_id", data.session.user.id)
            .maybeSingle(),
          10000,
          "admin-timeout"
        );

        if (adminError) {
          console.error("Falha ao validar admin:", adminError);
          throw new Error("admin-query");
        }
        if (!admin) throw new Error("forbidden");

        state.user=data.session.user;
        state.admin=admin;
        renderDashboard();
        refreshAll().catch(error => {
          console.error(error);
          setStatus("Painel aberto, mas alguns dados não puderam ser carregados.","error");
        });
      } catch (error) {
        console.error(error);
        await clienteSupabase.auth.signOut();
        const msg = error.message === "admin-query"
          ? "Login realizado, mas a permissão administrativa não pôde ser validada."
          : error.message === "admin-timeout"
            ? "A validação administrativa demorou demais para responder."
            : "Esta conta não está autorizada na área administrativa.";
        renderLogin(msg);
      }
    }

    async function logout() {
      await clienteSupabase.auth.signOut();
      state.user=null; state.admin=null;
      renderLogin();
    }

    function dashboardTemplate() {
      return `
        <section class="admin-shell">
          <header class="admin-header">
            <div><p class="eyebrow">SOLARIS</p><h1>Painel administrativo</h1><p>Conta: ${escapeHtml(state.user?.email || "—")}</p></div>
            <button id="admin-logout" class="admin-secondary" type="button">Sair</button>
          </header>
          <div id="admin-status" aria-live="polite"></div>
          <div class="admin-stats">
            <article><span>Mensagens</span><strong id="stat-messages">—</strong><small>contatos recebidos</small></article>
            <article><span>Brasil</span><strong id="stat-brazil">—</strong><small>anos cadastrados</small></article>
            <article><span>Fontes</span><strong id="stat-sources">—</strong><small>referências cadastradas</small></article>
          </div>
          <nav class="admin-tabs" aria-label="Seções administrativas">
            <button class="admin-tab is-active" data-tab="mensagens" type="button">Mensagens</button>
            <button class="admin-tab" data-tab="brasil" type="button">Brasil</button>
            <button class="admin-tab" data-tab="fontes" type="button">Fontes</button>
          </nav>
          <section class="admin-panel" data-panel="mensagens"></section>
          <section class="admin-panel" data-panel="brasil" hidden></section>
          <section class="admin-panel" data-panel="fontes" hidden></section>
        </section>`;
    }

    function renderDashboard() {
      root.innerHTML = dashboardTemplate();
      $("#admin-logout")?.addEventListener("click", logout);
      $$(".admin-tab", root).forEach(button=>button.addEventListener("click",()=>setTab(button.dataset.tab)));
      setTab(state.tab);
    }

    function setTab(tab) {
      state.tab=tab;
      $$(".admin-tab", root).forEach(button=>button.classList.toggle("is-active", button.dataset.tab===tab));
      $$(".admin-panel", root).forEach(panel=>panel.hidden=panel.dataset.panel!==tab);
      if (tab==="mensagens") renderMessages();
      if (tab==="brasil") renderBrazil();
      if (tab==="fontes") renderSources();
    }

    function setStatus(text, type="") {
      const target=$("#admin-status");
      if (!target) return;
      target.innerHTML = text ? message(text,type) : "";
    }

    async function loadMessages() {
      const modern = await clienteSupabase
        .from("mensagens")
        .select("id,nome,email,telefone,perfil,empresa,assunto,interesses,mensagem,created_at")
        .order("created_at",{ascending:false});

      if (!modern.error) {
        state.messages=modern.data||[];
        return;
      }

      // Compatibilidade caso a migração de perfil/interesses ainda não tenha sido executada.
      const legacy = await clienteSupabase
        .from("mensagens")
        .select("id,nome,email,telefone,empresa,assunto,mensagem,created_at")
        .order("created_at",{ascending:false});

      if (legacy.error) throw legacy.error;
      state.messages=(legacy.data||[]).map(item=>({...item,perfil:null,interesses:[]}));
    }
    async function loadBrazil() {
      const {data,error}=await clienteSupabase.from("dados_brasil").select("id,ano,capacidade_gw,geracao_twh,participacao_percentual,fonte_id,created_at").order("ano",{ascending:false});
      if (error) throw error;
      state.brazil=data||[];
    }
    async function loadSources() {
      const {data,error}=await clienteSupabase.from("fontes").select("id,instituicao,titulo,ano,url,created_at").order("ano",{ascending:false});
      if (error) throw error;
      state.sources=data||[];
    }
    async function refreshAll() {
      setStatus("Atualizando…");
      try {
        await Promise.all([loadMessages(),loadBrazil(),loadSources()]);
        $("#stat-messages").textContent=state.messages.length;
        $("#stat-brazil").textContent=state.brazil.length;
        $("#stat-sources").textContent=state.sources.length;
        renderMessages(); renderBrazil(); renderSources();
        setStatus("Dados atualizados.","success");
      } catch(error) {
        console.error(error);
        setStatus("Não foi possível carregar os dados. Verifique as políticas do Supabase.","error");
      }
    }

    function panelHeading(eyebrow,title,actions="") { return `<div class="admin-panel-heading"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div><div class="admin-actions">${actions}</div></div>`; }
    function renderMessages() {
      const panel=$("[data-panel='mensagens']",root); if (!panel) return;
      panel.innerHTML=panelHeading("CONTATO","Mensagens recebidas",`<button class="admin-secondary" data-refresh="mensagens" type="button">Atualizar</button>`)+`<div class="admin-table-wrap" id="messages-table"></div>`;
      const target=$("#messages-table");
      if (!state.messages.length) { target.innerHTML='<div class="admin-empty">Nenhuma mensagem recebida.</div>'; return; }
      target.innerHTML=`<table><thead><tr><th>Data</th><th>Nome</th><th>Perfil</th><th>Assunto</th><th>E-mail</th><th></th></tr></thead><tbody>${state.messages.map(row=>`<tr><td>${escapeHtml(formatDate(row.created_at))}</td><td>${escapeHtml(row.nome)}</td><td>${escapeHtml(profile(row.perfil))}</td><td>${escapeHtml(row.assunto)}</td><td>${escapeHtml(row.email)}</td><td><button class="admin-link-button" data-open-message="${row.id}" type="button">Abrir</button></td></tr>`).join("")}</tbody></table>`;
      panel.querySelector("[data-refresh='mensagens']")?.addEventListener("click",async()=>{try{await loadMessages();renderMessages();setStatus("Mensagens atualizadas.","success");}catch{setStatus("Não foi possível atualizar as mensagens.","error");}});
      target.addEventListener("click",event=>{const button=event.target.closest("[data-open-message]");if(button)openMessage(button.dataset.openMessage);});
    }

    function sourceFor(id){return state.sources.find(item=>String(item.id)===String(id));}
    function sourceOptions(selected="") { return '<option value="">Selecione uma fonte</option>'+state.sources.map(s=>`<option value="${s.id}" ${String(s.id)===String(selected)?"selected":""}>${escapeHtml(s.instituicao)} — ${escapeHtml(s.titulo)} (${escapeHtml(s.ano)})</option>`).join(""); }

    function renderBrazil() {
      const panel=$("[data-panel='brasil']",root); if (!panel) return;
      panel.innerHTML=panelHeading("DADOS PÚBLICOS","Energia solar no Brasil",`<button class="admin-secondary" data-refresh="brasil" type="button">Atualizar</button><button class="admin-primary" data-new-brazil type="button">Novo dado</button>`)+`<div class="admin-table-wrap" id="brazil-table"></div>`;
      const target=$("#brazil-table");
      if (!state.brazil.length) target.innerHTML='<div class="admin-empty">Nenhum dado cadastrado.</div>';
      else target.innerHTML=`<table><thead><tr><th>Ano</th><th>Capacidade</th><th>Geração</th><th>Participação</th><th>Fonte</th><th>Ações</th></tr></thead><tbody>${state.brazil.map(row=>{const src=sourceFor(row.fonte_id);return `<tr><td>${row.ano}</td><td>${pt(row.capacidade_gw,3)} GW</td><td>${pt(row.geracao_twh,3)} TWh</td><td>${pt(row.participacao_percentual,2)}%</td><td>${escapeHtml(src?`${src.instituicao} — ${src.ano}`:`#${row.fonte_id}`)}</td><td class="admin-actions-cell"><button class="admin-link-button" data-edit-brazil="${row.id}" type="button">Editar</button><button class="admin-link-button danger" data-delete-brazil="${row.id}" type="button">Excluir</button></td></tr>`;}).join("")}</tbody></table>`;
      panel.querySelector("[data-refresh='brasil']")?.addEventListener("click",async()=>{try{await loadBrazil();renderBrazil();setStatus("Dados do Brasil atualizados.","success");}catch{setStatus("Não foi possível atualizar os dados.","error");}});
      panel.querySelector("[data-new-brazil]")?.addEventListener("click",()=>openBrazilForm());
      target.addEventListener("click",event=>{
        const edit=event.target.closest("[data-edit-brazil]"); if(edit) openBrazilForm(edit.dataset.editBrazil);
        const del=event.target.closest("[data-delete-brazil]"); if(del) deleteBrazil(del.dataset.deleteBrazil);
      });
    }

    function renderSources() {
      const panel=$("[data-panel='fontes']",root); if (!panel) return;
      panel.innerHTML=panelHeading("REFERÊNCIAS","Fontes cadastradas",`<button class="admin-secondary" data-refresh="fontes" type="button">Atualizar</button><button class="admin-primary" data-new-source type="button">Nova fonte</button>`)+`<div class="admin-table-wrap" id="sources-table"></div>`;
      const target=$("#sources-table");
      if (!state.sources.length) target.innerHTML='<div class="admin-empty">Nenhuma fonte cadastrada.</div>';
      else target.innerHTML=`<table><thead><tr><th>Instituição</th><th>Título</th><th>Ano</th><th>URL</th><th>Ações</th></tr></thead><tbody>${state.sources.map(row=>`<tr><td>${escapeHtml(row.instituicao)}</td><td>${escapeHtml(row.titulo)}</td><td>${row.ano}</td><td><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">Abrir fonte</a></td><td class="admin-actions-cell"><button class="admin-link-button" data-edit-source="${row.id}" type="button">Editar</button><button class="admin-link-button danger" data-delete-source="${row.id}" type="button">Excluir</button></td></tr>`).join("")}</tbody></table>`;
      panel.querySelector("[data-refresh='fontes']")?.addEventListener("click",async()=>{try{await loadSources();renderSources();setStatus("Fontes atualizadas.","success");}catch{setStatus("Não foi possível atualizar as fontes.","error");}});
      panel.querySelector("[data-new-source]")?.addEventListener("click",()=>openSourceForm());
      target.addEventListener("click",event=>{
        const edit=event.target.closest("[data-edit-source]"); if(edit) openSourceForm(edit.dataset.editSource);
        const del=event.target.closest("[data-delete-source]"); if(del) deleteSource(del.dataset.deleteSource);
      });
    }

    function dialog(content) {
      const old=$(".admin-dialog",root); old?.remove();
      root.insertAdjacentHTML("beforeend",`<dialog class="admin-dialog">${content}</dialog>`);
      const d=$(".admin-dialog",root);
      d?.addEventListener("click",event=>{if(event.target===d)d.close();});
      d?.showModal?.();
      return d;
    }

    function openMessage(id) {
      const row=state.messages.find(item=>String(item.id)===String(id)); if(!row)return;
      const d=dialog(`<div class="admin-dialog-inner"><button class="admin-dialog-close" type="button">×</button><p class="eyebrow">MENSAGEM</p><h2>${escapeHtml(row.assunto||"Sem assunto")}</h2><dl class="admin-detail-list"><dt>Nome</dt><dd>${escapeHtml(row.nome)}</dd><dt>E-mail</dt><dd>${escapeHtml(row.email)}</dd><dt>Telefone</dt><dd>${escapeHtml(row.telefone||"—")}</dd><dt>Perfil</dt><dd>${escapeHtml(profile(row.perfil))}</dd><dt>Empresa</dt><dd>${escapeHtml(row.empresa||"—")}</dd><dt>Interesses</dt><dd>${escapeHtml(interests(row.interesses))}</dd><dt>Recebida</dt><dd>${escapeHtml(formatDate(row.created_at))}</dd></dl><div class="admin-message"><span>Mensagem</span><p>${escapeHtml(row.mensagem||"")}</p></div></div>`);
      d.querySelector(".admin-dialog-close")?.addEventListener("click",()=>d.close());
    }

    function openSourceForm(id="") {
      const row=id?state.sources.find(item=>String(item.id)===String(id)):null;
      const d=dialog(`<form class="admin-dialog-inner" id="source-form"><button class="admin-dialog-close" type="button">×</button><p class="eyebrow">REFERÊNCIA</p><h2>${row?"Editar fonte":"Nova fonte"}</h2><input type="hidden" name="id" value="${row?.id||""}"><label><span>Instituição</span><input name="instituicao" maxlength="160" required value="${escapeHtml(row?.instituicao||"")}"></label><label><span>Título</span><input name="titulo" maxlength="220" required value="${escapeHtml(row?.titulo||"")}"></label><label><span>Ano</span><input name="ano" type="number" min="1900" max="2100" required value="${row?.ano||""}"></label><label><span>URL</span><input name="url" type="url" maxlength="1000" placeholder="https://..." required value="${escapeHtml(row?.url||"")}"></label><div class="admin-dialog-actions"><button class="admin-secondary" type="button" data-cancel>Cancelar</button><button class="admin-primary" type="submit">Salvar fonte</button></div></form>`);
      const form=$("#source-form",d);
      d.querySelector(".admin-dialog-close")?.addEventListener("click",()=>d.close());
      d.querySelector("[data-cancel]")?.addEventListener("click",()=>d.close());
      form?.addEventListener("submit",async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));const payload={instituicao:data.instituicao.trim(),titulo:data.titulo.trim(),ano:Number(data.ano),url:data.url.trim()};const result=data.id?await clienteSupabase.from("fontes").update(payload).eq("id",data.id):await clienteSupabase.from("fontes").insert(payload);if(result.error){setStatus("Não foi possível salvar a fonte.","error");return;}d.close();await loadSources();renderSources();$("#stat-sources").textContent=state.sources.length;setStatus(data.id?"Fonte atualizada.":"Fonte adicionada.","success");});
    }

    function openBrazilForm(id="") {
      const row=id?state.brazil.find(item=>String(item.id)===String(id)):null;
      const d=dialog(`<form class="admin-dialog-inner" id="brazil-form"><button class="admin-dialog-close" type="button">×</button><p class="eyebrow">DADOS PÚBLICOS</p><h2>${row?"Editar dado":"Novo dado"}</h2><input type="hidden" name="id" value="${row?.id||""}"><label><span>Ano</span><input name="ano" type="number" min="1900" max="2100" required value="${row?.ano||""}"></label><label><span>Capacidade instalada (GW)</span><input name="capacidade" type="number" min="0" step="0.001" required value="${row?.capacidade_gw??""}"></label><label><span>Geração (TWh)</span><input name="geracao" type="number" min="0" step="0.001" required value="${row?.geracao_twh??""}"></label><label><span>Participação na geração (%)</span><input name="participacao" type="number" min="0" max="100" step="0.01" required value="${row?.participacao_percentual??""}"></label><label><span>Fonte</span><select name="fonte" required>${sourceOptions(row?.fonte_id||"")}</select></label><div class="admin-dialog-actions"><button class="admin-secondary" type="button" data-cancel>Cancelar</button><button class="admin-primary" type="submit">Salvar dado</button></div></form>`);
      const form=$("#brazil-form",d);
      d.querySelector(".admin-dialog-close")?.addEventListener("click",()=>d.close());
      d.querySelector("[data-cancel]")?.addEventListener("click",()=>d.close());
      form?.addEventListener("submit",async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));const payload={ano:Number(data.ano),capacidade_gw:Number(data.capacidade),geracao_twh:Number(data.geracao),participacao_percentual:Number(data.participacao),fonte_id:Number(data.fonte)};const result=data.id?await clienteSupabase.from("dados_brasil").update(payload).eq("id",data.id):await clienteSupabase.from("dados_brasil").insert(payload);if(result.error){setStatus(/duplicate|unique/i.test(result.error.message||"")?"Esse ano já está cadastrado.":"Não foi possível salvar o dado.","error");return;}d.close();await loadBrazil();renderBrazil();$("#stat-brazil").textContent=state.brazil.length;setStatus(data.id?"Dado atualizado.":"Dado adicionado.","success");});
    }

    async function deleteSource(id) {
      const row=state.sources.find(item=>String(item.id)===String(id)); if(!row)return;
      if(!confirm(`Excluir a fonte “${row.titulo}”?`))return;
      const {error}=await clienteSupabase.from("fontes").delete().eq("id",id);
      if(error){setStatus("A fonte não pode ser excluída enquanto estiver vinculada a um dado do Brasil.","error");return;}
      await loadSources(); renderSources(); $("#stat-sources").textContent=state.sources.length; setStatus("Fonte excluída.","success");
    }
    async function deleteBrazil(id) {
      const row=state.brazil.find(item=>String(item.id)===String(id)); if(!row)return;
      if(!confirm(`Excluir o dado de ${row.ano}?`))return;
      const {error}=await clienteSupabase.from("dados_brasil").delete().eq("id",id);
      if(error){setStatus("Não foi possível excluir o dado.","error");return;}
      await loadBrazil(); renderBrazil(); $("#stat-brazil").textContent=state.brazil.length; setStatus("Dado excluído.","success");
    }

    renderLogin();
  }

})();
