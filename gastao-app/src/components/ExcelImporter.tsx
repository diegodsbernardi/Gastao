import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { downloadTemplate, parseGastaoTemplate, TEMPLATE_STRUCTURE, SheetName } from '../lib/gastaoTemplate';
import { Loader2, UploadCloud, CheckCircle2, AlertTriangle, Download } from 'lucide-react';

const cellNum = (v: any): number => {
    if (v === undefined || v === null) return 0;
    const n = parseFloat(String(v).replace(/[^\d,.]/g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
};

export const ExcelImporter = ({ onComplete }: { onComplete: () => void }) => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
    const [logs, setLogs] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addLog = (msg: string) => setLogs(p => [...p, msg]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        setStatus('processing');
        setLogs([]);
        addLog('📂 Lendo arquivo...');

        try {
            const { data: profile } = await supabase.from('profiles').select('restaurant_id').eq('id', user?.id).single();
            const restaurantId = profile?.restaurant_id;
            if (!restaurantId) throw new Error('Usuário não vinculado a um Restaurante.');

            const bstr = await file.arrayBuffer();
            const workbook = XLSX.read(bstr, { type: 'array' });

            addLog(`📋 Abas detectadas: ${workbook.SheetNames.join(', ')}`);

            const parsed = parseGastaoTemplate(workbook);
            let totalImported = 0;

            // Fetch existing names to prevent duplicates
            const { data: existingIngredients } = await supabase.from('ingredients').select('name').eq('restaurant_id', restaurantId);
            const { data: existingRecipes } = await supabase.from('recipes').select('product_name').eq('restaurant_id', restaurantId);

            const existingIngNames = new Set((existingIngredients || []).map(i => i.name.toLowerCase()));
            const existingRecNames = new Set((existingRecipes || []).map(r => r.product_name.toLowerCase()));

            for (const { sheet, rows } of parsed) {
                const config = TEMPLATE_STRUCTURE[sheet];
                addLog(`\n🔄 Processando '${sheet}' (${rows.length} linhas)...`);

                let payload: Record<string, any>[];

                if (config.table === 'ingredients') {
                    payload = rows.map(r => ({
                        restaurant_id: restaurantId,
                        name: String(r['Nome']).trim(),
                        unit_type: r['Unidade'] ? String(r['Unidade']).trim() : 'un',
                        avg_cost_per_unit: cellNum(r['Custo Unitário'] ?? r['Custo Total'] ?? r['Preço de Compra']),
                        stock_quantity: 0,
                        type: config.typeValue,
                    })).filter(p => !existingIngNames.has(p.name.toLowerCase()));
                } else {
                    payload = rows.map(r => ({
                        restaurant_id: restaurantId,
                        product_name: String(r['Nome']).trim(),
                        sale_price: cellNum(r['Preço de Venda']),
                        category: config.typeValue,
                    })).filter(p => !existingRecNames.has(p.product_name.toLowerCase()));
                }

                if (payload.length === 0) {
                    addLog(`⏭️ Nenhum item novo em '${sheet}' (duplicados ignorados).`);
                    continue;
                }


                const { error } = await supabase.from(config.table).insert(payload as any);
                if (error) {
                    addLog(`❌ Erro em '${sheet}': ${error.message}`);
                } else {
                    totalImported += payload.length;
                    addLog(`✅ +${payload.length} em '${sheet}'`);
                }
            }

            addLog(`\n🎉 ${totalImported} registros importados com sucesso!`);
            setStatus('success');
            onComplete();
        } catch (err: any) {
            addLog(`❌ Falha: ${err.message}`);
            setStatus('error');
        } finally {
            setLoading(false);
        }
    };

    const reset = () => {
        setStatus('idle');
        setLogs([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <div className="bg-slate-50 border-2 border-dashed border-primary-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h3 className="font-bold text-slate-900 flex items-center text-lg">
                        <UploadCloud className="w-5 h-5 mr-2 text-primary-500" />
                        Importação via Template Padrão
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        Use o template oficial do Gastão. Preencha os dados e importe.
                    </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                    <button
                        onClick={downloadTemplate}
                        className="px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg font-medium hover:bg-slate-50 flex items-center text-sm shadow-sm"
                    >
                        <Download className="w-4 h-4 mr-2 text-green-600" />
                        Baixar Template
                    </button>
                    {status !== 'idle' ? (
                        <button onClick={reset} className="px-4 py-2 text-sm bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300">
                            Nova Importação
                        </button>
                    ) : (
                        <>
                            <input type="file" accept=".xlsx,.xls" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 flex items-center text-sm shadow-sm"
                            >
                                <UploadCloud className="w-4 h-4 mr-2" />
                                Importar Planilha
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Template guide */}
            {status === 'idle' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(Object.keys(TEMPLATE_STRUCTURE) as SheetName[]).map(sheet => (
                        <div key={sheet} className="bg-white border border-slate-200 rounded-lg p-3">
                            <div className="font-semibold text-slate-700 text-xs mb-1">📄 {sheet}</div>
                            <div className="text-xs text-slate-400 space-y-0.5">
                                {TEMPLATE_STRUCTURE[sheet].columns.map(col => (
                                    <div key={col}>• {col}</div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Log terminal */}
            {status !== 'idle' && (
                <div className="bg-slate-900 rounded-lg p-4 text-xs font-mono text-green-400 h-56 overflow-y-auto shadow-inner leading-relaxed">
                    {logs.map((l, i) => <div key={i}>{l}</div>)}
                    {loading && (
                        <div className="flex items-center text-primary-400 mt-2">
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processando...
                        </div>
                    )}
                    {status === 'success' && <div className="flex items-center text-green-500 font-bold mt-2"><CheckCircle2 className="w-5 h-5 mr-2" /> Concluído.</div>}
                    {status === 'error' && <div className="flex items-center text-red-500 font-bold mt-2"><AlertTriangle className="w-5 h-5 mr-2" /> Abortado.</div>}
                </div>
            )}
        </div>
    );
};
