// Assistente de IA interno da LB Marketplace — sabe como o sistema funciona E consulta dados reais dos clientes.
// Variáveis de ambiente necessárias na Vercel: OPENAI_API_KEY, FIREBASE_SERVICE_ACCOUNT

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getDb(){
  if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

// E-mails que podem ver dados de "Comercial & Marketing" (mesma trava que já existe no sistema)
const EMAILS_COMERCIAL = ['lincoln@lbmarketplace.com.br', 'felipesoares@potencialmidia.com'];

const CONHECIMENTO_SISTEMA = `Você é o Assistente Interno da LB Marketplace, uma agência de gestão de marketplace (Shopee, Mercado Livre, TikTok Shop, Shein) em Caieiras/SP. Você é usado pelos colaboradores (Lincoln, Paloma, Caroline, Mirela, Felipe) direto dentro do sistema de gestão de clientes.

REGRAS DE NEGÓCIO IMPORTANTES:
- Shopee Ads sempre usa GMV Max com ROAS 25 (nunca outro valor).
- Contas UpSeller são sempre registradas pelo link de afiliado da LB, nunca direto.
- Produtos são cadastrados com preço inflado, depois um "desconto fixo da loja" reduz pro preço de venda real (estratégia de gross-up).
- Contrato de gestão completa tem mínimo de 3 meses (justificado pelo tempo de maturação do algoritmo da plataforma).
- Cupons na Shopee: máximo 90 dias de validade, código com no máximo 5 caracteres (só A-Z e 0-9).
- Oferta relâmpago (flash sale): até 20 produtos, 5 unidades por produto, desconto calculado sobre o preço JÁ com desconto fixo aplicado (não sobre o preço de cadastro cheio).

COMO O SISTEMA FUNCIONA (principais abas):
- Dashboard: visão geral, GMV total, gráfico de composição por marketplace, alertas de desconto/cupom vencendo (clicáveis, levam direto pro painel de correção).
- Minhas Tarefas: Kanban pessoal. Só o Lincoln pode atribuir tarefa pra outra pessoa; colaboradoras só atribuem a si mesmas ou usam "Várias colaboradoras" (2 ou 3 ao mesmo tempo).
- Central de Marketing: 10 ferramentas — Oferta Relâmpago Shopee/TikTok, Descontos, Cupons (com criação automática via API Shopee), Devolução, Gerar Anúncio com IA (Shopee/ML/TikTok Shop, cada um com regras de título diferentes), Saúde da Loja, Shopee GMV API, Shopee Ads Saldo, Relatório Mensal (Ads x GMV).
- Clientes: cadastro, marketplaces, responsável por marketplace, GMV automático da Shopee, opção de desativar (sem perder histórico) em vez de excluir.
- Comercial & Marketing (🔒 restrito a Lincoln e Felipe): board de Meta vs Realizado (Marketing/Comercial) e CRM de Leads (Kanban de 6 etapas: Novo Lead → Em Contato → Agendado → Compareceu → Fechado/Perdido). Quando um lead fecha, cria proposta de contrato automaticamente.
- Contratos: propostas pendentes de aprovação (só Lincoln aprova/reprova). Contrato aprovado tem botão de copiar dados pra gerar o documento.
- Checklist: hub com Shopee, TikTok, Shein, Mercado Livre (página própria), UpSeller, Diretor Criativo.
- Calculadora: gross-up por marketplace (Shopee, ML, TikTok Shop, Shein).

Responda sempre em português do Brasil, de forma direta e prática. Se o colaborador perguntar algo sobre um cliente específico (GMV, saldo, descontos vencendo, tarefas), use as ferramentas disponíveis pra consultar o dado real antes de responder — nunca invente números.`;

const FERRAMENTAS = [
  {
    type: 'function',
    function: {
      name: 'buscar_cliente',
      description: 'Busca informações de um cliente pelo nome: GMV automático da Shopee, saldo Ads, marketplaces, data de vencimento de desconto e cupom.',
      parameters: { type: 'object', properties: { nome: { type: 'string', description: 'Nome do cliente (pode ser parcial)' } }, required: ['nome'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_vencendo',
      description: 'Lista clientes com desconto ou cupom vencendo nos próximos N dias.',
      parameters: { type: 'object', properties: { tipo: { type: 'string', enum: ['desconto', 'cupom'] }, dias: { type: 'number', description: 'Padrão 7 dias' } }, required: ['tipo'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_tarefas_pendentes',
      description: 'Lista as tarefas pendentes (não concluídas) de um colaborador específico, ou de todos.',
      parameters: { type: 'object', properties: { responsavel: { type: 'string', description: 'Nome do colaborador (Lincoln, Paloma, Caroline, Mirela). Deixe vazio pra todos.' } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resumo_gmv_total',
      description: 'Retorna a soma do GMV automático da Shopee de todos os clientes ativos.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'contratos_pendentes',
      description: 'Lista propostas de contrato aguardando aprovação.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resumo_crm_leads',
      description: '[RESTRITO — só Lincoln e Felipe] Conta quantos leads existem em cada etapa do funil do CRM.',
      parameters: { type: 'object', properties: {} }
    }
  }
];

async function executarFerramenta(nome, args, db, emailUsuario){
  const restrito = EMAILS_COMERCIAL.includes(emailUsuario);

  if (nome === 'buscar_cliente') {
    const snap = await db.collection('clientes').get();
    const encontrados = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => (c.nome || '').toLowerCase().includes((args.nome || '').toLowerCase()));
    if (!encontrados.length) return { erro: 'Nenhum cliente encontrado com esse nome.' };
    return encontrados.slice(0, 3).map(c => ({
      nome: c.nome,
      ativo: c.ativo !== false,
      marketplaces: c.marketplaces || [],
      gmvShopee: c.gmvShopeeAutomatico || 0,
      saldoAds: c.saldoAds || 0,
      descontoFixoFim: c.descontoFixoFim || null,
      cupomFim: c.cupomFim || null
    }));
  }

  if (nome === 'listar_vencendo') {
    const dias = args.dias || 7;
    const campo = args.tipo === 'cupom' ? 'cupomFim' : 'descontoFixoFim';
    const limite = new Date(Date.now() + dias * 86400000);
    const snap = await db.collection('clientes').get();
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.ativo !== false && c[campo] && new Date(c[campo]) <= limite && new Date(c[campo]) >= new Date())
      .map(c => ({ nome: c.nome, vence_em: c[campo] }));
    return { total: lista.length, clientes: lista };
  }

  if (nome === 'listar_tarefas_pendentes') {
    let query = db.collection('tarefas').where('coluna', '!=', 'concluido');
    const snap = await query.get();
    let lista = snap.docs.map(d => d.data());
    if (args.responsavel) {
      lista = lista.filter(t => (t.responsavel || '').toLowerCase().includes(args.responsavel.toLowerCase()));
    }
    return { total: lista.length, tarefas: lista.slice(0, 15).map(t => ({ titulo: t.titulo, responsavel: t.responsavel, prazo: t.prazo || null, prioridade: t.prioridade })) };
  }

  if (nome === 'resumo_gmv_total') {
    const snap = await db.collection('clientes').where('ativo', '!=', false).get();
    const total = snap.docs.reduce((acc, d) => acc + (Number(d.data().gmvShopeeAutomatico) || 0), 0);
    return { gmv_total: total, total_clientes: snap.docs.length };
  }

  if (nome === 'contratos_pendentes') {
    const snap = await db.collection('contratos').where('status', '==', 'pendente').get();
    return { total: snap.docs.length, contratos: snap.docs.map(d => ({ nomeCliente: d.data().nomeCliente, indicadoPor: d.data().indicadoPor, mes: d.data().mes })) };
  }

  if (nome === 'resumo_crm_leads') {
    if (!restrito) return { erro: 'Essa informação é restrita a Lincoln e Felipe.' };
    const snap = await db.collection('crmLeads').get();
    const porEtapa = {};
    snap.docs.forEach(d => { const s = d.data().stage || 'novo'; porEtapa[s] = (porEtapa[s] || 0) + 1; });
    return porEtapa;
  }

  return { erro: 'Ferramenta desconhecida.' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const chave = process.env.OPENAI_API_KEY;
  if (!chave) return res.status(500).json({ erro: 'Chave da OpenAI não configurada.' });

  try {
    const { mensagens, emailUsuario, nomeUsuario } = req.body || {};
    if (!Array.isArray(mensagens) || !mensagens.length) return res.status(400).json({ erro: 'Envie o histórico da conversa.' });

    const db = getDb();
    const restrito = EMAILS_COMERCIAL.includes(emailUsuario);

    const systemMsg = {
      role: 'system',
      content: CONHECIMENTO_SISTEMA + `\n\nUsuário atual: ${nomeUsuario || 'colaborador'} (${emailUsuario || 'sem e-mail'}). ${restrito ? 'Esse usuário TEM acesso a dados Comerciais/CRM.' : 'Esse usuário NÃO tem acesso a dados Comerciais/CRM — se perguntar sobre isso, informe educadamente que é restrito.'}`
    };

    let historico = [systemMsg, ...mensagens];
    let respostaFinal = null;

    // Loop de function-calling: até 4 idas e vindas com ferramentas
    for (let volta = 0; volta < 4; volta++) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + chave },
        body: JSON.stringify({ model: 'gpt-5.6-luna', messages: historico, tools: FERRAMENTAS, temperature: 0.4 })
      });

      if (!r.ok) {
        const errTxt = await r.text();
        return res.status(500).json({ erro: 'Erro na OpenAI: ' + errTxt.slice(0, 200) });
      }

      const data = await r.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) return res.status(500).json({ erro: 'Resposta inválida da IA.' });

      if (msg.tool_calls && msg.tool_calls.length) {
        historico.push(msg);
        for (const tc of msg.tool_calls) {
          const args = JSON.parse(tc.function.arguments || '{}');
          const resultado = await executarFerramenta(tc.function.name, args, db, emailUsuario);
          historico.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(resultado) });
        }
        continue; // manda de novo com o resultado da ferramenta, pra IA formular a resposta final
      }

      respostaFinal = msg.content;
      break;
    }

    if (!respostaFinal) respostaFinal = 'Não consegui formular uma resposta agora. Tenta reformular a pergunta.';
    return res.status(200).json({ ok: true, resposta: respostaFinal });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Erro interno: ' + (e.message || 'desconhecido') });
  }
}
