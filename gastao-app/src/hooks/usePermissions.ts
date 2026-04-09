import { useAuth } from '../contexts/AuthContext';
import type { ViewMode } from '../lib/types';

export function usePermissions() {
    const { perfil } = useAuth();

    const isDono          = perfil === 'dono';
    const isGerente       = perfil === 'gerente';
    const isFuncionario   = perfil === 'funcionario';
    const isDonoOrGerente = isDono || isGerente;

    const viewMode: ViewMode = isFuncionario ? 'operacao' : 'gerencia';

    return {
        perfil,
        isDono,
        isGerente,
        isFuncionario,
        isDonoOrGerente,
        viewMode,
        // Visibilidade de dados financeiros
        canViewCMV:        isDonoOrGerente,
        canViewCosts:      isDonoOrGerente,
        canEdit:           isDonoOrGerente,
        // Navegação
        canViewEquipe:     isDonoOrGerente,
        canViewIngredients: isDonoOrGerente,
        canViewSales:      isDonoOrGerente,
        canViewDashboard:  isDonoOrGerente,
        // Gestão de equipe
        canInvite:         isDono,
        canRemoveMembro:   isDono,
    };
}
