import React, { useEffect, useRef, useState } from 'react';

// Input numérico amigável ao padrão BR: aceita vírgula OU ponto como separador
// decimal e mantém exatamente o que o usuário digitou enquanto edita (não força
// o ponto no meio da digitação, o que causava salto de cursor). Emite `number`
// (ou '' quando vazio) via onChange — mesmo contrato dos inputs controlados que
// já existiam. Substitui `type="number"`, que no teclado do celular BR fazia
// "25,90" virar 0.
interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
    value: number | '';
    onChange: (v: number | '') => void;
}

const toRaw = (v: number | ''): string => (v === '' ? '' : String(v).replace('.', ','));
const parse = (raw: string): number | '' => {
    const norm = raw.replace(',', '.');
    if (norm === '' || norm === '.') return '';
    const n = Number(norm);
    return Number.isFinite(n) ? n : '';
};

export const DecimalInput = ({ value, onChange, ...rest }: Props) => {
    const [raw, setRaw] = useState<string>(toRaw(value));
    const editing = useRef(false);

    // Sincroniza quando o valor muda por fora (reset de form, seleção de produto,
    // etc.). Só reescreve o texto se o número externo divergir do que está
    // digitado — assim não atropela a digitação em andamento.
    useEffect(() => {
        if (editing.current) return;
        if (parse(raw) !== value) setRaw(toRaw(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <input
            {...rest}
            type="text"
            inputMode="decimal"
            value={raw}
            onFocus={e => { editing.current = true; rest.onFocus?.(e); }}
            onBlur={e => {
                editing.current = false;
                // Ao sair, normaliza o texto pro número final (limpa "25," → "25,")
                setRaw(toRaw(parse(raw)));
                rest.onBlur?.(e);
            }}
            onChange={e => {
                // permite só dígitos e um separador decimal
                const t = e.target.value.replace(/[^\d.,]/g, '');
                setRaw(t);
                onChange(parse(t));
            }}
        />
    );
};
