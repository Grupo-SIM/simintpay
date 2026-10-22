import 'reflect-metadata';
import { expect, test, mock } from 'bun:test';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PlatformsController } from './platforms.controller';

test('DELETE /platforms/:tag delegates authenticated actor and tag', async () => {
  const remove = mock(async () => ({ data: { tag: 'COMUNIDADE' } }));
  const controller = new PlatformsController({ remove } as never);
  const user = { sub: 'owner', role: 'USER', email: 'owner@example.com' };
  expect(Reflect.getMetadata(PATH_METADATA, PlatformsController)).toBe('platforms');
  expect(Reflect.getMetadata(PATH_METADATA, controller.remove)).toBe(':tag');
  expect(Reflect.getMetadata(METHOD_METADATA, controller.remove)).toBe(RequestMethod.DELETE);
  expect(await controller.remove('COMUNIDADE', user)).toEqual({ data: { tag: 'COMUNIDADE' } });
  expect(remove).toHaveBeenCalledWith('COMUNIDADE', user);
});
