let papelUsuario = null; // 'gestor' ou 'funcionario'
let calendar = null;
let editandoId = null; // se estiver editando um período, guarda o id aqui
let feriasCache = [];  // guarda a última lista de férias carregada (para o backup)

const el = (id) => document.getElementById(id);

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
  await carregarFuncionarios();
  await carregarEColorirCalendario();
})();

function montarInterfacePorPapel() {
  const badge = el("papel-badge");
  if (papelUsuario === "gestor") {
    badge.textContent = "Gestor";
    el("form-gestor").classList.remove("hidden");
    el("lista-gestor").classList.remove("hidden");
    el("legend-text").textContent = "Passe o mouse para ver quem está de férias";
  } else {
    badge.textContent = "Visualização";
    el("legend-text").textContent = "Passe o mouse para ver quantas pessoas estão de férias";
  }
}

// ---------- Funcionários (para o <select>) ----------
async function carregarFuncionarios() {
  if (papelUsuario !== "gestor") return;

  const { data, error } = await supabaseClient
    .from("funcionarios")
    .select("id, primeiro_nome, segundo_nome")
    .order("primeiro_nome");

  if (error) return;

  const select = el("select-funcionario");
  select.innerHTML = "";
  data.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = `${f.primeiro_nome} ${f.segundo_nome}`;
    select.appendChild(opt);
  });
}

// ---------- Carregar férias + montar calendário ----------
async function carregarEColorirCalendario() {
  const { data, error } = await supabaseClient
    .from("ferias")
    .select("id, data_inicio, data_fim, funcionarios (id, primeiro_nome, segundo_nome)")
    .order("data_inicio");

  if (error) {
    console.error(error);
    return;
  }

  feriasCache = data;

  const mapaDias = construirMapaDeDias(data);
  renderizarCalendario(mapaDias);

  if (papelUsuario === "gestor") {
    renderizarListaPeriodos(data);
  }
}

// Transforma os períodos em um mapa { "2026-08-10": ["Ana Silva", "João Souza"] }
function construirMapaDeDias(listaFerias) {
  const mapa = {};
  listaFerias.forEach((f) => {
    const nome = `${f.funcionarios.primeiro_nome} ${f.funcionarios.segundo_nome}`;
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

function renderizarCalendario(mapaDias) {
  const eventos = Object.keys(mapaDias).map((data) => ({
    start: data,
    display: "background",
    classNames: ["dia-ferias"],
    extendedProps: { nomes: mapaDias[data] },
  }));

  const containerEl = el("calendar");

  if (calendar) {
    calendar.destroy();
  }

  calendar = new FullCalendar.Calendar(containerEl, {
    locale: "pt-br",
    height: "auto",
    headerToolbar: { left: "prev,next today", center: "title", right: "" },
    events: eventos,
    eventDidMount: function (info) {
      const nomes = info.event.extendedProps.nomes || [];
      if (nomes.length === 0) return;

      if (papelUsuario === "gestor") {
        info.el.title = nomes.join(", ");
      } else {
        info.el.title = `${nomes.length} pessoa(s) de férias`;
      }
    },
  });

  calendar.render();
}

// ---------- Lista de períodos (gestor) ----------
function renderizarListaPeriodos(listaFerias) {
  const container = el("lista-periodos");
  container.innerHTML = "";

  if (listaFerias.length === 0) {
    container.innerHTML = "<p class='vazio'>Nenhum período agendado ainda.</p>";
    return;
  }

  listaFerias.forEach((f) => {
    const nome = `${f.funcionarios.primeiro_nome} ${f.funcionarios.segundo_nome}`;
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
    await carregarEColorirCalendario();
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
  el("ferias-form").reset();
  el("form-title").textContent = "Agendar férias";
  el("btn-salvar").textContent = "Agendar";
  el("btn-cancelar-edicao").classList.add("hidden");
}

async function excluirPeriodo(id) {
  const ok = confirm("Tem certeza que deseja excluir este período de férias?");
  if (!ok) return;

  const { error } = await supabaseClient.from("ferias").delete().eq("id", id);
  if (error) {
    alert("Erro ao excluir: " + error.message);
    return;
  }
  await carregarEColorirCalendario();
  tentarBackupAutomatico();
}

// ---------- Backup ----------
function gerarTextoBackup() {
  const linhas = ["BACKUP DE FÉRIAS", `Gerado em: ${new Date().toLocaleString("pt-BR")}`, ""];
  feriasCache.forEach((f) => {
    const nome = `${f.funcionarios.primeiro_nome} ${f.funcionarios.segundo_nome}`;
    linhas.push(`${nome} | ${formatarData(f.data_inicio)} a ${formatarData(f.data_fim)}`);
  });
  return linhas.join("\n");
}

el("btn-backup").addEventListener("click", () => {
  const texto = gerarTextoBackup();
  const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup-ferias-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// Backup automático: salva uma cópia no Supabase Storage após cada alteração.
// Se o bucket "backups" não existir ainda, apenas ignora silenciosamente.
async function tentarBackupAutomatico() {
  try {
    const texto = gerarTextoBackup();
    const nomeArquivo = `backup-${Date.now()}.txt`;
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
