require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const URL = process.env.URL || "http://localhost:8000/"; // Sua API interna do PFC

const app = express();
app.use(bodyParser.json());

const sessoes = new Map();
const TEMPO_EXPIRACAO_MS = 5 * 60 * 1000;

// === 📤 Enviar mensagem via Evolution ===
async function enviarMensagem(destino, texto) {
  try {
    await axios.post(`${process.env.EVOLUTION_URL}/message/sendText/BOT-SEPLAG`, {
      number: destino,
      text: texto
    }, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.EVOLUTION_APIKEY
      }
    });
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err.response?.data || err.message);
  }
}

// === 📩 Webhook para receber mensagens ===
app.post('/webhook', async (req, res) => {
  const msg = req.body;
  const user = msg.from;
  const texto = msg.body;

  console.log(`[${user}] → ${texto}`);

  await processarMensagem(user, texto);
  res.sendStatus(200);
});

// === 🧠 Lógica principal ===
async function processarMensagem(user, texto) {
  // Iniciar nova sessão ou resetar timer
  if (!sessoes.has(user)) {
    iniciarSessao(user);
    await enviarMensagem(user, '🧾 Olá, sou Horácio, o bot dinossauro.\nDigite seu *CPF* (somente números):');
    return;
  }

  const sessao = sessoes.get(user);
  reiniciarTimeout(user);

  if (sessao.etapa === 'cpf') {
    const cpfLimpo = texto.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      await enviarMensagem(user, '❌ CPF inválido. Tente novamente:');
      return;
    }

    sessao.cpf = cpfLimpo;
    sessao.etapa = 'menu';
    sessoes.set(user, sessao);
    await enviarMensagem(user, `✅ CPF verificado!\n`);
    await enviarMensagem(user, menuTexto());
    return;
  }

  if (sessao.etapa === 'menu') {
    switch (texto.trim()) {
      case '1':
        await enviarCargaHoraria(user, sessao.cpf);
        break;
      case '2':
        await enviarCursosDisponiveis(user);
        break;
      case '3':
        try {
          const frase = await escolherFraseDesmotivacional();
          await enviarMensagem(user, `☠️ *Frase do dia:*\n\n"${frase}"`);
        } catch {
          await enviarMensagem(user, '❌ Erro ao buscar frase.');
        }
        break;
      case '4':
        await enviarMensagem(user, '📞 Fale com o secretário: (81) 99999-9999');
        break;
      default:
        await enviarMensagem(user, '❌ Opção inválida. Tente novamente.');
    }
    await enviarMensagem(user, menuTexto());
  }
}

// === Utilitários ===
function iniciarSessao(user) {
  const timeout = setTimeout(() => {
    sessoes.delete(user);
    console.log(`⏱️ Sessão expirada para ${user}`);
  }, TEMPO_EXPIRACAO_MS);

  sessoes.set(user, {
    etapa: 'cpf',
    timeout
  });
}

function reiniciarTimeout(user) {
  const sessao = sessoes.get(user);
  if (sessao && sessao.timeout) {
    clearTimeout(sessao.timeout);
    sessao.timeout = setTimeout(() => {
      sessoes.delete(user);
      console.log(`⏱️ Sessão expirada para ${user}`);
    }, TEMPO_EXPIRACAO_MS);
    sessoes.set(user, sessao);
  }
}

function menuTexto() {
  return `🍼 *Escolha uma opção:*\n
1️⃣ Minha Carga Horária no PFC
2️⃣ Cursos Disponíveis
3️⃣ Frase (des)Motivacional
4️⃣ Fale com o Secretário

Digite o número da opção.`;
}

// === 📚 Requisições aos dados da API PFC ===

async function enviarCargaHoraria(user, cpf) {
  try {
    const res = await axios.get(`${URL}api/carga-horaria/?cpf=${cpf}`);
    const dados = res.data;
    await enviarMensagem(user, `📚 *Carga Horária*\n\nNome: ${dados.nome}\nCPF: ${dados.cpf}\nCarga Total: ${dados.carga_horaria_total}h\nPeríodo: ${dados.periodo}`);
  } catch (err) {
    console.error(err.message);
    await enviarMensagem(user, '❌ Erro ao buscar carga horária.');
  }
}

async function enviarCursosDisponiveis(user) {
  try {
    const res = await axios.get(`${URL}api/cursos-disponiveis/`);
    const lista = res.data.cursos;
    if (!lista.length) {
      await enviarMensagem(user, '📭 Nenhum curso disponível.');
      return;
    }
    let texto = '📚 *Cursos Disponíveis:*\n\n';
    lista.forEach((curso, i) => {
      texto += `${i + 1}. ${curso.nome}\nInício: ${curso.data_inicio}\nFim: ${curso.data_termino}\nCH: ${curso.ch}h\n🔗 ${curso.link}\n\n`;
    });
    await enviarMensagem(user, texto.trim());
  } catch (err) {
    console.error(err.message);
    await enviarMensagem(user, '❌ Erro ao buscar cursos.');
  }
}

function escolherFraseDesmotivacional() {
  return new Promise((resolve, reject) => {
    const frases = [];
    const filePath = path.join(__dirname, 'frases_desmotivacionais.csv');
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        if (row.frase) frases.push(row.frase);
      })
      .on('end', () => {
        if (frases.length === 0) return reject();
        const index = Math.floor(Math.random() * frases.length);
        resolve(frases[index]);
      })
      .on('error', reject);
  });
}

// === 🚀 Iniciar servidor ===
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Bot rodando na porta ${PORT} (Evolution Mode)`);
});
