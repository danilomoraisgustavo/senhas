// display.js
const socket = io();

const tipoSenhaTitulo = document.getElementById('tipoSenhaTitulo');
const senhaNumeroElement = document.getElementById('senhaNumero');
const salaInfoElement = document.getElementById('salaInfo');
const ultimasSenhasRow = document.getElementById('ultimasSenhasRow');
const ultimaSenhaCards = ultimasSenhasRow.querySelectorAll('.ultima-senha-card');
const dataHoraElement = document.getElementById('dataHora');

let somAtivo = false;
const btnSom = document.getElementById('btnSom');

// Ao clicar no botão de habilitar som
btnSom.addEventListener('click', () => {
    somAtivo = true;
    btnSom.classList.add('som-escondido'); // Adiciona a classe para animar e esconder o botão
});

// Função para atualizar data/hora
function atualizarDataHora() {
    const agora = new Date();
    const dia = agora.toLocaleDateString('pt-BR');
    const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    dataHoraElement.textContent = `${dia} - ${hora}`;
}
setInterval(atualizarDataHora, 1000);
atualizarDataHora();

// Armazena as últimas senhas
let ultimasSenhas = [];

// Quando chega uma nova senha chamada
socket.on('senhaChamada', (data) => {
    // Se o som estiver habilitado, reproduz alerta
    if (somAtivo) {
        const alertSound = new Audio('/sound/alert.mp3');
        alertSound.play().catch((err) => {
            console.error('Falha ao reproduzir som:', err);
        });
    }

    // Define o título conforme tipo
    if (data.tipo === 'P') {
        tipoSenhaTitulo.textContent = 'PREFERENCIAL';
    } else {
        tipoSenhaTitulo.textContent = 'ATEND. NORMAL';
    }

    // Exibe número e sala
    senhaNumeroElement.textContent = data.numero;
    salaInfoElement.textContent = `SALA ${data.sala || '?'}`;

    // Adiciona ao array das últimas senhas (no início)
    ultimasSenhas.unshift({
        tipo: tipoSenhaTitulo.textContent,
        numero: data.numero,
        sala: data.sala || '?'
    });

    // Mantém apenas as 3 últimas
    ultimasSenhas = ultimasSenhas.slice(0, 3);

    // Atualiza os 3 cards no DOM
    ultimaSenhaCards.forEach((card, index) => {
        if (ultimasSenhas[index]) {
            const { tipo, numero, sala } = ultimasSenhas[index];
            card.querySelector('.tipo-ultima-senha').textContent = tipo;
            card.querySelector('.numero-ultima-senha').textContent = numero;
            card.querySelector('.sala-ultima-senha').textContent = `SALA ${sala}`;
        } else {
            card.querySelector('.tipo-ultima-senha').textContent = '---';
            card.querySelector('.numero-ultima-senha').textContent = '---';
            card.querySelector('.sala-ultima-senha').textContent = 'SALA ---';
        }
    });
});
