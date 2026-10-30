import { Modal } from '@/components/ui/Modal';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { reportMoney, type PlatformBalance } from './report-types';

export function PlatformBalanceDetail({
  balance: b,
  onClose,
}: {
  balance: PlatformBalance;
  onClose: () => void;
}) {
  return (
    <Modal open title={b.name} onClose={onClose} maxWidth="max-w-2xl">
      <ScrollArea className="space-y-4 pr-2">
        <p className="text-sm">
          Dono: {b.owner.name} · {b.owner.email}
        </p>
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            ['Saldo atribuído', b.balanceCents],
            ['Disponível projetado', b.availableBalanceCents],
            ['Reservas de saque', b.pendingWithdrawalsGrossCents],
            ['Líquido concluído', b.earnedCents],
            ['Saques aprovados/concluídos', b.withdrawnGrossCents],
            [
              b.walletScope === 'shared-owner'
                ? 'Carteira compartilhada do dono'
                : 'Carteira do dono',
              b.ownerWalletBalanceCents,
            ],
          ].map(([label, value]) => (
            <div className="rounded-xl border p-3" key={label}>
              <dt className="text-xs text-zinc-500">{label}</dt>
              <dd className="mt-1 font-semibold tabular-nums">
                {reportMoney(Number(value))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-zinc-500">
          Saldo projetado não determina limite de saque. Carteira pertence ao
          dono; não some carteiras compartilhadas entre plataformas.
        </p>
        {!b.historicalAttributionComplete && (
          <p className="text-sm text-amber-600">
            Histórico incompleto: valores sem atribuição segura não foram
            distribuídos.
          </p>
        )}
      </ScrollArea>
    </Modal>
  );
}
