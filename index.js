require("dotenv").config();
const venom = require('venom-bot');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const URL = process.env.URL;


const sessoes = new Map(); // Armazena sessões com timeout
const TEMPO_EXPIRACAO_MS = 5 * 60 * 1000; // 5 minutos

venom
  .create({
    session: 'menu-bot',
    multidevice: true,
    headless: false,
    browserPathExecutable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    updatesLog: false,
    autoClose: 0
  })
  .then((client) => start(client))
  .catch((error) => console.error(error));

function start(client) {
  client.onMessage(async (message) => {
    const user = message.from;

    // ⚠️ Inicia sessão ou reinicia timeout
    if (!sessoes.has(user)) {
      iniciarSessao(user);
      await client.sendText(user, '🧾 Olá, bem-vindo ao Bot-Lane,\nPor favor, digite seu CPF (somente números):');
      return;
    }

    const sessao = sessoes.get(user);

    // Reinicia o timeout a cada interação
    reiniciarTimeout(user);

    if (sessao.etapa === 'cpf') {
      const cpfLimpo = message.body.replace(/\D/g, '');
      if (cpfLimpo.length !== 11) {
        await client.sendText(user, '❌ CPF inválido. Tente novamente:');
        return;
      }

      sessao.cpf = cpfLimpo;
      sessao.etapa = 'menu';
      sessoes.set(user, sessao);

      await client.sendText(user, `✅ CPF registrado com sucesso!\n`);
      await client.sendText(user, menuTexto());
      return;
    }

    if (sessao.etapa === 'menu') {
      const opcao = message.body.trim();

      switch (opcao) {
        case '1':
          await enviarCargaHoraria(client, user, sessao.cpf);
          break;
        case '2':
          await enviarCursosDisponiveis(client, user);
          break;
        case '3':
            try {
                const frase = await escolherFraseDesmotivacional();
                await client.sendText(user, `☠️ *Frase do dia:*\n\n"${frase}"`);
            } catch (err) {
                await client.sendText(user, '⚠️ Erro ao buscar uma frase. Tente novamente mais tarde.');
                console.error(err);
            }
            break;

        case '4':
          await client.sendText(user, '📞 Fale com o sectáro pelo número: (81) 99999-9999');
          break;
        case '5':
            sessao.etapa = 'agenda_ano';
            sessoes.set(user, sessao);
            await client.sendText(user, '📅 Digite o *ANO* da agenda (ex: 2025):');
            return;
        default:
          await client.sendText(user, '❌ Opção inválida. Tente novamente.');
      }

      await client.sendText(user, menuTexto());
    }
    
    /* === ETAPA: AGENDA (ANO) =================================== */
    if (sessao.etapa === 'agenda_ano') {
    const ano = parseInt(message.body.trim());
    if (isNaN(ano) || ano < 2000 || ano > 2100) {
        await client.sendText(user, '❌ Ano inválido. Digite 4 dígitos (ex: 2025).');
        return;
    }
    sessao.ano = ano;
    sessao.etapa = 'agenda_mes';
    sessoes.set(user, sessao);
    await client.sendText(user, '📅 Agora digite o *MÊS* (1‑12):');
    return;
    }

    /* === ETAPA: AGENDA (MÊS) ==================================== */
    if (sessao.etapa === 'agenda_mes') {
    const mes = parseInt(message.body.trim());
    if (isNaN(mes) || mes < 1 || mes > 12) {
        await client.sendText(user, '❌ Mês inválido. Digite um número entre 1 e 12.');
        return;
    }
    await client.sendText(user, `🔄 Gerando agenda de ${mes}/${sessao.ano}...`);
    await enviarAgendaPdf(client, user, sessao.ano, mes.toString().padStart(2, '0'));

    // volta para o menu original
    sessao.etapa = 'menu';
    sessoes.set(user, sessao);
    await client.sendText(user, menuTexto());
    return;
    }


  });
}

// ⏳ Inicia nova sessão com timeout de expiração
function iniciarSessao(user) {
  const timeout = setTimeout(() => {
    sessoes.delete(user);
    console.log(`⏱️ Sessão expirada para ${user}`);
  }, TEMPO_EXPIRACAO_MS);

  sessoes.set(user, {
    etapa: 'cpf',
    timeout,
  });
}

// 🔁 Reinicia o timeout
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

// 📋 Texto do menu
function menuTexto() {
  return `🍼 *Bem-vindo ao Bot ZecaTron!*\n\nEscolha uma opção:
1️⃣ Minha Carga Horária no PFC
2️⃣ Cursos Disponíveis
3️⃣ Frase Motivacional
4️⃣ Fale com o Secretário
5️⃣ Baixar Agenda (PDF)

Digite o número da opção.`;
}

// 📚 Consulta carga horária
async function enviarCargaHoraria(client, user, cpf) {
  try {
    const response = await axios.get(URL + `api/carga-horaria/?cpf=${cpf}`);
    const dados = response.data;

    await client.sendText(user, `📚 *Carga Horária*\n\nNome: ${dados.nome}\nCPF: ${dados.cpf}\nCarga Total: ${dados.carga_horaria_total}h\nPeríodo: ${dados.periodo}`);
  } catch (error) {
    console.error('Erro na requisição:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    await client.sendText(user, '❌ Erro ao buscar a carga horária. Verifique o CPF ou tente novamente mais tarde.');
  }
}

// 📚 Lista cursos disponíveis
async function enviarCursosDisponiveis(client, user) {
  try {
    const response = await axios.get(URL + `api/cursos-disponiveis/`);
    const lista = response.data.cursos;

    if (!lista.length) {
      await client.sendText(user, '📭 Nenhum curso disponível no momento.');
      return;
    }

    let texto = '📚 *Cursos Disponíveis:*\n\n';
    lista.forEach((curso, idx) => {
      texto += `${idx + 1}. ${curso.nome}\nInício: ${curso.data_inicio}\nFim: ${curso.data_termino}\nCH: ${curso.ch}h\n🔗 ${curso.link}\n\n`;
    });

    await client.sendText(user, texto.trim());
  } catch (error) {
    console.error(error);
    await client.sendText(user, '❌ Erro ao buscar os cursos disponíveis. Tente novamente mais tarde.');
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
        if (frases.length === 0) {
          reject('Nenhuma frase encontrada.');
        } else {
          const indice = Math.floor(Math.random() * frases.length);
          resolve(frases[indice]);
        }
      })
      .on('error', reject);
  });
}

async function enviarAgendaPdf(client, user, ano, mes) {
  const url = URL + `gerar_curadoria/${ano}/${mes}`;
  const nomeArquivo = `agenda_${ano}_${mes}.pdf`;
  const arquivoPath = path.join(__dirname, nomeArquivo);

  try {
    const resposta = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(arquivoPath, resposta.data);          // salva localmente
    await client.sendFile(
      user,
      arquivoPath,
      nomeArquivo,
      `📎 Agenda ${mes}/${ano}`
    );
  } catch (err) {
    console.error(err.message);
    await client.sendText(user, '❌ Não consegui baixar a agenda. Verifique o mês/ano ou tente de novo.');
  } finally {
    if (fs.existsSync(arquivoPath)) fs.unlinkSync(arquivoPath); // limpa arquivo
  }
}
