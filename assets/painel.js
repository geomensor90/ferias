let papelUsuario = null;      // 'gestor' ou 'funcionario'
let equipeAtual = localStorage.getItem("equipeAtual") || "AHAB";
let visaoAtual = "calendario"; // 'calendario' ou 'gantt'
let calendar = null;
let ganttInstance = null;
let editandoId = null;
let feriasCache = [];       // todas as férias, das duas equipes
let funcionariosCache = []; // todos os funcionários, das duas equipes

const el = (id) => document.getElementById(id);

function nomeCompleto(f) {
  return f.segundo_nome ? `${f.primeiro_nome} ${f.segundo_nome}` : f.primeiro_nome;
}

// ---------- Inicialização ----------
(async function iniciar() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return;
  }

  const userId = session.user.id;

  const { data: perfil, error: erroPerfil } = await supabaseClient
    .from("perfis")
    .select("papel")
    .eq("id", userId)
    .single();

  if (erroPerfil || !perfil) {
    alert("Este usuário não tem um papel definido (gestor/funcionario). Avise o administrador.");
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
    return;
  }

  papelUsuario = perfil.papel;
  montarInterfacePorPapel();
  montarSwitchEquipe();
  montarSwitchVisao();
  await carregarTudo();
})();

function montarInterfacePorPapel() {
  const badge = el("papel-badge");
  if (papelUsuario === "gestor") {
    badge.textContent = "Gestor";
    el("form-gestor").classList.remove("hidden");
    el("lista-gestor").classList.remove("hidden");
    el("btn-backup").classList.remove("hidden");
    el("filtro-auditor-wrap").classList.remove("hidden");
    el("legend-text").textContent = "Passe o mouse para ver quem está de férias";
  } else {
    badge.textContent = "Visualização";
    el("btn-backup").classList.add("hidden");
    el("filtro-auditor-wrap").classList.add("hidden");
    el("legend-text").textContent = "Passe o mouse para ver quantas pessoas estão de férias";
  }
}

// ---------- Seletor de equipe ----------
function montarSwitchEquipe() {
  const botoes = document.querySelectorAll("#switch-equipe .switch-option");
  atualizarBotoesEquipe();
  botoes.forEach((btn) => {
    btn.addEventListener("click", async () => {
      equipeAtual = btn.dataset.equipe;
      localStorage.setItem("equipeAtual", equipeAtual);
      atualizarBotoesEquipe();
      cancelarEdicao();
      await recarregarTudoVisual();
    });
  });
}

function atualizarBotoesEquipe() {
  document.querySelectorAll("#switch-equipe .switch-option").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.equipe === equipeAtual);
  });
}

// ---------- Seletor de visão (calendário / gantt) ----------
function montarSwitchVisao() {
  const botoes = document.querySelectorAll("#switch-visao .switch-option");
  atualizarBotoesVisao();
  botoes.forEach((btn) => {
    btn.addEventListener("click", () => {
      visaoAtual = btn.dataset.visao;
      atualizarBotoesVisao();
      alternarVisao();
    });
  });
}

function atualizarBotoesVisao() {
  document.querySelectorAll("#switch-visao .switch-option").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.visao === visaoAtual);
  });
}

function alternarVisao() {
  if (visaoAtual === "calendario") {
    el("calendar").classList.remove("hidden");
    el("gantt-wrap").classList.add("hidden");
  } else {
    el("calendar").classList.add("hidden");
    el("gantt-wrap").classList.remove("hidden");
    renderizarGantt();
  }
}

// ---------- Carregar dados ----------
async function carregarTudo() {
  const { data: funcionarios, error: erroFunc } = await supabaseClient
    .from("funcionarios")
    .select("id, primeiro_nome, segundo_nome, equipe")
    .order("primeiro_nome");

  if (!erroFunc) funcionariosCache = funcionarios;

  const { data: ferias, error: erroFerias } = await supabaseClient
    .from("ferias")
    .select("id, data_inicio, data_fim, funcionarios (id, primeiro_nome, segundo_nome, equipe)")
    .order("data_inicio");

  if (!erroFerias) feriasCache = ferias;

  await recarregarTudoVisual();
}

async function recarregarTudoVisual() {
  carregarFuncionariosNoSelect();
  const mapaDias = construirMapaDeDias(feriasFiltradas());
  renderizarCalendario(mapaDias);
  if (visaoAtual === "gantt") renderizarGantt();
  if (papelUsuario === "gestor") renderizarListaPeriodos(feriasFiltradas());
  montarFiltrosVisaoGeral();
  renderizarVisaoGeral();
}

function feriasFiltradas() {
  return feriasCache.filter((f) => f.funcionarios && f.funcionarios.equipe === equipeAtual);
}

function funcionariosFiltrados() {
  return funcionariosCache.filter((f) => f.equipe === equipeAtual);
}

// ---------- Select de funcionário (form do gestor) ----------
function carregarFuncionariosNoSelect() {
  if (papelUsuario !== "gestor") return;
  const select = el("select-funcionario");
  select.innerHTML = "";
  funcionariosFiltrados().forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = nomeCompleto(f);
    select.appendChild(opt);
  });
}

// ---------- Mapa de dias { "2026-08-10": ["Ana Silva", ...] } ----------
function construirMapaDeDias(listaFerias) {
  const mapa = {};
  listaFerias.forEach((f) => {
    const nome = nomeCompleto(f.funcionarios);
    let cursor = new Date(f.data_inicio + "T00:00:00");
    const fim = new Date(f.data_fim + "T00:00:00");
    while (cursor <= fim) {
      const chave = cursor.toISOString().slice(0, 10);
      if (!mapa[chave]) mapa[chave] = [];
      mapa[chave].push(nome);
      cursor.setDate(cursor.getDate() + 1);
    }
  });
  return mapa;
}

// ---------- Calendário ----------
function renderizarCalendario(mapaDias) {
  const eventos = Object.keys(mapaDias).map((data) => ({
    start: data,
    display: "background",
    classNames: ["dia-ferias"],
    extendedProps: { nomes: mapaDias[data] },
  }));

  const containerEl = el("calendar");
  if (calendar) calendar.destroy();

  calendar = new FullCalendar.Calendar(containerEl, {
    locale: "pt-br",
    height: "auto",
    headerToolbar: { left: "prev,next today", center: "title", right: "" },
    events: eventos,
    eventDidMount: function (info) {
      const nomes = info.event.extendedProps.nomes || [];
      if (nomes.length === 0) return;
      if (papelUsuario === "gestor") {
        info.el.title = `${nomes.join(", ")} (${nomes.length})`;
      } else {
        info.el.title = `${nomes.length} pessoa(s) de férias`;
      }
    },
  });

  calendar.render();
}

// ---------- Gráfico Gantt ----------
function renderizarGantt() {
  const wrap = el("gantt-wrap");
  wrap.innerHTML = '<svg id="gantt"></svg>';

  let tarefas = [];

  if (papelUsuario === "gestor") {
    // Uma barra por período, com o nome do auditor
    tarefas = feriasFiltradas().map((f) => ({
      id: String(f.id),
      name: nomeCompleto(f.funcionarios),
      start: f.data_inicio,
      end: f.data_fim,
      progress: 100,
    }));
  } else {
    // Sem nomes: agrupa dias consecutivos com a mesma quantidade de pessoas
    const mapaDias = construirMapaDeDias(feriasFiltradas());
    tarefas = construirSegmentosDeOcupacao(mapaDias).map((seg, i) => ({
      id: `seg-${i}`,
      name: `${seg.count} pessoa(s) de férias`,
      start: seg.start,
      end: seg.end,
      progress: 100,
    }));
  }

  if (tarefas.length === 0) {
    wrap.innerHTML = "<p class='vazio'>Nenhum período para exibir nesta equipe.</p>";
    return;
  }

  ganttInstance = new Gantt("#gantt", tarefas);
}

// Agrupa dias consecutivos com a mesma contagem de pessoas em "segmentos"
function construirSegmentosDeOcupacao(mapaDias) {
  const datas = Object.keys(mapaDias).sort();
  const segmentos = [];
  let atual = null;

  datas.forEach((data) => {
    const count = mapaDias[data].length;
    if (atual && atual.count === count && proximoDia(atual.end) === data) {
      atual.end = data;
    } else {
      if (atual) segmentos.push(atual);
      atual = { start: data, end: data, count };
    }
  });
  if (atual) segmentos.push(atual);
  return segmentos;
}

function proximoDia(dataIso) {
  const d = new Date(dataIso + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------- Lista de períodos (gestor) ----------
function renderizarListaPeriodos(listaFerias) {
  const container = el("lista-periodos");
  container.innerHTML = "";

  if (listaFerias.length === 0) {
    container.innerHTML = "<p class='vazio'>Nenhum período agendado ainda nesta equipe.</p>";
    return;
  }

  listaFerias.forEach((f) => {
    const nome = nomeCompleto(f.funcionarios);
    const linha = document.createElement("div");
    linha.className = "periodo-linha";
    linha.innerHTML = `
      <div>
        <strong>${nome}</strong>
        <span class="periodo-datas">${formatarData(f.data_inicio)} — ${formatarData(f.data_fim)}</span>
      </div>
      <div class="periodo-acoes">
        <button class="btn-link" data-editar="${f.id}">Editar</button>
        <button class="btn-link btn-danger" data-excluir="${f.id}">Excluir</button>
      </div>
    `;
    container.appendChild(linha);
  });

  container.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.addEventListener("click", () => iniciarEdicao(btn.dataset.editar));
  });
  container.querySelectorAll("[data-excluir]").forEach((btn) => {
    btn.addEventListener("click", () => excluirPeriodo(btn.dataset.excluir));
  });
}

function formatarData(iso) {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

// ---------- Formulário: criar / editar ----------
if (el("ferias-form")) {
  el("ferias-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = el("form-msg");
    msg.textContent = "";

    const funcionarioId = el("select-funcionario").value;
    const dataInicio = el("data-inicio").value;
    const dataFim = el("data-fim").value;

    if (dataFim < dataInicio) {
      msg.textContent = "A data final não pode ser antes da data inicial.";
      return;
    }

    let resultado;
    if (editandoId) {
      resultado = await supabaseClient
        .from("ferias")
        .update({ funcionario_id: funcionarioId, data_inicio: dataInicio, data_fim: dataFim })
        .eq("id", editandoId);
    } else {
      resultado = await supabaseClient
        .from("ferias")
        .insert({ funcionario_id: funcionarioId, data_inicio: dataInicio, data_fim: dataFim });
    }

    if (resultado.error) {
      msg.textContent = "Erro ao salvar: " + resultado.error.message;
      return;
    }

    cancelarEdicao();
    await carregarTudo();
    tentarBackupAutomatico();
  });
}

function iniciarEdicao(id) {
  const item = feriasCache.find((f) => String(f.id) === String(id));
  if (!item) return;

  editandoId = id;
  el("select-funcionario").value = item.funcionarios.id;
  el("data-inicio").value = item.data_inicio;
  el("data-fim").value = item.data_fim;
  el("form-title").textContent = "Editar período";
  el("btn-salvar").textContent = "Salvar edição";
  el("btn-cancelar-edicao").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

el("btn-cancelar-edicao")?.addEventListener("click", cancelarEdicao);

function cancelarEdicao() {
  editandoId = null;
  if (el("ferias-form")) el("ferias-form").reset();
  if (el("form-title")) el("form-title").textContent = "Agendar férias";
  if (el("btn-salvar")) el("btn-salvar").textContent = "Agendar";
  if (el("btn-cancelar-edicao")) el("btn-cancelar-edicao").classList.add("hidden");
}

async function excluirPeriodo(id) {
  const ok = confirm("Tem certeza que deseja excluir este período de férias?");
  if (!ok) return;

  const { error } = await supabaseClient.from("ferias").delete().eq("id", id);
  if (error) {
    alert("Erro ao excluir: " + error.message);
    return;
  }
  await carregarTudo();
  tentarBackupAutomatico();
}

// ---------- Visão geral com filtros ----------
function montarFiltrosVisaoGeral() {
  // Filtro de mês, baseado nos períodos existentes da equipe atual
  const selectMes = el("filtro-mes");
  const mesSelecionado = selectMes.value || "todos";
  const meses = new Set();
  feriasFiltradas().forEach((f) => {
    meses.add(f.data_inicio.slice(0, 7));
    meses.add(f.data_fim.slice(0, 7));
  });
  const mesesOrdenados = Array.from(meses).sort();

  selectMes.innerHTML = '<option value="todos">Todos os meses</option>';
  mesesOrdenados.forEach((m) => {
    const [ano, mes] = m.split("-");
    const nomeMes = new Date(`${m}-01T00:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = nomeMes;
    selectMes.appendChild(opt);
  });
  selectMes.value = mesesOrdenados.includes(mesSelecionado) ? mesSelecionado : "todos";
  selectMes.onchange = renderizarVisaoGeral;

  // Filtro de auditor (só gestor)
  if (papelUsuario === "gestor") {
    const selectAuditor = el("filtro-auditor");
    const auditorSelecionado = selectAuditor.value || "todos";
    selectAuditor.innerHTML = '<option value="todos">Todos os auditores</option>';
    funcionariosFiltrados().forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = nomeCompleto(f);
      selectAuditor.appendChild(opt);
    });
    selectAuditor.value = auditorSelecionado;
    selectAuditor.onchange = renderizarVisaoGeral;
  }
}

function renderizarVisaoGeral() {
  const container = el("visao-geral-lista");
  const mesFiltro = el("filtro-mes").value;
  const auditorFiltro = papelUsuario === "gestor" ? el("filtro-auditor").value : "todos";

  let lista = feriasFiltradas();

  if (auditorFiltro !== "todos") {
    lista = lista.filter((f) => String(f.funcionarios.id) === String(auditorFiltro));
  }
  if (mesFiltro !== "todos") {
    lista = lista.filter((f) => f.data_inicio.slice(0, 7) <= mesFiltro && f.data_fim.slice(0, 7) >= mesFiltro);
  }

  if (papelUsuario === "gestor") {
    if (lista.length === 0) {
      container.innerHTML = "<p class='vazio'>Nenhum período encontrado com esses filtros.</p>";
      return;
    }
    const linhas = lista
      .slice()
      .sort((a, b) => a.data_inicio.localeCompare(b.data_inicio))
      .map((f) => `
        <tr>
          <td>${nomeCompleto(f.funcionarios)}</td>
          <td>${formatarData(f.data_inicio)}</td>
          <td>${formatarData(f.data_fim)}</td>
        </tr>
      `).join("");
    container.innerHTML = `
      <table class="tabela-geral">
        <thead><tr><th>Auditor</th><th>Início</th><th>Fim</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    `;
  } else {
    // Funcionário: agrupa dias consecutivos com a mesma contagem, sem nomes
    const mapaDias = construirMapaDeDias(lista);
    const segmentos = construirSegmentosDeOcupacao(mapaDias);
    if (segmentos.length === 0) {
      container.innerHTML = "<p class='vazio'>Nenhum período com férias encontrado com esses filtros.</p>";
      return;
    }
    const linhas = segmentos.map((s) => `
      <tr>
        <td>${formatarData(s.start)} — ${formatarData(s.end)}</td>
        <td>${s.count} pessoa(s)</td>
      </tr>
    `).join("");
    container.innerHTML = `
      <table class="tabela-geral">
        <thead><tr><th>Período</th><th>Pessoas de férias</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    `;
  }
  
}

// ---------- Backup ----------
function gerarTextoBackup() {
  const linhas = [
    "BACKUP DE FÉRIAS",
    `Equipe: ${equipeAtual}`,
    `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    "",
  ];

  const porAuditor = {};
  feriasFiltradas().forEach((f) => {
    const nome = nomeCompleto(f.funcionarios);
    if (!porAuditor[nome]) porAuditor[nome] = [];
    porAuditor[nome].push(f);
  });

  Object.keys(porAuditor).sort().forEach((nome) => {
    linhas.push(`${nome}:`);
    porAuditor[nome]
      .slice()
      .sort((a, b) => a.data_inicio.localeCompare(b.data_inicio))
      .forEach((f) => linhas.push(`   ${formatarData(f.data_inicio)} a ${formatarData(f.data_fim)}`));
    linhas.push("");
  });

  return linhas.join("\n");
}

el("btn-backup").addEventListener("click", () => {
  const texto = gerarTextoBackup();
  const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup-ferias-${equipeAtual}-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

async function tentarBackupAutomatico() {
  try {
    const texto = gerarTextoBackup();
    const nomeArquivo = `backup-${equipeAtual}-${Date.now()}.txt`;
    await supabaseClient.storage.from("backups").upload(nomeArquivo, texto, {
      contentType: "text/plain;charset=utf-8",
    });
  } catch (e) {
    console.warn("Backup automático não realizado:", e);
  }
}

// ---------- Logout ----------
el("btn-logout").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
});
