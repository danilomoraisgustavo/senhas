// Referências aos elementos
const signUpButton = document.getElementById('signUp');
const signInButton = document.getElementById('signIn');
const container = document.getElementById('container');

// Formulários (por ID)
const formRegister = document.getElementById('formRegister');
const formLogin = document.getElementById('formLogin');

// Elemento de notificação
const notificationBox = document.getElementById('notification');

/* Animação de transição entre Login e Cadastro */
signUpButton.addEventListener('click', () => {
    container.classList.add("right-panel-active");
});
signInButton.addEventListener('click', () => {
    container.classList.remove("right-panel-active");
});

/**
 * Exibe uma notificação temporária.
 * @param {string} message - Texto da notificação
 * @param {string} type - Tipo ('success', 'error', 'warning')
 * @param {number} timeout - Tempo em ms para desaparecer (default 3000)
 */
function showNotification(message, type = 'success', timeout = 3000) {
    // Define classe e texto
    notificationBox.textContent = message;
    notificationBox.className = `notification ${type}`;

    // Exibe (removendo 'hidden')
    notificationBox.classList.remove('hidden');

    // Remove após X milissegundos
    setTimeout(() => {
        notificationBox.classList.add('hidden');
    }, timeout);
}

/* ------------------- CADASTRO ------------------- */
formRegister.addEventListener('submit', (e) => {
    e.preventDefault(); // Impede reload

    // Coleta dados
    const formData = new FormData(formRegister);
    const body = {
        nomeCompleto: formData.get('nomeCompleto'),
        email: formData.get('email'),
        senha: formData.get('senha'),
        sala: formData.get('sala'),
        mesa: formData.get('mesa')
    };

    // Envia via fetch para rota /register
    fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
        .then((res) => res.json()) // Esperamos JSON
        .then((data) => {
            if (data.success) {
                // Sucesso
                showNotification(data.message, 'success');
                // Limpa formulário
                formRegister.reset();
                // Alternativamente, poderíamos mudar para a tela de login:
                setTimeout(() => {
                    container.classList.remove('right-panel-active');
                }, 1500);
            } else {
                // Erro ou aviso
                showNotification(data.message, 'error');
            }
        })
        .catch((err) => {
            showNotification('Erro inesperado. Tente novamente.', 'error');
            console.error(err);
        });
});

/* ------------------- LOGIN ------------------- */
formLogin.addEventListener('submit', (e) => {
    e.preventDefault();

    // Coleta dados
    const formData = new FormData(formLogin);
    const body = {
        email: formData.get('email'),
        senha: formData.get('senha')
    };

    // Envia via fetch para rota /login
    fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
        .then((res) => res.json())
        .then((data) => {
            if (data.success) {
                // Login OK
                showNotification(data.message, 'success');
                // Redireciona após pequena pausa
                setTimeout(() => {
                    window.location.href = data.redirect || '/dashboard';
                }, 1500);
            } else {
                // Falha de login
                showNotification(data.message, 'error');
            }
        })
        .catch((err) => {
            showNotification('Erro inesperado no login.', 'error');
            console.error(err);
        });
});
