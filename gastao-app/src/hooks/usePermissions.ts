import { useAuth } from '../contexts/AuthContext';
import type { ViewMode } from '../lib/types';

export function usePermissions() {
    const { perfil } = useAuth();

    const isDono          = perfil === 'dono';
    const isGerente       = perfil === 'gerente';
    const isFuncionario   = perfil === 'funcionario';
    const isBpo           = perfil === 'bpo';
    // BPO tem todos os poderes de gestão (opera o restaurante pelo cliente)
    const isDonoOrGerente = isDono || isGerente || isBpo;

    // Fail-closed: enquanto o perfil carrega (null), assume operação — nunca
    // mostra UI de gerência por um instante para quem talvez não deva ver.
    const viewMode: ViewMode = (perfil == null || isFuncionario) ? 'operacao' : 'gerencia';

    return {
        perfil,
        isDono,
        isGerente,
        isFuncionario,
        isBpo,
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
        canInvite:         isDono || isBpo,
        canRemoveMembro:   isDono,
    };
}
