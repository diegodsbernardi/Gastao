import { FileSpreadsheet } from 'lucide-react';
import { ExcelImporter } from '../components/ExcelImporter';

export const ImportarFichaTecnica = () => {
    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <FileSpreadsheet className="w-6 h-6 text-primary-500" />
                    Importar Planilha
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    Baixe a Planilha-Mãe, preencha com seus insumos, preparos e fichas, e envie aqui.
                </p>
            </div>

            <ExcelImporter onComplete={() => { /* noop — usuário vai para /ingredients pra ver o resultado */ }} />
        </div>
    );
};
