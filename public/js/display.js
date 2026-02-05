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

// Atualiza data/hora
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

// Mapeia tipo -> texto exibido (compatível com tipos antigos)
function tituloPorTipo(tipo) {
    const t = (tipo || '').toString().trim().toUpperCase();

    // Compatibilidade com o modelo antigo
    if (t === 'N') return 'NORMAL MUNICIPAL';
    if (t === 'P') return 'PREFERENCIAL MUNICIPAL';

    const map = {
        EN: 'NORMAL ESTADUAL',
        EP: 'PREFERENCIAL ESTADUAL',
        MN: 'NORMAL MUNICIPAL',
        MP: 'PREFERENCIAL MUNICIPAL'
    };

    return map[t] || 'ATENDIMENTO';
}

// Quando chega uma nova senha chamada
socket.on('senhaChamada', (data) => {
    // Se o som estiver habilitado, reproduz alerta
    if (somAtivo) {
        const alertSound = new Audio('/sound/alert.mp3');
        alertSound.play().catch((err) => {
            console.error('Falha ao reproduzir som:', err);
        });
    }

    const titulo = tituloPorTipo(data.tipo);

    // Define o título conforme tipo
    tipoSenhaTitulo.textContent = titulo;

    // Exibe número e sala | mesa
    senhaNumeroElement.textContent = data.numero;
    salaInfoElement.textContent = `SALA ${data.sala || '?'} | MESA ${data.mesa || '?'}`;

    // Adiciona ao array das últimas senhas (no início)
    ultimasSenhas.unshift({
        tipo: titulo,
        numero: data.numero,
        sala: data.sala || '?',
        mesa: data.mesa || '?'
    });

    // Mantém apenas as 3 últimas
    ultimasSenhas = ultimasSenhas.slice(0, 3);

    // Atualiza os 3 cards no DOM
    ultimaSenhaCards.forEach((card, index) => {
        if (ultimasSenhas[index]) {
            const { tipo, numero, sala, mesa } = ultimasSenhas[index];
            card.querySelector('.tipo-ultima-senha').textContent = tipo;
            card.querySelector('.numero-ultima-senha').textContent = numero;
            card.querySelector('.sala-ultima-senha').textContent = `SALA ${sala} | MESA ${mesa}`;
        } else {
            card.querySelector('.tipo-ultima-senha').textContent = '---';
            card.querySelector('.numero-ultima-senha').textContent = '---';
            card.querySelector('.sala-ultima-senha').textContent = 'SALA --- | MESA ---';
        }
    });
});
