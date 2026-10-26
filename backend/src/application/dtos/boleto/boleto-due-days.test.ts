import { describe, expect, it } from 'bun:test';
import { validate } from 'class-validator';
import { CreateBoletoDto } from './create-boleto.dto';
import { UpdateBoletoDto } from './update-boleto.dto';

for (const Dto of [CreateBoletoDto, UpdateBoletoDto]) {
  describe(`${Dto.name} due days`, () => {
    for (const days of [0, 1, 3, 90]) {
      it(`accepts ${days} days`, async () => {
        const dto = Object.assign(new Dto(), { titulo: 'Mensalidade', valor: 25, vencimentoDias: days });
        expect(await validate(dto)).toHaveLength(0);
      });
    }
    for (const days of [-1, 91, 1.5, '3']) {
      it(`rejects invalid days ${JSON.stringify(days)}`, async () => {
        const dto = Object.assign(new Dto(), { titulo: 'Mensalidade', valor: 25, vencimentoDias: days });
        expect((await validate(dto)).some(error => error.property === 'vencimentoDias')).toBe(true);
      });
    }
  });
}
