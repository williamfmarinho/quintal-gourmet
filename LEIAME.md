# Quintal Gourmet — Sistema de PDV

Simulação de um PDV profissional de mercadinho, montada a partir da planilha de controle de
estoque do **Quintal Gourmet**. O mesmo sistema roda de duas formas:

| Modo | Onde ficam os dados | Para quê |
|---|---|---|
| **Local** | planilha Excel na própria máquina | demonstração offline, sem internet e sem custo |
| **Publicado** | Postgres no **Supabase**, servido pela **Vercel** | demo online para mostrar ao cliente de qualquer lugar |

As regras de negócio são as mesmas nos dois — muda apenas o adaptador de armazenamento.

---

## 1. Rodar na sua máquina

1. Dê dois cliques em **`INICIAR SISTEMA.bat`** (instala as dependências na primeira vez).
2. O navegador abre em `http://localhost:4321`.
3. Entre com um dos acessos de demonstração:

| Perfil | Usuário | Senha |
|---|---|---|
| Administrador | `admin` | `admin123` |
| Operador de caixa | `caixa` | `caixa123` |
| Operador de caixa | `joao` | `joao123` |

Pelo terminal: `npm install` e `npm start`.

Para forçar o modo planilha mesmo com banco configurado, use `ARMAZENAMENTO=excel`.
Para recriar a base local do zero: `npm run resetar`.

---

## 2. Publicar (Supabase + Vercel)

### 2.1 Banco no Supabase

Copie `.env.example` para `.env.local` e preencha a `DATABASE_URL` com a string do
**Transaction pooler** (Supabase → Project Settings → Database → Connection string →
Transaction pooler). O host direto `db.<projeto>.supabase.co` só atende em IPv6 e não
funciona na Vercel nem na maioria das máquinas — o pooler é o caminho certo.

```bash
npm run migrar             # cria as tabelas e carrega os dados iniciais
npm run migrar:recarregar  # apaga tudo e carrega de novo (volta ao estado de demo)
npm run migrar:esquema     # só cria/atualiza as tabelas
```

A migração cria 11 tabelas, liga **RLS** em todas e revoga o acesso das chaves públicas:
o banco só responde ao servidor do PDV, nunca ao navegador.

### 2.2 Aplicação na Vercel

O projeto já vem com `vercel.json`. Ao importar o repositório na Vercel:

- **Framework preset**: `Other` — não há build; `public/` é servido como estático e
  `api/index.js` responde por todas as rotas `/api/*`.
- **Environment Variables** (Project Settings → Environment Variables):

| Variável | Valor |
|---|---|
| `DATABASE_URL` | string do *transaction pooler* do Supabase (porta 6543) |
| `SESSAO_SEGREDO` | qualquer texto longo e aleatório (assina os tokens de sessão) |
| `ARMAZENAMENTO` | `postgres` |

Depois do deploy, confira `https://SEU-PROJETO.vercel.app/api/saude` — deve responder
`{"ok":true,"armazenamento":"postgres"}`.

> **Nada de segredo entra no Git.** `.env.local` está no `.gitignore`; as chaves ficam
> apenas na sua máquina e nas variáveis de ambiente da Vercel.

---

## 3. O que o sistema faz

### Operação (todos os usuários)

- **Frente de caixa** — busca por código, nome ou código de barras; grade por categoria;
  comanda com quantidade e desconto (R$ ou %); cliente identificado; pagamento em várias
  formas na mesma venda (dinheiro, PIX, débito, crédito parcelado, vale, fiado), troco
  calculado e **impressão da notinha**.
- **Produtos** — preço, estoque, situação, dias sem saída e ficha completa do item. Custo e
  margem só aparecem para o administrador.
- **Caixa** — abertura com fundo de troco, sangria, suprimento e fechamento com conferência
  do dinheiro contado e apuração da diferença.
- **Vendas** — cupons do período, detalhe item a item, reimpressão e cancelamento (admin)
  com estorno automático do estoque.

### Gestão (somente administrador)

- **Painel** — faturamento e lucro do dia, comparação com ontem, meta, capital em estoque,
  ritmo de 7 dias, campeões de venda, itens a repor e encalhados.
- **Estoque** — entradas com **custo médio ponderado** (e prévia do novo custo), ajustes por
  contagem e sete tipos de baixa sem venda (perda, quebra, desperdício, consumo, cortesia,
  devolução, transferência).
- **Lucros e relatórios** — faturamento, CMV, lucro bruto, margem, perdas, lucro líquido
  estimado, ticket médio, série diária, desempenho por categoria/pagamento/operador,
  **curva ABC** e exportação em CSV.
- **Sistema** — dados da loja no cupom, parâmetros, usuários e download da base em Excel.

### Atalhos de teclado

| Tecla | Ação |
|---|---|
| `Alt + 1` a `Alt + 8` | trocar de tela |
| `F2` | buscar produto |
| `F4` | receber pagamento |
| `F6` | desconto |
| `F7` | identificar cliente |
| `3*LINT` + `Enter` | lançar 3 unidades de uma vez |
| `Esc` | fechar a janela aberta |

---

## 4. Como o projeto está organizado

```
api/index.js                 ponto de entrada na Vercel
banco/
  esquema.sql                tabelas, índices e RLS
  migrar.js                  cria o esquema e carrega os dados iniciais
  origem/                    planilha original do Quintal Gourmet (apenas leitura)
public/                      interface (HTML, CSS e JS sem framework)
servidor/
  app.js                     rotas da API + arquivos estáticos
  local.js                   execução local (npm start)
  auth.js                    senhas (scrypt) e tokens de sessão assinados
  calculos.js                contas puras: venda, custo médio, relatórios
  dominio.js                 regras de negócio (usa qualquer armazenamento)
  semear.js                  gera os dados iniciais a partir da planilha original
  armazenamento/
    indice.js                escolhe o adaptador
    excel.js                 adaptador de planilha
    planilha.js              leitura/escrita do arquivo .xlsx
    postgres.js              adaptador do Supabase
dados/                       base .xlsx do modo local (fora do Git)
```

### Detalhes técnicos

- Node.js + Express 5; interface em HTML/CSS/JS puro, sem build.
- Senhas em **scrypt** com salt individual; sessão em token assinado com HMAC-SHA256
  (sem estado no servidor, requisito do ambiente serverless).
- No Postgres, cada operação roda em **transação**, o estoque é alterado com
  `estoque = estoque + delta` (sem perder escrita concorrente) e a numeração dos cupons
  sai de uma **sequence** do banco.
- No modo planilha, a gravação é atômica (arquivo temporário + troca) e uma falha no meio
  da operação desfaz as alterações em memória.
- Regras aplicadas no servidor: sem estoque não vende, sem caixa aberto não vende, desconto
  rateado entre os itens, custo médio ponderado nas entradas e estorno no cancelamento.

---

## 5. Escopo

Sistema de **simulação**: o cupom é **não fiscal** e os dados são de demonstração. Para uso
real seriam necessários emissão fiscal (NFC-e/SAT), backup automático e revisão dos acessos
(as senhas de demonstração são públicas neste repositório).
