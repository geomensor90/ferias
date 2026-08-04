const form = document.getElementById("login-form");
const errorMsg = document.getElementById("error-msg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.textContent = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    errorMsg.textContent = "E-mail ou senha incorretos.";
    return;
  }

  window.location.href = "painel.html";
});

// Se já estiver logado, pula direto para o painel
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) window.location.href = "painel.html";
})();
