/* ================================================================
   SOLARIS — ADMIN.JS
   Painel administrativo • Supabase Auth • RLS

   01. Configuração
   02. Estado
   03. Utilitários
   04. Supabase / Auth
   05. Tema
   06. Navegação
   07. Dashboard
   08. Mensagens
   09. Dados do Brasil
   10. Fontes
   11. Analytics
   12. Sessões
   13. Modal / feedback
   14. Inicialização

   Segurança:
   - nenhum service_role key é usado no navegador;
   - operações administrativas dependem do Supabase Auth + RLS;
   - o acesso é conferido em public.admin_usuarios;
   - private.is_admin() continua sendo a autoridade no banco.
================================================================ */

(() => {
    "use strict";

    const CONFIG = Object.freeze({
        supabase: Object.freeze({
            url: "https://tvkocnjtdnvjovzafvyf.supabase.co",
            key: "sb_publishable_3Q1XsL7LctLHRE3y-r7OGw_SnREkSpj"
        }),
        tables: Object.freeze({
            admins: "admin_usuarios",
            messages: "mensagens",
            brazil: "dados_brasil",
            sources: "fontes",
            analytics: "eventos_analytics",
            sessions: "sessoes"
        }),
        storage: Object.freeze({
            theme: "solaris-admin-theme"
        }),
        pageSizes: Object.freeze({
            messages: 12,
            sessions: 15
        }),
        requestTimeout: 12000
    });

    const state = {
        supabase: null,
        user: null,
        admin: null,
        activeTab: "overview",
        theme: "light",
        loading: new Set(),
        messages: {
            all: [],
            filtered: [],
            status: "",
            search: "",
            page: 1
        },
        brazil: {
            rows: [],
            editingId: null
        },
        sources: {
            rows: [],
            editingId: null
        },
        analytics: {
            rows: [],
            type: "",
            period: "7"
        },
        sessions: {
            rows: [],
            page: 1
        }
    };

    /* ============================================================
       01. CONFIGURAÇÃO / UTILITÁRIOS
    ============================================================ */

    const $ = (selector, root = document) => {
        try { return root.querySelector(selector); } catch { return null; }
    };

    const $$ = (selector, root = document) => {
        try { return [...root.querySelectorAll(selector)]; } catch { return []; }
    };

    const escapeHtml = (value) => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const formatNumber = (value, digits = 0) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return "—";
        return new Intl.NumberFormat("pt-BR", {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        }).format(n);
    };

    const formatDate = (value, withTime = true) => {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            ...(withTime ? { timeStyle: "short" } : {})
        }).format(date);
    };

    const formatJson = (value) => {
        try {
            return JSON.stringify(value ?? {}, null, 2);
        } catch {
            return "{}";
        }
    };

    const debounce = (fn, delay = 180) => {
        let timer = null;
        return (...args) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => fn(...args), delay);
        };
    };

    const withTimeout = (promise, ms = CONFIG.requestTimeout) => {
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                window.setTimeout(() => reject(new Error("A operação demorou mais do que o esperado.")), ms);
            })
        ]);
    };

    const showFeedback = (message = "", status = "") => {
        const element = $("#admin-global-feedback");
        if (!element) return;
        element.textContent = message;
        if (status) element.dataset.status = status;
        else delete element.dataset.status;
    };

    let toastTimer = null;

    const showToast = (message, status = "success") => {
        const toast = $("#admin-toast");
        if (!toast) return;
        window.clearTimeout(toastTimer);
        toast.hidden = false;
        toast.textContent = message;
        toast.dataset.status = status;
        toastTimer = window.setTimeout(() => {
            toast.hidden = true;
        }, 4200);
    };

    const setBusy = (id, busy) => {
        const element = typeof id === "string" ? document.getElementById(id) : id;
        if (!element) return;
        element.disabled = busy;
        element.classList.toggle("is-loading", busy);
        if (busy) element.setAttribute("aria-busy", "true");
        else element.removeAttribute("aria-busy");
    };

    const normalizeText = (value) => String(value ?? "").trim().toLocaleLowerCase("pt-BR");

    const getErrorMessage = (error) => {
        const message = error?.message || "Erro desconhecido.";
        if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
        if (/email not confirmed/i.test(message)) return "Este usuário ainda não confirmou o e-mail.";
        if (/row-level security/i.test(message)) return "O banco recusou a operação por RLS. Verifique se sua conta está autorizada como administradora.";
        if (/permission denied/i.test(message)) return "O banco recusou a operação por falta de permissão.";
        return message;
    };

    /* ============================================================
       02. SUPABASE / AUTH
    ============================================================ */

    function createClient() {
        if (!window.supabase?.createClient) return null;
        return window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: "solaris-admin-auth"
            }
        });
    }

    async function verifyAdmin(user) {
        if (!user?.id || !state.supabase) return null;

        const { data, error } = await withTimeout(
            state.supabase
                .from(CONFIG.tables.admins)
                .select("user_id, nome, created_at")
                .eq("user_id", user.id)
                .maybeSingle()
        );

        if (error) throw error;
        return data || null;
    }

    async function requireAdmin() {
        if (!state.supabase) throw new Error("Biblioteca do Supabase não está disponível.");

        const { data: sessionData, error: sessionError } = await withTimeout(
            state.supabase.auth.getSession()
        );
        if (sessionError) throw sessionError;

        const session = sessionData?.session;
        if (!session?.user) return false;

        const { data: userData, error: userError } = await withTimeout(
            state.supabase.auth.getUser()
        );
        if (userError) throw userError;

        const user = userData?.user;
        if (!user) return false;

        const admin = await verifyAdmin(user);
        if (!admin) {
            await state.supabase.auth.signOut({ scope: "local" });
            throw new Error("Esta conta está autenticada, mas não está cadastrada em admin_usuarios.");
        }

        state.user = user;
        state.admin = admin;
        return true;
    }

    async function signIn(email, password) {
        const { data, error } = await withTimeout(
            state.supabase.auth.signInWithPassword({ email, password })
        );
        if (error) throw error;
        if (!data?.user) throw new Error("O Supabase não retornou um usuário autenticado.");

        const admin = await verifyAdmin(data.user);
        if (!admin) {
            await state.supabase.auth.signOut({ scope: "local" });
            throw new Error("Login realizado, mas esta conta não possui acesso administrativo.");
        }

        state.user = data.user;
        state.admin = admin;
        return admin;
    }

    async function signOut() {
        try {
            await state.supabase?.auth.signOut({ scope: "local" });
        } finally {
            state.user = null;
            state.admin = null;
            showLoginView();
        }
    }

    /* ============================================================
       03. TEMA
    ============================================================ */

    function applyTheme(theme) {
        state.theme = theme === "dark" ? "dark" : "light";
        document.body.dataset.theme = state.theme;
        try { localStorage.setItem(CONFIG.storage.theme, state.theme); } catch {}

        const button = $("#admin-theme-toggle");
        const dark = state.theme === "dark";
        if (button) {
            button.setAttribute("aria-pressed", String(dark));
            button.setAttribute("aria-label", dark ? "Ativar modo claro" : "Ativar modo escuro");
            const spans = button.querySelectorAll("span");
            if (spans[0]) spans[0].textContent = dark ? "☀" : "☾";
            if (spans[1]) spans[1].textContent = dark ? "Modo claro" : "Modo escuro";
        }
    }

    function initTheme() {
        let saved = null;
        try { saved = localStorage.getItem(CONFIG.storage.theme); } catch {}
        if (!saved) saved = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        applyTheme(saved);
        $("#admin-theme-toggle")?.addEventListener("click", () => {
            applyTheme(state.theme === "dark" ? "light" : "dark");
        });
    }

    /* ============================================================
       04. VIEW / NAVEGAÇÃO
    ============================================================ */

    function showLoginView() {
        const login = $("#admin-login");
        const dashboard = $("#conteudo-admin");
        if (login) login.hidden = false;
        if (dashboard) dashboard.hidden = true;
        $("#admin-email")?.focus();
    }

    function showDashboardView() {
        const login = $("#admin-login");
        const dashboard = $("#conteudo-admin");
        if (login) login.hidden = true;
        if (dashboard) dashboard.hidden = false;

        const name = state.admin?.nome || state.user?.email || "administrador";
        const description = $("#admin-user-description");
        const sidebarUser = $("#admin-sidebar-user");
        const avatar = $(".user-avatar");
        if (description) description.textContent = `Bem-vindo, ${name}. Aqui está o que aconteceu no Solaris.`;
        if (sidebarUser) sidebarUser.textContent = name;
        if (avatar) avatar.textContent = String(name).trim().charAt(0).toUpperCase() || "A";
    }

    function selectTab(name, focus = false) {
        const allowed = new Set(["overview", "messages", "brazil", "analytics"]);
        const tabName = allowed.has(name) ? name : "overview";
        state.activeTab = tabName;

        const tabs = $$('[data-admin-tab]');
        const panels = $$('[data-admin-panel]');
        const titles = { overview: "Início", messages: "Mensagens", brazil: "Brasil", analytics: "Analytics" };
        const title = $("#admin-page-title");
        const overviewRefresh = $("#admin-overview-refresh");
        if (title) title.textContent = titles[tabName] || "Início";
        if (overviewRefresh) overviewRefresh.hidden = tabName !== "overview";

        tabs.forEach((tab) => {
            const active = tab.dataset.adminTab === tabName;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
            if (active && focus) tab.focus();
        });

        panels.forEach((panel) => {
            const active = panel.dataset.adminPanel === tabName;
            panel.hidden = !active;
            panel.classList.toggle("is-active", active);
        });

        if (tabName === "overview") loadOverview();
        if (tabName === "messages") loadMessages();
        if (tabName === "brazil") loadBrazil();
        if (tabName === "sources") loadSources();
        if (tabName === "analytics") loadAnalytics();
        if (tabName === "sessions") loadSessions();
    }

    function initBrazilViews() {
        const buttons = $$('[data-brazil-view]');
        const views = $$('[data-brazil-section]');
        if (!buttons.length || !views.length) return;

        const select = (name) => {
            const target = name === "sources" ? "sources" : "data";
            buttons.forEach((button) => {
                const active = button.dataset.brazilView === target;
                button.classList.toggle("is-active", active);
                button.setAttribute("aria-selected", String(active));
            });
            views.forEach((view) => {
                const active = view.dataset.brazilSection === target;
                view.hidden = !active;
            });
            if (target === "sources") loadSources();
            else loadBrazil();
        };

        buttons.forEach((button) => {
            button.addEventListener("click", () => select(button.dataset.brazilView));
        });

        select("data");
    }

    function initNavigation() {
        const tabs = $$('[data-admin-tab]');
        tabs.forEach((tab, index) => {
            tab.addEventListener("click", () => selectTab(tab.dataset.adminTab));
            tab.addEventListener("keydown", (event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                let next = index;
                if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
                if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
                if (event.key === "Home") next = 0;
                if (event.key === "End") next = tabs.length - 1;
                selectTab(tabs[next]?.dataset.adminTab, true);
            });
        });

        $$('[data-admin-go]').forEach((button) => {
            button.addEventListener("click", () => selectTab(button.dataset.adminGo));
        });
    }

    /* ============================================================
       05. DASHBOARD
    ============================================================ */

    async function loadCount(table, filterColumn = null, filterValue = null) {
        let query = state.supabase.from(table).select("id", { count: "exact", head: true });
        if (filterColumn && filterValue) query = query.eq(filterColumn, filterValue);
        const { count, error } = await withTimeout(query);
        if (error) throw error;
        return count || 0;
    }

    async function loadOverview() {
        if (!state.user || state.loading.has("overview")) return;
        state.loading.add("overview");
        setBusy("admin-overview-refresh", true);

        try {
            const [newMessages, sessionsCount, analyticsResult, recentMessages, latestSession] = await Promise.all([
                loadCount(CONFIG.tables.messages, "status", "nova"),
                loadCount(CONFIG.tables.sessions),
                withTimeout(state.supabase.from(CONFIG.tables.analytics)
                    .select("id,sessao_id,tipo,pagina,criado_em")
                    .order("criado_em", { ascending: false }).limit(2000)),
                withTimeout(state.supabase.from(CONFIG.tables.messages)
                    .select("id,nome,assunto,status,created_at")
                    .order("created_at", { ascending: false }).limit(5)),
                withTimeout(state.supabase.from(CONFIG.tables.sessions)
                    .select("ultima_atividade")
                    .order("ultima_atividade", { ascending: false }).limit(1))
            ]);

            const errors = [analyticsResult, recentMessages, latestSession].filter((item) => item?.error);
            if (errors.length) throw errors[0].error;

            const analyticsRows = analyticsResult.data || [];
            const visibleRows = getAnalyticsRowsForDisplay(analyticsRows);
            const pageViews = visibleRows.filter((row) => row?.tipo === "page_view").length;
            const interactions = visibleRows.filter((row) => row?.tipo !== "page_view").length;
            const latestActivity = analyticsRows[0]?.criado_em || latestSession.data?.[0]?.ultima_atividade || null;

            $("#admin-stat-new-messages").textContent = formatNumber(newMessages);
            $("#admin-stat-sessions").textContent = formatNumber(sessionsCount);
            $("#admin-stat-page-views").textContent = formatNumber(pageViews);
            $("#admin-stat-interactions").textContent = formatNumber(interactions);
            $("#admin-stat-latest").textContent = latestActivity ? formatDate(latestActivity) : "—";

            $("#admin-stat-new-messages-meta").textContent = newMessages === 1 ? "1 mensagem aguardando" : `${formatNumber(newMessages)} mensagens aguardando`;
            $("#admin-stat-sessions-meta").textContent = "Acessos registrados";
            $("#admin-stat-page-views-meta").textContent = "Visualizações únicas por sessão/página";
            $("#admin-stat-interactions-meta").textContent = "Simulador e formulário";
            $("#admin-stat-latest-meta").textContent = latestActivity ? "Atividade mais recente" : "Sem atividade";

            renderRecentMessages(recentMessages.data || []);
            renderRecentEvents(visibleRows.slice(0, 5));
            renderMessageBadge(newMessages);
        } catch (error) {
            console.error("Solaris Admin: overview", error);
            showFeedback(`Não foi possível carregar o início: ${getErrorMessage(error)}`, "error");
        } finally {
            state.loading.delete("overview");
            setBusy("admin-overview-refresh", false);
        }
    }

    function renderRecentMessages(rows) {
        const container = $("#admin-recent-messages");
        if (!container) return;
        if (!rows.length) {
            container.innerHTML = '<p class="empty-state">Nenhuma mensagem encontrada.</p>';
            return;
        }
        container.innerHTML = rows.map((row) => `
            <button class="activity-item" type="button" data-open-message="${escapeHtml(row.id)}">
                <span class="activity-dot" aria-hidden="true"></span>
                <span>
                    <strong>${escapeHtml(row.nome || "Sem nome")}</strong>
                    <small>${escapeHtml(row.assunto || "Sem assunto")}</small>
                </span>
                <time datetime="${escapeHtml(row.created_at)}">${escapeHtml(formatDate(row.created_at))}</time>
            </button>
        `).join("");
        $$('[data-open-message]', container).forEach((button) => {
            button.addEventListener("click", async () => {
                await openMessage(button.dataset.openMessage);
            });
        });
    }

    function renderRecentEvents(rows) {
        const container = $("#admin-recent-events");
        if (!container) return;
        if (!rows.length) {
            container.innerHTML = '<p class="empty-state">Nenhum evento encontrado.</p>';
            return;
        }
        container.innerHTML = rows.map((row) => `
            <div class="activity-item">
                <span class="activity-dot" aria-hidden="true"></span>
                <span>
                    <strong>${escapeHtml(getAnalyticsLabel(row.tipo))}</strong>
                    <small>${escapeHtml(row.pagina || "Página inicial")}</small>
                </span>
                <time datetime="${escapeHtml(row.criado_em)}">${escapeHtml(formatDate(row.criado_em))}</time>
            </div>
        `).join("");
    }

    function renderMessageBadge(count) {
        const badge = $("#admin-messages-badge");
        if (!badge) return;
        badge.textContent = String(count);
        badge.hidden = count <= 0;
    }

    /* ============================================================
       06. MENSAGENS
    ============================================================ */

    async function fetchMessages() {
        let query = state.supabase.from(CONFIG.tables.messages)
            .select("id,nome,email,telefone,empresa,perfil,assunto,interesses,mensagem,status,created_at,lida_em,respondida_em,observacoes")
            .order("created_at", { ascending: false })
            .limit(1000);

        if (state.messages.status) query = query.eq("status", state.messages.status);
        const { data, error } = await withTimeout(query);
        if (error) throw error;
        return data || [];
    }

    function applyMessageFilters() {
        const search = normalizeText(state.messages.search);
        state.messages.filtered = state.messages.all.filter((row) => {
            if (!search) return true;
            const haystack = [row.nome, row.email, row.assunto, row.empresa, row.perfil]
                .map(normalizeText).join(" ");
            return haystack.includes(search);
        });
        const totalPages = Math.max(1, Math.ceil(state.messages.filtered.length / CONFIG.pageSizes.messages));
        state.messages.page = Math.min(state.messages.page, totalPages);
    }

    function renderMessages() {
        applyMessageFilters();
        const body = $("#admin-messages-body");
        if (!body) return;

        const size = CONFIG.pageSizes.messages;
        const totalPages = Math.max(1, Math.ceil(state.messages.filtered.length / size));
        state.messages.page = Math.min(state.messages.page, totalPages);
        const start = (state.messages.page - 1) * size;
        const rows = state.messages.filtered.slice(start, start + size);

        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="5" class="empty-cell">Nenhuma mensagem encontrada.</td></tr>';
        } else {
            body.innerHTML = rows.map((row) => `
                <tr>
                    <td>${escapeHtml(formatDate(row.created_at))}</td>
                    <td><strong>${escapeHtml(row.nome || "Sem nome")}</strong><br><small>${escapeHtml(row.email || "Sem e-mail")}</small></td>
                    <td>${escapeHtml(row.assunto || "Sem assunto")}</td>
                    <td><span class="status-pill" data-status="${escapeHtml(row.status || "nova")}">${escapeHtml(row.status || "nova")}</span></td>
                    <td>
                        <button class="table-action" type="button" data-message-open="${escapeHtml(row.id)}">Abrir</button>
                        <button class="table-action danger" type="button" data-message-delete="${escapeHtml(row.id)}">Excluir</button>
                    </td>
                </tr>
            `).join("");
        }

        $("#admin-messages-page").textContent = `Página ${state.messages.page} de ${totalPages}`;
        $("#admin-messages-prev").disabled = state.messages.page <= 1;
        $("#admin-messages-next").disabled = state.messages.page >= totalPages;

        $$('[data-message-open]', body).forEach((button) => button.addEventListener("click", () => openMessage(button.dataset.messageOpen)));
        $$('[data-message-delete]', body).forEach((button) => button.addEventListener("click", () => deleteMessage(button.dataset.messageDelete)));
    }


    async function loadMessages() {
        if (!state.user || state.loading.has("messages")) return;
        state.loading.add("messages");
        setBusy("admin-messages-refresh", true);
        try {
            state.messages.all = await fetchMessages();
            state.messages.page = 1;
            renderMessages();
            renderMessageBadge(state.messages.all.filter((row) => row.status === "nova").length);
        } catch (error) {
            console.error("Solaris Admin: messages", error);
            showFeedback(`Não foi possível carregar as mensagens: ${getErrorMessage(error)}`, "error");
        } finally {
            state.loading.delete("messages");
            setBusy("admin-messages-refresh", false);
        }
    }

    async function openMessage(id) {
        const row = state.messages.all.find((item) => item.id === id);
        if (!row) {
            try {
                const { data, error } = await withTimeout(
                    state.supabase.from(CONFIG.tables.messages).select("*").eq("id", id).maybeSingle()
                );
                if (error) throw error;
                if (!data) return;
                state.messages.all.unshift(data);
                return openMessage(id);
            } catch (error) {
                showToast(`Não foi possível abrir a mensagem: ${getErrorMessage(error)}`, "error");
                return;
            }
        }

        const dialog = $("#admin-message-dialog");
        const details = $("#admin-message-details");
        const form = $("#admin-message-edit-form");
        if (!dialog || !details || !form) return;

        const interests = Array.isArray(row.interesses) ? row.interesses : [];
        details.innerHTML = `
            <dl class="message-summary">
                <div><dt>Nome</dt><dd>${escapeHtml(row.nome)}</dd></div>
                <div><dt>E-mail</dt><dd><a href="mailto:${escapeHtml(row.email)}">${escapeHtml(row.email)}</a></dd></div>
                <div><dt>Telefone</dt><dd>${escapeHtml(row.telefone || "—")}</dd></div>
                <div><dt>Empresa</dt><dd>${escapeHtml(row.empresa || "—")}</dd></div>
                <div><dt>Perfil</dt><dd>${escapeHtml(row.perfil || "—")}</dd></div>
                <div><dt>Assunto</dt><dd>${escapeHtml(row.assunto)}</dd></div>
                <div><dt>Recebida</dt><dd>${escapeHtml(formatDate(row.created_at))}</dd></div>
                <div><dt>Status</dt><dd><span class="status-pill" data-status="${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></dd></div>
            </dl>
            <div class="message-body">${escapeHtml(row.mensagem)}</div>
            <div style="margin-top:18px">
                <strong>Interesses</strong>
                <div class="interests">
                    ${interests.length ? interests.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("") : '<span class="empty-state" style="padding:0 !important">Nenhum informado.</span>'}
                </div>
            </div>
        `;

        $("#admin-message-id").value = row.id;
        $("#admin-message-status").value = row.status || "nova";
        $("#admin-message-notes").value = row.observacoes || "";
        $("#admin-message-feedback").textContent = "";
        form.hidden = false;

        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.hidden = false;
    }

    async function saveMessage(event) {
        event.preventDefault();
        const id = $("#admin-message-id")?.value;
        const status = $("#admin-message-status")?.value;
        const notes = $("#admin-message-notes")?.value.trim() || null;
        const button = $("#admin-message-edit-form button[type='submit']");
        if (!id || !status) return;

        setBusy(button, true);
        try {
            const current = state.messages.all.find((row) => row.id === id);
            const now = new Date().toISOString();
            const patch = {
                status,
                observacoes: notes,
                lida_em: status === "nova" ? null : (current?.lida_em || now),
                respondida_em: status === "respondida" ? (current?.respondida_em || now) : null
            };

            const { error } = await withTimeout(
                state.supabase.from(CONFIG.tables.messages).update(patch).eq("id", id)
            );
            if (error) throw error;

            showFeedback("Mensagem atualizada.", "success");
            showToast("Mensagem atualizada.");
            closeMessageDialog();
            await loadMessages();
            await loadOverview();
        } catch (error) {
            console.error("Solaris Admin: save message", error);
            $("#admin-message-feedback").textContent = getErrorMessage(error);
            showToast("Não foi possível salvar a mensagem.", "error");
        } finally {
            setBusy(button, false);
        }
    }

    async function deleteMessage(id) {
        const row = state.messages.all.find((item) => item.id === id);
        const confirmed = window.confirm(`Excluir definitivamente a mensagem de ${row?.nome || "este contato"}?`);
        if (!confirmed) return;

        try {
            const { error } = await withTimeout(
                state.supabase.from(CONFIG.tables.messages).delete().eq("id", id)
            );
            if (error) throw error;
            closeMessageDialog();
            showToast("Mensagem excluída.");
            await loadMessages();
            await loadOverview();
        } catch (error) {
            console.error("Solaris Admin: delete message", error);
            showToast(`Não foi possível excluir: ${getErrorMessage(error)}`, "error");
        }
    }


    function initMessages() {
        $("#admin-message-search")?.addEventListener("input", debounce((event) => {
            state.messages.search = event.target.value;
            state.messages.page = 1;
            renderMessages();
        }));

        $("#admin-message-status-filter")?.addEventListener("change", (event) => {
            state.messages.status = event.target.value;
            state.messages.page = 1;
            loadMessages();
        });

        $("#admin-messages-prev")?.addEventListener("click", () => {
            state.messages.page = Math.max(1, state.messages.page - 1);
            renderMessages();
        });
        $("#admin-messages-next")?.addEventListener("click", () => {
            const total = Math.max(1, Math.ceil(state.messages.filtered.length / CONFIG.pageSizes.messages));
            state.messages.page = Math.min(total, state.messages.page + 1);
            renderMessages();
        });

        $("#admin-messages-refresh")?.addEventListener("click", loadMessages);
    }

    /* ============================================================
       07. DADOS DO BRASIL
    ============================================================ */

    async function loadSources(options = {}) {
        if (!state.user && !options.allowAnonymous) return;
        if (state.loading.has("sources")) return;
        state.loading.add("sources");
        setBusy("admin-source-new", true);
        try {
            const { data, error } = await withTimeout(
                state.supabase.from(CONFIG.tables.sources)
                    .select("id,instituicao,titulo,ano,url,created_at")
                    .order("ano", { ascending: false })
                    .order("instituicao", { ascending: true })
                    .limit(1000)
            );
            if (error) throw error;
            state.sources.rows = data || [];
            populateSourceOptions();
            renderSources();
        } catch (error) {
            console.error("Solaris Admin: sources", error);
            showFeedback(`Não foi possível carregar as fontes: ${getErrorMessage(error)}`, "error");
        } finally {
            state.loading.delete("sources");
            setBusy("admin-source-new", false);
        }
    }

    function sourceLabel(id) {
        const source = state.sources.rows.find((item) => String(item.id) === String(id));
        return source ? `${source.instituicao} — ${source.ano}` : "Sem fonte";
    }

    function populateSourceOptions() {
        const select = $("#admin-brazil-source");
        if (!select) return;
        const current = select.value;
        select.innerHTML = '<option value="">Sem fonte selecionada</option>' + state.sources.rows.map((source) =>
            `<option value="${escapeHtml(source.id)}">${escapeHtml(source.instituicao)} — ${escapeHtml(source.titulo)} (${escapeHtml(source.ano)})</option>`
        ).join("");
        if (current) select.value = current;
    }

    async function loadBrazil() {
        if (!state.user || state.loading.has("brazil")) return;
        state.loading.add("brazil");
        try {
            if (!state.sources.rows.length) await loadSources();
            const { data, error } = await withTimeout(
                state.supabase.from(CONFIG.tables.brazil)
                    .select("id,ano,capacidade_gw,geracao_twh,participacao_percentual,fonte_id,created_at")
                    .order("ano", { ascending: false })
            );
            if (error) throw error;
            state.brazil.rows = data || [];
            renderBrazil();
        } catch (error) {
            console.error("Solaris Admin: Brazil", error);
            showFeedback(`Não foi possível carregar os dados do Brasil: ${getErrorMessage(error)}`, "error");
        } finally {
            state.loading.delete("brazil");
        }
    }

    function renderBrazil() {
        const body = $("#admin-brazil-body");
        if (!body) return;
        if (!state.brazil.rows.length) {
            body.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum registro cadastrado.</td></tr>';
            return;
        }
        body.innerHTML = state.brazil.rows.map((row) => `
            <tr>
                <td>${escapeHtml(row.ano)}</td>
                <td>${escapeHtml(formatNumber(row.capacidade_gw, 2))} GW</td>
                <td>${escapeHtml(formatNumber(row.geracao_twh, 2))} TWh</td>
                <td>${escapeHtml(formatNumber(row.participacao_percentual, 2))}%</td>
                <td>${escapeHtml(sourceLabel(row.fonte_id))}</td>
                <td>
                    <button class="table-action" type="button" data-brazil-edit="${escapeHtml(row.id)}">Editar</button>
                    <button class="table-action danger" type="button" data-brazil-delete="${escapeHtml(row.id)}">Excluir</button>
                </td>
            </tr>
        `).join("");

        $$('[data-brazil-edit]', body).forEach((button) => button.addEventListener("click", () => editBrazil(button.dataset.brazilEdit)));
        $$('[data-brazil-delete]', body).forEach((button) => button.addEventListener("click", () => deleteBrazil(button.dataset.brazilDelete)));
    }

    function resetBrazilForm() {
        state.brazil.editingId = null;
        const form = $("#admin-brazil-form");
        if (!form) return;
        form.reset();
        $("#admin-brazil-id").value = "";
        $("#admin-brazil-feedback").textContent = "";
        form.hidden = true;
        $("#admin-brazil-year")?.focus();
    }

    function editBrazil(id) {
        const row = state.brazil.rows.find((item) => String(item.id) === String(id));
        if (!row) return;
        state.brazil.editingId = row.id;
        $("#admin-brazil-form").hidden = false;
        $("#admin-brazil-id").value = row.id;
        $("#admin-brazil-year").value = row.ano;
        $("#admin-brazil-capacity").value = row.capacidade_gw;
        $("#admin-brazil-generation").value = row.geracao_twh;
        $("#admin-brazil-share").value = row.participacao_percentual;
        $("#admin-brazil-source").value = row.fonte_id || "";
        $("#admin-brazil-year").focus();
    }

    async function saveBrazil(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const id = $("#admin-brazil-id")?.value || "";
        const payload = {
            ano: Number($("#admin-brazil-year")?.value),
            capacidade_gw: Number($("#admin-brazil-capacity")?.value),
            geracao_twh: Number($("#admin-brazil-generation")?.value),
            participacao_percentual: Number($("#admin-brazil-share")?.value),
            fonte_id: $("#admin-brazil-source")?.value ? Number($("#admin-brazil-source")?.value) : null
        };
        if (!Number.isInteger(payload.ano) || !Number.isFinite(payload.capacidade_gw) || !Number.isFinite(payload.geracao_twh) || !Number.isFinite(payload.participacao_percentual)) {
            $("#admin-brazil-feedback").textContent = "Preencha todos os campos numéricos corretamente.";
            return;
        }

        const button = $("#admin-brazil-save");
        setBusy(button, true);
        try {
            const query = id
                ? state.supabase.from(CONFIG.tables.brazil).update(payload).eq("id", id)
                : state.supabase.from(CONFIG.tables.brazil).insert(payload);
            const { error } = await withTimeout(query);
            if (error) throw error;
            showToast(id ? "Registro atualizado." : "Registro criado.");
            showFeedback("Dados do Brasil salvos.", "success");
            resetBrazilForm();
            await loadBrazil();
        } catch (error) {
            console.error("Solaris Admin: save Brazil", error);
            $("#admin-brazil-feedback").textContent = getErrorMessage(error);
            showToast("Não foi possível salvar o registro.", "error");
        } finally {
            setBusy(button, false);
        }
    }

    async function deleteBrazil(id) {
        const row = state.brazil.rows.find((item) => String(item.id) === String(id));
        if (!row || !window.confirm(`Excluir o registro de ${row.ano}?`)) return;
        try {
            const { error } = await withTimeout(
                state.supabase.from(CONFIG.tables.brazil).delete().eq("id", id)
            );
            if (error) throw error;
            showToast("Registro excluído.");
            await loadBrazil();
        } catch (error) {
            console.error("Solaris Admin: delete Brazil", error);
            showToast(`Não foi possível excluir: ${getErrorMessage(error)}`, "error");
        }
    }

    /* ============================================================
       08. FONTES
    ============================================================ */

    function renderSources() {
        const body = $("#admin-sources-body");
        if (!body) return;
        if (!state.sources.rows.length) {
            body.innerHTML = '<p class="empty-state">Nenhuma fonte cadastrada.</p>';
            return;
        }
        body.innerHTML = state.sources.rows.map((row) => `
            <article class="source-card">
                <div class="source-meta"><span>${escapeHtml(row.instituicao)}</span><span>${escapeHtml(row.ano)}</span></div>
                <h4>${escapeHtml(row.titulo)}</h4>
                <p>Referência usada no conteúdo público da Solaris.</p>
                <a href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">Abrir fonte ↗</a>
                <div class="form-actions">
                    <button class="table-action" type="button" data-source-edit="${escapeHtml(row.id)}">Editar</button>
                    <button class="table-action danger" type="button" data-source-delete="${escapeHtml(row.id)}">Excluir</button>
                </div>
            </article>
        `).join("");
        $$('[data-source-edit]', body).forEach((button) => button.addEventListener("click", () => editSource(button.dataset.sourceEdit)));
        $$('[data-source-delete]', body).forEach((button) => button.addEventListener("click", () => deleteSource(button.dataset.sourceDelete)));
    }

    function resetSourceForm() {
        state.sources.editingId = null;
        const form = $("#admin-source-form");
        if (!form) return;
        form.reset();
        $("#admin-source-id").value = "";
        $("#admin-source-feedback").textContent = "";
        form.hidden = true;
    }

    function editSource(id) {
        const row = state.sources.rows.find((item) => String(item.id) === String(id));
        if (!row) return;
        state.sources.editingId = row.id;
        $("#admin-source-form").hidden = false;
        $("#admin-source-id").value = row.id;
        $("#admin-source-institution").value = row.instituicao;
        $("#admin-source-title").value = row.titulo;
        $("#admin-source-year").value = row.ano;
        $("#admin-source-url").value = row.url;
        $("#admin-source-institution").focus();
    }

    async function saveSource(event) {
        event.preventDefault();
        const id = $("#admin-source-id")?.value || "";
        const payload = {
            instituicao: $("#admin-source-institution")?.value.trim(),
            titulo: $("#admin-source-title")?.value.trim(),
            ano: Number($("#admin-source-year")?.value),
            url: $("#admin-source-url")?.value.trim()
        };
        if (!payload.instituicao || !payload.titulo || !Number.isInteger(payload.ano) || !payload.url) {
            $("#admin-source-feedback").textContent = "Preencha instituição, título, ano e URL.";
            return;
        }
        try {
            const query = id
                ? state.supabase.from(CONFIG.tables.sources).update(payload).eq("id", id)
                : state.supabase.from(CONFIG.tables.sources).insert(payload);
            const { error } = await withTimeout(query);
            if (error) throw error;
            showToast(id ? "Fonte atualizada." : "Fonte criada.");
            showFeedback("Fonte salva.", "success");
            resetSourceForm();
            await loadSources();
            if (state.activeTab === "brazil") await loadBrazil();
        } catch (error) {
            console.error("Solaris Admin: save source", error);
            $("#admin-source-feedback").textContent = getErrorMessage(error);
            showToast("Não foi possível salvar a fonte.", "error");
        }
    }

    async function deleteSource(id) {
        const row = state.sources.rows.find((item) => String(item.id) === String(id));
        if (!row || !window.confirm(`Excluir a fonte “${row.titulo}”?`)) return;
        try {
            const { error } = await withTimeout(
                state.supabase.from(CONFIG.tables.sources).delete().eq("id", id)
            );
            if (error) throw error;
            showToast("Fonte excluída.");
            await loadSources();
            if (state.activeTab === "brazil") await loadBrazil();
        } catch (error) {
            console.error("Solaris Admin: delete source", error);
            showToast(`Não foi possível excluir. Ela pode estar vinculada a dados do Brasil. ${getErrorMessage(error)}`, "error");
        }
    }

    /* ============================================================
       09. ANALYTICS + ACESSOS

       A interface apresenta indicadores simples. Os registros brutos
       continuam no Supabase, mas não ficam expostos ao administrador.
    ============================================================ */

    const ANALYTICS_LABELS = Object.freeze({
        page_view: "Visualização",
        simulador_usado: "Simulador usado",
        formulario_iniciado: "Formulário iniciado",
        formulario_enviado: "Formulário enviado"
    });

    function getAnalyticsLabel(type) {
        return ANALYTICS_LABELS[type] || type || "Evento";
    }

    function getAnalyticsRowsForDisplay(rows) {
        const seenPageViews = new Set();
        return (rows || []).filter((row) => {
            if (row?.tipo !== "page_view") return true;
            const key = `${row?.sessao_id || "sem-sessao"}|${row?.pagina || "/"}`;
            if (seenPageViews.has(key)) return false;
            seenPageViews.add(key);
            return true;
        });
    }

    function getAnalyticsSummary(rows) {
        const visibleRows = getAnalyticsRowsForDisplay(rows);
        const sessions = new Set(visibleRows.map((row) => row?.sessao_id).filter(Boolean));
        const pageViews = visibleRows.filter((row) => row?.tipo === "page_view").length;
        const interactions = visibleRows.filter((row) => row?.tipo !== "page_view").length;
        const latest = visibleRows[0]?.criado_em || null;
        return { visits: sessions.size, pageViews, interactions, latest };
    }

    function updateAnalyticsSummary(rows) {
        const summary = getAnalyticsSummary(rows);
        $("#admin-analytics-stat-visits") && ($("#admin-analytics-stat-visits").textContent = formatNumber(summary.visits));
        $("#admin-analytics-stat-views") && ($("#admin-analytics-stat-views").textContent = formatNumber(summary.pageViews));
        $("#admin-analytics-stat-interactions") && ($("#admin-analytics-stat-interactions").textContent = formatNumber(summary.interactions));
        $("#admin-analytics-stat-latest") && ($("#admin-analytics-stat-latest").textContent = summary.latest ? formatDate(summary.latest) : "—");
    }

    function updateAnalyticsPeriodLabel() {
        const label = $("#admin-analytics-period-label");
        if (!label) return;
        label.textContent = state.analytics.period === "all"
            ? "Todo o histórico"
            : `Últimos ${state.analytics.period} dias`;
    }

    function renderAnalyticsBreakdown(rows) {
        const container = $("#admin-analytics-breakdown");
        if (!container) return;
        const visibleRows = getAnalyticsRowsForDisplay(rows);
        const counts = {
            page_view: 0,
            simulador_usado: 0,
            formulario_iniciado: 0,
            formulario_enviado: 0
        };
        visibleRows.forEach((row) => {
            if (row?.tipo in counts) counts[row.tipo] += 1;
        });
        const total = Math.max(1, visibleRows.length);

        container.innerHTML = Object.entries(counts).map(([type, count]) => {
            const percent = Math.round((count / total) * 100);
            return `
                <div class="analytics-breakdown-row">
                    <div class="analytics-breakdown-head">
                        <span>${escapeHtml(getAnalyticsLabel(type))}</span>
                        <strong>${formatNumber(count)}</strong>
                    </div>
                    <div class="analytics-breakdown-track" aria-hidden="true">
                        <span style="width:${percent}%"></span>
                    </div>
                </div>
            `;
        }).join("");
    }

    function renderAnalyticsChart(rows) {
        const container = $("#admin-analytics-chart");
        if (!container) return;

        const visibleRows = getAnalyticsRowsForDisplay(rows);
        const dayMap = new Map();
        visibleRows.forEach((row) => {
            const date = new Date(row.criado_em);
            if (Number.isNaN(date.getTime())) return;
            const key = date.toISOString().slice(0, 10);
            dayMap.set(key, (dayMap.get(key) || 0) + 1);
        });

        const keys = [...dayMap.keys()].sort();
        const lastKeys = keys.slice(-14);
        const max = Math.max(1, ...lastKeys.map((key) => dayMap.get(key) || 0));

        if (!lastKeys.length) {
            container.innerHTML = '<div class="empty-state chart-empty">Ainda não há atividade suficiente para o gráfico.</div>';
            return;
        }

        container.innerHTML = lastKeys.map((key) => {
            const count = dayMap.get(key) || 0;
            const height = Math.max(8, Math.round((count / max) * 100));
            const date = new Date(`${key}T12:00:00`);
            const label = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date).replace(".", "");
            return `
                <div class="analytics-bar" title="${escapeHtml(`${count} atividade(s) em ${label}`)}">
                    <div class="analytics-bar-value">${formatNumber(count)}</div>
                    <div class="analytics-bar-track"><span style="height:${height}%"></span></div>
                    <div class="analytics-bar-label">${escapeHtml(label)}</div>
                </div>
            `;
        }).join("");
    }

    async function loadAnalytics() {
        if (!state.user || state.loading.has("analytics")) return;
        state.loading.add("analytics");
        setBusy("admin-analytics-refresh", true);

        try {
            let query = state.supabase.from(CONFIG.tables.analytics)
                .select("id,sessao_id,tipo,pagina,criado_em,metadata")
                .order("criado_em", { ascending: false })
                .limit(2000);

            if (state.analytics.type) query = query.eq("tipo", state.analytics.type);

            if (state.analytics.period !== "all") {
                const days = Number(state.analytics.period) || 7;
                const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
                query = query.gte("criado_em", since);
            }

            const { data, error } = await withTimeout(query);
            if (error) throw error;

            state.analytics.rows = data || [];
            renderAnalytics();
            updateAnalyticsPeriodLabel();
            await loadSessions();
        } catch (error) {
            console.error("Solaris Admin: analytics", error);
            showFeedback(`Não foi possível carregar analytics: ${getErrorMessage(error)}`, "error");
        } finally {
            state.loading.delete("analytics");
            setBusy("admin-analytics-refresh", false);
        }
    }

    function renderAnalytics() {
        const body = $("#admin-analytics-body");
        const rows = getAnalyticsRowsForDisplay(state.analytics.rows);

        updateAnalyticsSummary(state.analytics.rows);
        renderAnalyticsBreakdown(state.analytics.rows);
        renderAnalyticsChart(state.analytics.rows);

        if (!body) return;
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="3" class="empty-state">Nenhuma atividade encontrada neste período.</td></tr>';
            return;
        }

        body.innerHTML = rows.slice(0, 12).map((row) => `
            <tr>
                <td><time datetime="${escapeHtml(row.criado_em)}">${escapeHtml(formatDate(row.criado_em))}</time></td>
                <td><strong>${escapeHtml(getAnalyticsLabel(row.tipo))}</strong></td>
                <td>${escapeHtml(row.pagina || "/")}</td>
            </tr>
        `).join("");
    }

    /* ============================================================
       10. ACESSOS RECENTES
    ============================================================ */

    function getDeviceLabel(device) {
        const labels = {
            desktop: "Desktop",
            tablet: "Tablet",
            mobile: "Celular"
        };
        return labels[device] || device || "Não identificado";
    }

    function updateSessionsSummary(rows) {
        const list = rows || [];
        const total = list.length;
        const desktop = list.filter((row) => row?.dispositivo === "desktop").length;
        const mobile = list.filter((row) => ["mobile", "tablet"].includes(row?.dispositivo)).length;
        const latest = list[0]?.ultima_atividade || list[0]?.iniciado_em || null;

        $("#admin-sessions-stat-total")?.replaceChildren(document.createTextNode(formatNumber(total)));
        $("#admin-sessions-stat-desktop")?.replaceChildren(document.createTextNode(formatNumber(desktop)));
        $("#admin-sessions-stat-mobile")?.replaceChildren(document.createTextNode(formatNumber(mobile)));
        $("#admin-sessions-stat-latest")?.replaceChildren(document.createTextNode(latest ? formatDate(latest) : "—"));
    }

    async function loadSessions() {
        if (!state.user || state.loading.has("sessions")) return;
        state.loading.add("sessions");
        setBusy("admin-sessions-refresh", true);

        try {
            const { data, error } = await withTimeout(
                state.supabase.from(CONFIG.tables.sessions)
                    .select("id,iniciado_em,ultima_atividade,pagina_inicial,dispositivo")
                    .order("ultima_atividade", { ascending: false })
                    .limit(500)
            );
            if (error) throw error;

            state.sessions.rows = data || [];
            state.sessions.page = 1;
            renderSessions();
        } catch (error) {
            console.error("Solaris Admin: sessions", error);
            showFeedback(`Não foi possível carregar acessos: ${getErrorMessage(error)}`, "error");
        } finally {
            state.loading.delete("sessions");
            setBusy("admin-sessions-refresh", false);
        }
    }

    function renderSessions() {
        const body = $("#admin-sessions-body");
        if (!body) return;

        const size = CONFIG.pageSizes.sessions;
        const totalPages = Math.max(1, Math.ceil(state.sessions.rows.length / size));
        state.sessions.page = Math.min(state.sessions.page, totalPages);
        const start = (state.sessions.page - 1) * size;
        const rows = state.sessions.rows.slice(start, start + size);

        updateSessionsSummary(state.sessions.rows);

        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="4" class="empty-state">Nenhum acesso encontrado.</td></tr>';
        } else {
            body.innerHTML = rows.map((row) => `
                <tr>
                    <td>${escapeHtml(formatDate(row.iniciado_em))}</td>
                    <td>${escapeHtml(formatDate(row.ultima_atividade))}</td>
                    <td>${escapeHtml(row.pagina_inicial || "/")}</td>
                    <td><span class="device-pill">${escapeHtml(getDeviceLabel(row.dispositivo))}</span></td>
                </tr>
            `).join("");
        }

        $("#admin-sessions-page").textContent = `Página ${state.sessions.page} de ${totalPages}`;
        $("#admin-sessions-prev").disabled = state.sessions.page <= 1;
        $("#admin-sessions-next").disabled = state.sessions.page >= totalPages;
    }

    /* ============================================================
       11. MODAL / EVENTOS GERAIS
    ============================================================ */

    function closeMessageDialog() {
        const dialog = $("#admin-message-dialog");
        if (dialog?.open && typeof dialog.close === "function") dialog.close();
        else if (dialog) dialog.hidden = true;
    }

    function initGlobalEvents() {
        $("#admin-login-form")?.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!state.supabase) return;
            const email = $("#admin-email")?.value.trim().toLowerCase();
            const password = $("#admin-password")?.value || "";
            const button = $("#admin-login-submit");
            const feedback = $("#admin-login-feedback");

            if (!email || !password) {
                feedback.textContent = "Informe o e-mail e a senha.";
                feedback.dataset.status = "error";
                return;
            }

            setBusy(button, true);
            feedback.textContent = "Autenticando...";
            delete feedback.dataset.status;
            try {
                await signIn(email, password);
                feedback.textContent = "";
                showDashboardView();
                selectTab("overview");
                await loadOverview();
                showToast("Acesso autorizado.");
            } catch (error) {
                console.error("Solaris Admin: login", error);
                feedback.textContent = getErrorMessage(error);
                feedback.dataset.status = "error";
            } finally {
                setBusy(button, false);
            }
        });

        $("#admin-logout")?.addEventListener("click", signOut);
        $("#admin-overview-refresh")?.addEventListener("click", loadOverview);
        $("#admin-brazil-new")?.addEventListener("click", () => {
            resetBrazilForm();
            $("#admin-brazil-form").hidden = false;
            $("#admin-brazil-year")?.focus();
        });
        $("#admin-brazil-form")?.addEventListener("submit", saveBrazil);
        $("#admin-brazil-cancel")?.addEventListener("click", resetBrazilForm);

        $("#admin-source-new")?.addEventListener("click", () => {
            resetSourceForm();
            $("#admin-source-form").hidden = false;
            $("#admin-source-institution")?.focus();
        });
        $("#admin-source-form")?.addEventListener("submit", saveSource);
        $("#admin-source-cancel")?.addEventListener("click", resetSourceForm);

        $("#admin-analytics-refresh")?.addEventListener("click", loadAnalytics);
        $("#admin-analytics-type-filter")?.addEventListener("change", (event) => {
            state.analytics.type = event.target.value;
            loadAnalytics();
        });
        $("#admin-analytics-period-filter")?.addEventListener("change", (event) => {
            state.analytics.period = event.target.value || "7";
            loadAnalytics();
        });

        $("#admin-sessions-refresh")?.addEventListener("click", loadSessions);
        $("#admin-sessions-prev")?.addEventListener("click", () => {
            state.sessions.page = Math.max(1, state.sessions.page - 1);
            renderSessions();
        });
        $("#admin-sessions-next")?.addEventListener("click", () => {
            const total = Math.max(1, Math.ceil(state.sessions.rows.length / CONFIG.pageSizes.sessions));
            state.sessions.page = Math.min(total, state.sessions.page + 1);
            renderSessions();
        });

        $("#admin-message-edit-form")?.addEventListener("submit", saveMessage);
        $("#admin-message-delete")?.addEventListener("click", () => {
            const id = $("#admin-message-id")?.value;
            if (id) deleteMessage(id);
        });
        $("#admin-message-dialog-close")?.addEventListener("click", closeMessageDialog);
        $("#admin-message-dialog")?.addEventListener("cancel", (event) => event.preventDefault() || closeMessageDialog());
        $("#admin-message-dialog")?.addEventListener("click", (event) => {
            if (event.target === event.currentTarget) closeMessageDialog();
        });
    }

    /* ============================================================
       12. INICIALIZAÇÃO
    ============================================================ */

    async function boot() {
        initTheme();
        initNavigation();
        initBrazilViews();
        initMessages();
        initGlobalEvents();

        state.supabase = createClient();
        if (!state.supabase) {
            showLoginView();
            showFeedback("O cliente Supabase não foi carregado.", "error");
            return;
        }

        state.supabase.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_OUT") {
                state.user = null;
                state.admin = null;
                showLoginView();
            }
        });

        try {
            const authorized = await requireAdmin();
            if (authorized) {
                showDashboardView();
                selectTab("overview");
                await loadSources();
                await loadOverview();
                return;
            }
            showLoginView();
        } catch (error) {
            console.error("Solaris Admin: boot", error);
            showLoginView();
            showFeedback(getErrorMessage(error), "error");
        }
    }

    document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
