'use client';

import { Check, Info, Mail, X } from 'lucide-react';

/**
 * Modal "Importante sobre o e-mail" — novo layout glass.
 * Mobile: bottom sheet. sm+: janela centralizada.
 * Usado em src/components/card/creditCardForm.tsx.
 */
export function EmailNoticeModal({
  open,
  onClose,
  isPagatgHost = false,
}: {
  open: boolean;
  onClose: () => void;
  isPagatgHost?: boolean;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(7,6,11,0.55)] backdrop-blur-[10px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full flex-col gap-4 rounded-t-[32px] border-t border-white/[0.16] bg-[rgba(30,25,40,0.88)] px-5 pb-6 pt-3 font-[family-name:var(--font-outfit)] text-[#f4f2f7] shadow-[0_-30px_80px_-20px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-[30px] backdrop-saturate-150 sm:max-w-[480px] sm:gap-5 sm:rounded-[32px] sm:border sm:p-7 sm:shadow-[0_40px_120px_-30px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.12)]"
      >
        {/* Alça (mobile) */}
        <span className="mx-auto h-[5px] w-11 rounded-full bg-white/30 sm:hidden" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-[18px] top-[18px] hidden h-10 w-10 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.08] text-[#d9d4e3] transition hover:bg-white/[0.14] sm:flex"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3.5 sm:flex-col sm:gap-3 sm:pt-1.5 sm:text-center">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/[0.18] bg-[radial-gradient(80%_80%_at_30%_20%,rgba(169,158,248,0.55),transparent_70%),radial-gradient(80%_80%_at_80%_90%,rgba(246,182,122,0.5),transparent_70%)] bg-white/[0.08] sm:h-[68px] sm:w-[68px]">
            <Mail
              className="h-6 w-6 text-white sm:h-7 sm:w-7"
              strokeWidth={1.8}
            />
          </div>
          <div>
            <h3
              id="email-modal-title"
              className="text-xl font-medium sm:text-2xl"
            >
              Importante sobre o e-mail
            </h3>
            <p className="mt-0.5 text-sm text-[#a9a3b8] sm:mt-1 sm:text-[15px]">
              Use o e-mail correto para continuar
            </p>
          </div>
        </div>

        <div className="flex gap-3 rounded-[20px] border border-[rgba(240,168,108,0.45)] bg-[rgba(245,138,42,0.08)] p-3.5 sm:p-4">
          <Info className="mt-px h-[18px] w-[18px] shrink-0 text-[#ffc48f] sm:h-5 sm:w-5" />
          <div>
            <p className="text-sm font-medium text-[#ffc48f] sm:text-[15px]">
              E-mail obrigatório
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-[#d9d4e3] sm:text-sm">
              {isPagatgHost ? (
                <>
                  Use o{' '}
                  <strong className="font-semibold text-white">
                    mesmo e-mail
                  </strong>{' '}
                  vinculado à sua assinatura do canal/grupo.
                </>
              ) : (
                <>
                  Use o{' '}
                  <strong className="font-semibold text-white">
                    mesmo e-mail
                  </strong>{' '}
                  que você utilizou para se cadastrar na plataforma.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="rounded-[20px] bg-white/[0.06] px-3.5 py-1 sm:px-4">
          <p className="pb-0.5 pt-2.5 text-xs text-[#a9a3b8] sm:text-[13px]">
            Por que isso é importante?
          </p>
          <ul>
            {[
              'Recebimento da confirmação',
              'Acesso aos produtos comprados',
            ].map((item, i, arr) => (
              <li
                key={item}
                className={`flex items-center gap-2.5 py-2.5 text-sm text-[#e6e1ee] ${i < arr.length - 1 ? 'border-b border-dashed border-white/[0.12]' : 'pb-3'}`}
              >
                <Check className="h-4 w-4 text-[#f6b67a]" strokeWidth={2.4} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="h-14 rounded-full bg-[linear-gradient(90deg,#8d80f4_0%,#c9c2f7_30%,#f3eef0_50%,#f6b67a_75%,#f58a2a_100%)] text-base font-medium text-[#17131f] shadow-[0_14px_40px_-14px_rgba(245,138,42,0.55)] transition active:scale-[0.99]"
        >
          Entendi, vou continuar
        </button>

        <label className="flex cursor-pointer items-center justify-center gap-2.5 text-sm text-[#a9a3b8]">
          <input
            type="checkbox"
            className="m-0 h-[18px] w-[18px] accent-[#f58a2a]"
            onChange={(e) => {
              if (e.target.checked)
                localStorage.setItem('emailModalShown', 'true');
              else localStorage.removeItem('emailModalShown');
            }}
          />
          Não mostrar novamente
        </label>
      </div>
    </div>
  );
}
