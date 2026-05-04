import * as XLSX from 'xlsx';

// =============================================================
// Gastão — Planilha-Mãe v2
// Template multi-segmento (hamburgueria / italiano / japonês /
// fine dining / eventos). Captura o modelo 3 camadas completo:
//   Insumos → Preparos (profundidade arbitrária) → Fichas
//
// 7 abas:
//   1. _Leia-me              — instruções
//   2. _Categorias           — categorias governadas (source of truth)
//   3. Insumos               — base de ingredientes
//   4. Preparos              — mini-receitas (SEM coluna Nível — topo-sort no import)
//   5. Fichas                — produtos vendidos
//   6. Composicao_Preparos   — liga Preparo ← Insumo|Preparo (longo)
//   7. Composicao_Fichas     — liga Ficha   ← Insumo|Preparo (longo)
// =============================================================

export const UNIDADES = ['kg', 'g', 'l', 'ml', 'un', 'porção'] as const;
export const TIPOS_INSUMO = ['insumo_base', 'insumo_direto', 'embalagem'] as const;
export const TIPOS_ITEM = ['insumo', 'preparo', 'ficha'] as const;
// Composicao_Preparos aceita só insumo|preparo (preparo não compõe ficha).
// Composicao_Fichas aceita os 3 (combos: ficha pode conter outra ficha).
export const TIPOS_COMPONENTE = ['insumo', 'preparo'] as const;
export const TIPOS_COMPONENTE_FICHA = ['insumo', 'preparo', 'ficha'] as const;

export type Unidade = typeof UNIDADES[number];
export type TipoInsumo = typeof TIPOS_INSUMO[number];
export type TipoItem = typeof TIPOS_ITEM[number];
export type TipoComponente = typeof TIPOS_COMPONENTE[number];
export type TipoComponenteFicha = typeof TIPOS_COMPONENTE_FICHA[number];

// ── Linhas normalizadas pós-parse ─────────────────────────────

export interface CategoriaRow {
    tipo: TipoItem;
    categoria: string;
    descricao?: string;
}

export interface InsumoRow {
    nome: string;
    categoria: string;
    tipoInsumo: TipoInsumo;
    unidade: string;
    preco: number;
    aproveitamento: number; // 0-1 (já convertido do % da planilha)
    observacoes?: string;
}

export interface PreparoRow {
    nome: string;
    categoria: string;
    rendimentoQtd: number;
    rendimentoUnidade: string;
    observacoes?: string;
}

export interface FichaRow {
    nome: string;
    categoria: string;
    precoVenda: number;
    unidadeVenda: string;
    observacoes?: string;
}

export interface CompPreparoRow {
    preparo: string;
    componente: TipoComponente;
    item: string;
    quantidade: number;
    unidade: string;
}

export interface CompFichaRow {
    ficha: string;
    componente: TipoComponenteFicha;
    item: string;
    quantidade: number;
    unidade: string;
}

export interface ParsedTemplate {
    categorias: CategoriaRow[];
    insumos: InsumoRow[];
    preparos: PreparoRow[];
    fichas: FichaRow[];
    compPreparos: CompPreparoRow[];
    compFichas: CompFichaRow[];
}

// ── Utilitários de parsing ─────────────────────────────────────

/** Converte string/valor Excel para número, aceitando formato BR ("1.234,56") e EN ("1234.56"). */
const toNumber = (v: unknown): number => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const s = String(v).trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    // Se tem vírgula E ponto → formato BR "1.234,56" (remove pontos, troca vírgula por ponto)
    // Se só vírgula → BR decimal
    // Se só ponto → EN decimal
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    let normalized: string;
    if (hasComma && hasDot) {
        normalized = s.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
        normalized = s.replace(',', '.');
    } else {
        normalized = s;
    }
    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
};

const toStr = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    return String(v).trim();
};

const toStrLower = (v: unknown): string => toStr(v).toLowerCase();

// ── Download do template ─────────────────────────────────────
// O arquivo é gerado em build-time por `npm run build:template` (scripts/
// generate-template.mjs) e servido estático de /Gastao_Planilha_Mae.xlsx.
// Usamos exceljs no script porque SheetJS CE não escreve data validations
// (dropdowns). O arquivo estático contém dropdowns de categoria/item/preparo/
// ficha e fórmula VLOOKUP que preenche a Unidade automaticamente.

export const downloadTemplate = () => {
    const a = document.createElement('a');
    a.href = '/Gastao_Planilha_Mae.xlsx';
    a.download = 'Gastao_Planilha_Mae.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
};

// ── Parser ────────────────────────────────────────────────────

interface ParseError {
    sheet: string;
    row: number;
    message: string;
}

export interface ParseResult {
    parsed: ParsedTemplate;
    errors: ParseError[];
    warnings: ParseError[];
}

const readRows = (wb: XLSX.WorkBook, sheetName: string): any[][] => {
    if (!wb.SheetNames.includes(sheetName)) return [];
    const ws = wb.Sheets[sheetName];
    return XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: null });
};

/** Parse estrito das 6 abas de dados (ignora _Leia-me). Retorna erros sem inserir nada. */
export const parseGastaoTemplate = (workbook: XLSX.WorkBook): ParseResult => {
    const errors: ParseError[] = [];
    const warnings: ParseError[] = [];

    const parsed: ParsedTemplate = {
        categorias: [],
        insumos: [],
        preparos: [],
        fichas: [],
        compPreparos: [],
        compFichas: [],
    };

    // ─── _Categorias ───
    {
        const rows = readRows(workbook, '_Categorias');
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || !r[0]) continue;
            const tipo = toStrLower(r[0]);
            const categoria = toStr(r[1]);
            if (!categoria) continue;
            if (!TIPOS_ITEM.includes(tipo as TipoItem)) {
                errors.push({ sheet: '_Categorias', row: i + 1, message: `Tipo de Item inválido: "${r[0]}". Use: ${TIPOS_ITEM.join(', ')}` });
                continue;
            }
            parsed.categorias.push({
                tipo: tipo as TipoItem,
                categoria,
                descricao: toStr(r[2]) || undefined,
            });
        }
    }

    // Sets pra validação rápida de categoria por tipo
    const catsByTipo: Record<TipoItem, Set<string>> = {
        insumo: new Set(),
        preparo: new Set(),
        ficha: new Set(),
    };
    parsed.categorias.forEach(c => catsByTipo[c.tipo].add(c.categoria.toLowerCase()));

    const validateCategoria = (tipo: TipoItem, categoria: string, sheet: string, row: number) => {
        if (!categoria) {
            errors.push({ sheet, row, message: 'Categoria obrigatória.' });
            return;
        }
        if (!catsByTipo[tipo].has(categoria.toLowerCase())) {
            errors.push({
                sheet,
                row,
                message: `Categoria "${categoria}" não está cadastrada em _Categorias como tipo "${tipo}". Adicione lá primeiro.`,
            });
        }
    };

    // ─── Insumos ───
    {
        const rows = readRows(workbook, 'Insumos');
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || !r[0]) continue;
            const nome = toStr(r[0]);
            if (!nome) continue;
            const categoria = toStr(r[1]);
            const tipo = toStrLower(r[2]);
            const unidade = toStrLower(r[3]);
            const preco = toNumber(r[4]);
            const aproveitamentoPct = toNumber(r[5]);
            const observacoes = toStr(r[6]);

            validateCategoria('insumo', categoria, 'Insumos', i + 1);

            if (!TIPOS_INSUMO.includes(tipo as TipoInsumo)) {
                errors.push({ sheet: 'Insumos', row: i + 1, message: `Tipo inválido: "${r[2]}". Use: ${TIPOS_INSUMO.join(', ')}` });
                continue;
            }
            if (!UNIDADES.includes(unidade as Unidade)) {
                errors.push({ sheet: 'Insumos', row: i + 1, message: `Unidade inválida: "${r[3]}". Use: ${UNIDADES.join(', ')}` });
                continue;
            }
            if (preco <= 0) {
                warnings.push({ sheet: 'Insumos', row: i + 1, message: `Preço zerado para "${nome}". Custo ficará 0.` });
            }

            // Aproveitamento: aceita 0-100 (%) ou 0-1 (decimal)
            let aprov = aproveitamentoPct;
            if (aprov === 0) aprov = 100; // default
            if (aprov > 1 && aprov <= 100) aprov = aprov / 100;
            if (aprov <= 0 || aprov > 1) {
                errors.push({ sheet: 'Insumos', row: i + 1, message: `Aproveitamento deve estar entre 1 e 100 (ou 0.01 e 1). Recebido: ${aproveitamentoPct}` });
                continue;
            }

            parsed.insumos.push({
                nome,
                categoria,
                tipoInsumo: tipo as TipoInsumo,
                unidade,
                preco,
                aproveitamento: aprov,
                observacoes: observacoes || undefined,
            });
        }
    }

    // ─── Preparos ───
    {
        const rows = readRows(workbook, 'Preparos');
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || !r[0]) continue;
            const nome = toStr(r[0]);
            if (!nome) continue;
            const categoria = toStr(r[1]);
            const rendQtd = toNumber(r[2]);
            const rendUnidade = toStrLower(r[3]);
            const observacoes = toStr(r[4]);

            validateCategoria('preparo', categoria, 'Preparos', i + 1);

            if (rendQtd <= 0) {
                errors.push({ sheet: 'Preparos', row: i + 1, message: `Rendimento (qtd) deve ser > 0. Recebido: ${r[2]}` });
                continue;
            }
            if (!UNIDADES.includes(rendUnidade as Unidade)) {
                errors.push({ sheet: 'Preparos', row: i + 1, message: `Rendimento (unidade) inválido: "${r[3]}". Use: ${UNIDADES.join(', ')}` });
                continue;
            }

            parsed.preparos.push({
                nome,
                categoria,
                rendimentoQtd: rendQtd,
                rendimentoUnidade: rendUnidade,
                observacoes: observacoes || undefined,
            });
        }
    }

    // ─── Fichas ───
    {
        const rows = readRows(workbook, 'Fichas');
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || !r[0]) continue;
            const nome = toStr(r[0]);
            if (!nome) continue;
            const categoria = toStr(r[1]);
            const precoVenda = toNumber(r[2]);
            const unidadeVenda = toStrLower(r[3]) || 'un';
            const observacoes = toStr(r[4]);

            validateCategoria('ficha', categoria, 'Fichas', i + 1);

            if (precoVenda < 0) {
                errors.push({ sheet: 'Fichas', row: i + 1, message: `Preço de Venda inválido: ${r[2]}` });
                continue;
            }
            if (precoVenda === 0) {
                warnings.push({ sheet: 'Fichas', row: i + 1, message: `Preço de Venda zerado em "${nome}" — CMV ficará indefinido.` });
            }
            if (unidadeVenda && !UNIDADES.includes(unidadeVenda as Unidade)) {
                warnings.push({ sheet: 'Fichas', row: i + 1, message: `Unidade de Venda não padrão: "${r[3]}" — será aceita, mas prefira ${UNIDADES.join('/')}.` });
            }

            parsed.fichas.push({
                nome,
                categoria,
                precoVenda,
                unidadeVenda,
                observacoes: observacoes || undefined,
            });
        }
    }

    // Lookups pra inferência quando Componente/Unidade vierem vazios
    // (no template as duas colunas são FÓRMULAS — podem não ter valor cacheado
    // se o usuário subir a planilha sem abrir antes).
    const insumoByName = new Map<string, InsumoRow>();
    parsed.insumos.forEach(i => insumoByName.set(i.nome.toLowerCase(), i));
    const preparoByName = new Map<string, PreparoRow>();
    parsed.preparos.forEach(p => preparoByName.set(p.nome.toLowerCase(), p));
    const fichaByName = new Map<string, FichaRow>();
    parsed.fichas.forEach(f => fichaByName.set(f.nome.toLowerCase(), f));

    /** Composicao_Preparos: aceita só insumo|preparo (preparo não compõe ficha). */
    const inferComponente = (item: string): TipoComponente | null => {
        const k = item.toLowerCase();
        if (insumoByName.has(k)) return 'insumo';
        if (preparoByName.has(k)) return 'preparo';
        return null;
    };
    const resolveComponente = (explicit: string, item: string): TipoComponente | null => {
        if (TIPOS_COMPONENTE.includes(explicit as TipoComponente)) return explicit as TipoComponente;
        return inferComponente(item);
    };

    /** Composicao_Fichas: aceita os 3 (combos: ficha pode conter outra ficha). */
    const inferComponenteFicha = (item: string): TipoComponenteFicha | null => {
        const k = item.toLowerCase();
        // Se nome existe em insumos E fichas, prevalece insumo (regra documentada no _Leia-me).
        if (insumoByName.has(k)) return 'insumo';
        if (preparoByName.has(k)) return 'preparo';
        if (fichaByName.has(k)) return 'ficha';
        return null;
    };
    const resolveComponenteFicha = (explicit: string, item: string): TipoComponenteFicha | null => {
        if (TIPOS_COMPONENTE_FICHA.includes(explicit as TipoComponenteFicha)) return explicit as TipoComponenteFicha;
        return inferComponenteFicha(item);
    };

    /** Unidade default do item quando a composição não informa. */
    const defaultUnidade = (componente: TipoComponente, item: string): string => {
        const k = item.toLowerCase();
        if (componente === 'insumo') return insumoByName.get(k)?.unidade ?? '';
        return preparoByName.get(k)?.rendimentoUnidade ?? '';
    };
    const defaultUnidadeFicha = (componente: TipoComponenteFicha, item: string): string => {
        const k = item.toLowerCase();
        if (componente === 'insumo') return insumoByName.get(k)?.unidade ?? '';
        if (componente === 'preparo') return preparoByName.get(k)?.rendimentoUnidade ?? '';
        return fichaByName.get(k)?.unidadeVenda ?? 'un';
    };

    // ─── Composicao_Preparos ───
    {
        const rows = readRows(workbook, 'Composicao_Preparos');
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || !r[0]) continue;
            const preparo = toStr(r[0]);
            const componenteRaw = toStrLower(r[1]);
            const item = toStr(r[2]);
            const quantidade = toNumber(r[3]);
            let unidade = toStrLower(r[4]);

            if (!preparo || !item) continue;

            const componente = resolveComponente(componenteRaw, item);
            if (!componente) {
                errors.push({
                    sheet: 'Composicao_Preparos', row: i + 1,
                    message: `Não consegui identificar o Item "${item}". Confira se está cadastrado em Insumos ou Preparos.`,
                });
                continue;
            }
            if (quantidade <= 0) {
                errors.push({ sheet: 'Composicao_Preparos', row: i + 1, message: `Quantidade deve ser > 0. Recebido: ${r[3]}` });
                continue;
            }
            if (!unidade) unidade = defaultUnidade(componente, item);
            if (componente === 'insumo' && unidade && !UNIDADES.includes(unidade as Unidade)) {
                errors.push({ sheet: 'Composicao_Preparos', row: i + 1, message: `Unidade inválida: "${r[4]}". Use: ${UNIDADES.join(', ')}` });
                continue;
            }
            if (componente === 'preparo' && preparo.toLowerCase() === item.toLowerCase()) {
                errors.push({ sheet: 'Composicao_Preparos', row: i + 1, message: `Preparo "${preparo}" não pode usar ele mesmo (auto-referência).` });
                continue;
            }

            parsed.compPreparos.push({
                preparo,
                componente,
                item,
                quantidade,
                unidade,
            });
        }
    }

    // ─── Composicao_Fichas ───
    // Aceita insumo | preparo | ficha (combos: ficha-em-ficha).
    {
        const rows = readRows(workbook, 'Composicao_Fichas');
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || !r[0]) continue;
            const ficha = toStr(r[0]);
            const componenteRaw = toStrLower(r[1]);
            const item = toStr(r[2]);
            const quantidade = toNumber(r[3]);
            let unidade = toStrLower(r[4]);

            if (!ficha || !item) continue;

            const componente = resolveComponenteFicha(componenteRaw, item);
            if (!componente) {
                errors.push({
                    sheet: 'Composicao_Fichas', row: i + 1,
                    message: `Não consegui identificar o Item "${item}". Confira se está cadastrado em Insumos, Preparos ou Fichas.`,
                });
                continue;
            }
            if (quantidade <= 0) {
                errors.push({ sheet: 'Composicao_Fichas', row: i + 1, message: `Quantidade deve ser > 0. Recebido: ${r[3]}` });
                continue;
            }
            if (componente === 'ficha' && ficha.toLowerCase() === item.toLowerCase()) {
                errors.push({ sheet: 'Composicao_Fichas', row: i + 1, message: `Ficha "${ficha}" não pode usar ela mesma (auto-referência).` });
                continue;
            }
            if (!unidade) unidade = defaultUnidadeFicha(componente, item);
            if (componente === 'insumo' && unidade && !UNIDADES.includes(unidade as Unidade)) {
                errors.push({ sheet: 'Composicao_Fichas', row: i + 1, message: `Unidade inválida: "${r[4]}". Use: ${UNIDADES.join(', ')}` });
                continue;
            }

            parsed.compFichas.push({
                ficha,
                componente,
                item,
                quantidade,
                unidade,
            });
        }
    }

    return { parsed, errors, warnings };
};

// ── Topological sort de preparos ──────────────────────────────

export interface TopoResult {
    order: string[]; // nomes de preparos em ordem de resolução (base → composto)
    cycles: string[][]; // cada ciclo detectado, lista de nomes na ordem do caminho
}

/**
 * Kahn's algorithm. Recebe adjacência (preparo → lista de preparos dos quais depende).
 * Ciclos não entram em `order`; são reportados em `cycles`.
 */
export const topoSortPreparos = (
    preparoNames: string[],
    deps: Record<string, string[]>
): TopoResult => {
    const indeg: Record<string, number> = {};
    const adj: Record<string, string[]> = {}; // dependency → dependents
    preparoNames.forEach(n => { indeg[n] = 0; adj[n] = []; });

    for (const [dependent, ds] of Object.entries(deps)) {
        for (const dep of ds) {
            if (!(dep in indeg)) continue; // referência inexistente tratada fora
            adj[dep].push(dependent);
            indeg[dependent] = (indeg[dependent] ?? 0) + 1;
        }
    }

    const queue: string[] = preparoNames.filter(n => indeg[n] === 0);
    const order: string[] = [];
    while (queue.length) {
        const n = queue.shift()!;
        order.push(n);
        for (const m of adj[n] ?? []) {
            indeg[m]--;
            if (indeg[m] === 0) queue.push(m);
        }
    }

    // Qualquer nome que não apareceu em order faz parte de um ciclo
    const cycleNodes = preparoNames.filter(n => !order.includes(n));
    const cycles = findCycles(cycleNodes, deps);

    return { order, cycles };
};

const findCycles = (nodes: string[], deps: Record<string, string[]>): string[][] => {
    const cycles: string[][] = [];
    const nodeSet = new Set(nodes);
    const visited = new Set<string>();

    for (const start of nodes) {
        if (visited.has(start)) continue;
        const path: string[] = [];
        const onPath = new Set<string>();
        const dfs = (n: string): boolean => {
            if (onPath.has(n)) {
                // fecha o ciclo a partir daqui
                const i = path.indexOf(n);
                cycles.push([...path.slice(i), n]);
                return true;
            }
            if (visited.has(n)) return false;
            path.push(n);
            onPath.add(n);
            for (const d of deps[n] ?? []) {
                if (nodeSet.has(d) && dfs(d)) {
                    // não return — queremos visitar todos
                }
            }
            path.pop();
            onPath.delete(n);
            visited.add(n);
            return false;
        };
        dfs(start);
    }

    return cycles;
};
