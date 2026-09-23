/* =========================================================
   SOLARIS — SCRIPT.JS V5
   Navegação • Carrossel • Simulador • Sistemas • Formulário • Supabase
========================================================= */

(() => {
    "use strict";

    const SUPABASE_URL = "https://tvkocnjtdnvjovzafvyf.supabase.co";
    const SUPABASE_KEY = "sb_publishable_3Q1XsL7LctLHRE3y-r7OGw_SnREkSpj";

    let clienteSupabase = null;

    try {
        if (!window.supabase?.createClient) {
            throw new Error("Biblioteca do Supabase não carregada.");
        }

        clienteSupabase = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_KEY
        );
    } catch (error) {
        console.error("Não foi possível inicializar o Supabase:", error);
    }

    /* =========================================================
       UTILITÁRIOS
    ========================================================= */

    const $ = (selector, context = document) => context.querySelector(selector);
    const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];

    /* =========================================================
       01. NAVEGAÇÃO — SEÇÃO ATIVA
    ========================================================= */

    const navLinks = $$("#inicio > nav a[href^='#']");
    const sections = $$('main > section[id]');

    if ("IntersectionObserver" in window && navLinks.length && sections.length) {
        const observer = new IntersectionObserver((entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

            if (!visible) return;

            navLinks.forEach((link) => link.removeAttribute("aria-current"));

            const activeLink = $(`#inicio > nav a[href="#${visible.target.id}"]`);
            activeLink?.setAttribute("aria-current", "page");
        }, {
            rootMargin: "-35% 0px -55% 0px",
            threshold: [0, 0.15, 0.4]
        });

        sections.forEach((section) => observer.observe(section));
    }

    /* =========================================================
       02. CARROSSEL AUTOMÁTICO

       O HTML define o tempo em data-autoplay="8000".
       Não há setas: a troca acontece automaticamente.
    ========================================================= */

    const carousel = $("#carrossel");

    if (carousel) {
        const slides = $$(".slide", carousel);
        const pauseButton = $(".carrossel-pausa", carousel);
        const progress = $(".carrossel-progresso", carousel);
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const duration = Number(carousel.dataset.autoplay) || 8000;

        let currentSlide = 0;
        let slideTimer = null;
        let progressTimer = null;
        let paused = false;
        let progressValue = 0;

        const clearCarouselTimers = () => {
            clearTimeout(slideTimer);
            clearInterval(progressTimer);
            slideTimer = null;
            progressTimer = null;
        };

        const renderProgress = (value) => {
            if (!progress) return;
            progressValue = Math.max(0, Math.min(100, value));
            progress.style.setProperty("--progresso", `${progressValue}%`);
        };

        const showSlide = (index) => {
            if (!slides.length) return;

            currentSlide = (index + slides.length) % slides.length;

            slides.forEach((slide, slideIndex) => {
                const isActive = slideIndex === currentSlide;

                slide.classList.toggle("is-active", isActive);
                slide.hidden = !isActive;
                slide.setAttribute("aria-hidden", String(!isActive));
                slide.setAttribute("aria-label", `${slideIndex + 1} de ${slides.length}`);
            });

            renderProgress(0);
        };

        const startCarousel = () => {
            clearCarouselTimers();

            if (slides.length < 2 || paused || document.hidden || reducedMotion.matches) {
                return;
            }

            const startedAt = Date.now();

            progressTimer = setInterval(() => {
                const elapsed = Date.now() - startedAt;
                renderProgress((elapsed / duration) * 100);
            }, 80);

            slideTimer = setTimeout(() => {
                showSlide(currentSlide + 1);
                startCarousel();
            }, duration);
        };

        const setPaused = (state) => {
            paused = state;
            clearCarouselTimers();

            if (pauseButton) {
                pauseButton.textContent = paused ? "Continuar" : "Pausar";
                pauseButton.setAttribute(
                    "aria-label",
                    paused ? "Continuar carrossel" : "Pausar carrossel"
                );
            }

            if (paused) {
                renderProgress(progressValue);
                return;
            }

            startCarousel();
        };

        showSlide(0);
        startCarousel();

        pauseButton?.addEventListener("click", () => {
            setPaused(!paused);
        });

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                clearCarouselTimers();
                return;
            }

            if (!paused) {
                startCarousel();
            }
        });

        reducedMotion.addEventListener?.("change", (event) => {
            if (event.matches) {
                clearCarouselTimers();
                renderProgress(0);
            } else if (!paused) {
                startCarousel();
            }
        });
    }

    /* =========================================================
       03. SIMULADOR DE DESEMPENHO
       Simulação didática, não dimensionamento real.
    ========================================================= */

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
            desempenho: $("[data-result='desempenho']", area || document)
        };

        const valueOf = (field) => Number(field?.value || 0);

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
            const desempenho = Math.max(0, Math.min(100, fatorTotal * 100));

            if (outputs.irradiacao) {
                outputs.irradiacao.textContent = `${valueOf(fields.irradiacao)}%`;
            }

            if (outputs.temperatura) {
                outputs.temperatura.textContent = `${temperatura.toFixed(0)} °C`;
            }

            if (outputs.sombreamento) {
                outputs.sombreamento.textContent = `${valueOf(fields.sombreamento)}%`;
            }

            if (outputs.orientacao) {
                outputs.orientacao.textContent = `${valueOf(fields.orientacao)}%`;
            }

            if (outputs.sujeira) {
                outputs.sujeira.textContent = `${valueOf(fields.sujeira)}%`;
            }

            if (outputs.eficiencia) {
                outputs.eficiencia.textContent = `${valueOf(fields.eficiencia)}%`;
            }

            if (outputs.potencia) {
                outputs.potencia.textContent = `${potencia.toFixed(2)} kW`;
            }

            if (outputs.energia) {
                outputs.energia.textContent = `${energia.toFixed(2)} kWh`;
            }

            if (outputs.desempenho) {
                outputs.desempenho.textContent = `${desempenho.toFixed(0)}%`;
            }
        };

        Object.values(fields).forEach((field) => {
            field?.addEventListener("input", updateSimulator);
        });

        updateSimulator();
    }

    /* =========================================================
       04. SISTEMAS — ON-GRID / OFF-GRID / HÍBRIDO
    ========================================================= */

    const systemTabs = $$("[data-sistema-tab]");
    const systemPanels = $$("[data-sistema-panel]");

    if (systemTabs.length && systemPanels.length) {
        const changeSystem = (systemName) => {
            systemTabs.forEach((tab) => {
                const active = tab.dataset.sistemaTab === systemName;
                tab.classList.toggle("is-active", active);
                tab.setAttribute("aria-selected", String(active));
            });

            systemPanels.forEach((panel) => {
                const active = panel.dataset.sistemaPanel === systemName;
                panel.classList.toggle("is-active", active);
                panel.hidden = !active;
                panel.setAttribute("aria-hidden", String(!active));
            });
        };

        systemTabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                changeSystem(tab.dataset.sistemaTab);
            });

            tab.addEventListener("keydown", (event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                    return;
                }

                event.preventDefault();

                const currentIndex = systemTabs.indexOf(tab);
                const direction = event.key === "ArrowRight" ? 1 : -1;
                const nextIndex = (currentIndex + direction + systemTabs.length) % systemTabs.length;
                const nextTab = systemTabs[nextIndex];

                nextTab.focus();
                changeSystem(nextTab.dataset.sistemaTab);
            });
        });

        const initial = systemTabs.find((tab) => tab.classList.contains("is-active")) || systemTabs[0];
        changeSystem(initial.dataset.sistemaTab);
    }

    /* =========================================================
       05. FORMULÁRIO DE CONTATO
       Validação + envio para o Supabase.
    ========================================================= */

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

        if (digits.length === 0) return "";
        if (digits.length <= 2) return `(${digits}`;
        if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
        if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;

        return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    };

    phone?.addEventListener("input", () => {
        phone.value = formatPhone(phone.value);
    });

    form?.addEventListener("input", () => {
        if (formMessage?.textContent) {
            showFormMessage("");
        }
    });

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        showFormMessage("");

        const requiredFields = $$('[required]', form);
        const invalid = requiredFields.find((field) => !field.checkValidity());

        if (invalid) {
            invalid.reportValidity();
            showFormMessage(
                "Revise os campos obrigatórios antes de enviar.",
                "erro"
            );
            invalid.focus();
            return;
        }

        const nome = $("#nome", form)?.value.trim() || "";
        const email = $("#email", form)?.value.trim() || "";
        const telefone = $("#telefone", form)?.value.trim() || "";
        const empresa = $("#empresa", form)?.value.trim() || "";
        const assunto = $("#assunto", form)?.value || "";
        const mensagem = $("#mensagem", form)?.value.trim() || "";
        const botao = form.querySelector("button[type='submit']");

        if (mensagem.length < 10) {
            showFormMessage(
                "Escreva uma mensagem com pelo menos 10 caracteres.",
                "erro"
            );
            $("#mensagem", form)?.focus();
            return;
        }

        if (!clienteSupabase) {
            showFormMessage(
                "Não foi possível conectar ao banco de dados.",
                "erro"
            );
            return;
        }

        if (botao) {
            botao.disabled = true;
            botao.textContent = "Enviando...";
        }

        try {
            const { error } = await clienteSupabase.rpc(
                "enviar_mensagem",
                {
                    p_nome: nome,
                    p_email: email,
                    p_telefone: telefone,
                    p_empresa: empresa,
                    p_assunto: assunto,
                    p_mensagem: mensagem
                }
            );

            if (error) {
                console.error("Erro ao enviar mensagem:", error);
                showFormMessage(
                    "Não foi possível enviar sua mensagem. Tente novamente.",
                    "erro"
                );
                return;
            }

            form.reset();
            showFormMessage(
                "Mensagem enviada com sucesso! Obrigado pelo contato.",
                "sucesso"
            );
        } catch (error) {
            console.error("Erro de conexão com o Supabase:", error);
            showFormMessage(
                "Não foi possível enviar sua mensagem. Tente novamente.",
                "erro"
            );
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = "Enviar mensagem";
            }
        }
    });

    /* =========================================================
       06. ANO DO RODAPÉ
    ========================================================= */

    const footerYear = $("body > footer > p:last-child");

    if (footerYear) {
        footerYear.textContent = footerYear.textContent.replace(
            /\d{4}/,
            new Date().getFullYear()
        );
    }
})();
