-- =====================================================================
-- Quintal Gourmet · PDV — esquema no Postgres (Supabase)
--
-- Espelha as abas da planilha local: os mesmos nomes de campo, para que as
-- regras de negócio funcionem igual nos dois modos de armazenamento.
-- =====================================================================

create table if not exists usuarios (
  usuario        text primary key,
  nome           text not null,
  perfil         text not null default 'operador' check (perfil in ('admin', 'operador')),
  salt           text not null,
  hash           text not null,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  ultimo_acesso  timestamptz
);

create table if not exists produtos (
  codigo          text primary key,
  descricao       text not null,
  codigo_barras   text,
  categoria       text not null default 'A CLASSIFICAR',
  unidade         text not null default 'UN',
  preco_venda     numeric(12,2) not null default 0 check (preco_venda >= 0),
  custo_medio     numeric(12,2) not null default 0 check (custo_medio >= 0),
  estoque         numeric(12,3) not null default 0,
  estoque_minimo  numeric(12,3) not null default 0,
  ativo           boolean not null default true,
  foto            text not null default '',
  ultima_entrada  timestamptz,
  ultima_saida    timestamptz,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

create unique index if not exists produtos_barras_unico
  on produtos (codigo_barras)
  where codigo_barras is not null and codigo_barras <> '';

create index if not exists produtos_categoria on produtos (categoria);

create table if not exists caixas (
  id               bigserial primary key,
  operador         text not null references usuarios (usuario),
  aberto_em        timestamptz not null default now(),
  fechado_em       timestamptz,
  valor_abertura   numeric(12,2) not null default 0,
  vendas_total     numeric(12,2) not null default 0,
  vendas_dinheiro  numeric(12,2) not null default 0,
  suprimentos      numeric(12,2) not null default 0,
  sangrias         numeric(12,2) not null default 0,
  saldo_esperado   numeric(12,2) not null default 0,
  saldo_informado  numeric(12,2) not null default 0,
  diferenca        numeric(12,2) not null default 0,
  status           text not null default 'ABERTO' check (status in ('ABERTO', 'FECHADO')),
  observacao       text not null default ''
);

-- Um operador só pode ter um caixa aberto por vez.
create unique index if not exists caixa_aberto_por_operador
  on caixas (operador)
  where status = 'ABERTO';

create table if not exists vendas (
  id           bigserial primary key,
  numero       text not null unique,
  data         timestamptz not null default now(),
  operador     text not null,
  cliente      text not null default '',
  itens        numeric(12,3) not null default 0,
  subtotal     numeric(12,2) not null default 0,
  desconto     numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,
  custo_total  numeric(12,2) not null default 0,
  lucro        numeric(12,2) not null default 0,
  pagamento    text not null default '',
  status       text not null default 'CONCLUÍDA' check (status in ('CONCLUÍDA', 'CANCELADA')),
  caixa_id     bigint not null default 0,
  observacao   text not null default ''
);

create index if not exists vendas_data on vendas (data desc);
create index if not exists vendas_operador on vendas (operador);
create index if not exists vendas_caixa on vendas (caixa_id);

create table if not exists venda_itens (
  venda_id        bigint not null references vendas (id) on delete cascade,
  seq             integer not null,
  data            timestamptz not null default now(),
  codigo          text not null,
  descricao       text not null,
  quantidade      numeric(12,3) not null,
  preco_unitario  numeric(12,2) not null default 0,
  desconto        numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  custo_unitario  numeric(12,2) not null default 0,
  custo_total     numeric(12,2) not null default 0,
  lucro           numeric(12,2) not null default 0,
  primary key (venda_id, seq)
);

create index if not exists venda_itens_codigo on venda_itens (codigo);
create index if not exists venda_itens_data on venda_itens (data desc);

create table if not exists pagamentos (
  id        bigserial primary key,
  venda_id  bigint not null references vendas (id) on delete cascade,
  data      timestamptz not null default now(),
  forma     text not null,
  valor     numeric(12,2) not null default 0,
  recebido  numeric(12,2) not null default 0,
  troco     numeric(12,2) not null default 0,
  parcelas  integer not null default 0
);

create index if not exists pagamentos_venda on pagamentos (venda_id);

create table if not exists entradas (
  id                    bigserial primary key,
  data                  timestamptz not null default now(),
  codigo                text not null,
  descricao             text not null default '',
  quantidade            numeric(12,3) not null,
  custo_unitario        numeric(12,2) not null default 0,
  valor_total           numeric(12,2) not null default 0,
  fornecedor            text not null default '',
  documento             text not null default '',
  custo_medio_anterior  numeric(12,2) not null default 0,
  custo_medio_novo      numeric(12,2) not null default 0,
  usuario               text not null default '',
  observacao            text not null default ''
);

create index if not exists entradas_data on entradas (data desc);
create index if not exists entradas_codigo on entradas (codigo);

create table if not exists saidas (
  id              bigserial primary key,
  data            timestamptz not null default now(),
  codigo          text not null,
  descricao       text not null default '',
  tipo            text not null default 'VENDA',
  quantidade      numeric(12,3) not null,
  valor_unitario  numeric(12,2) not null default 0,
  valor_total     numeric(12,2) not null default 0,
  custo_unitario  numeric(12,2) not null default 0,
  custo_total     numeric(12,2) not null default 0,
  motivo          text not null default '',
  documento       text not null default '',
  usuario         text not null default '',
  observacao      text not null default ''
);

create index if not exists saidas_data on saidas (data desc);
create index if not exists saidas_codigo on saidas (codigo);
create index if not exists saidas_tipo on saidas (tipo);

create table if not exists ajustes (
  id                bigserial primary key,
  data              timestamptz not null default now(),
  codigo            text not null,
  descricao         text not null default '',
  quantidade        numeric(12,3) not null,
  estoque_anterior  numeric(12,3) not null default 0,
  estoque_novo      numeric(12,3) not null default 0,
  motivo            text not null default '',
  impacto_custo     numeric(12,2) not null default 0,
  usuario           text not null default '',
  observacao        text not null default ''
);

create index if not exists ajustes_data on ajustes (data desc);
create index if not exists ajustes_codigo on ajustes (codigo);

create table if not exists mov_caixa (
  id        bigserial primary key,
  caixa_id  bigint not null references caixas (id) on delete cascade,
  data      timestamptz not null default now(),
  tipo      text not null,
  valor     numeric(12,2) not null default 0,
  motivo    text not null default '',
  usuario   text not null default ''
);

create index if not exists mov_caixa_caixa on mov_caixa (caixa_id);

create table if not exists config (
  chave  text primary key,
  valor  text not null default ''
);

-- Numeração dos cupons: sequência do banco, à prova de concorrência.
create sequence if not exists cupom_seq start 1;

-- =====================================================================
-- Evolução do esquema: colunas acrescentadas depois da primeira versão.
-- =====================================================================

alter table produtos add column if not exists foto text not null default '';

-- =====================================================================
-- Segurança: nenhuma tabela é exposta pela API pública do Supabase.
-- Com RLS ligada e sem políticas, a chave publishable não lê nem escreve
-- nada; o acesso acontece só pelo servidor do PDV, com a conexão direta.
-- =====================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'usuarios', 'produtos', 'caixas', 'vendas', 'venda_itens',
    'pagamentos', 'entradas', 'saidas', 'ajustes', 'mov_caixa', 'config'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
