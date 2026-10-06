import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const { salesLoadErrorMessage, isMissingSaleActorNames } = loadTypescriptModule('src/lib/sales/load-errors.ts');

test('Sales preserves messages from PostgREST objects and normal exceptions', () => {
  assert.equal(salesLoadErrorMessage({ code: '42501', message: 'permission denied for table unit_sale_terms' }), 'permission denied for table unit_sale_terms');
  assert.equal(salesLoadErrorMessage(new Error('Network unavailable')), 'Network unavailable');
  for (const value of [null, undefined, {}, { message: '' }, { message: 12 }]) assert.equal(salesLoadErrorMessage(value), 'Could not load sales data.');
});

test('only a missing optional name lookup is allowed to fall back', () => {
  assert.equal(isMissingSaleActorNames({ code: 'PGRST202', message: 'Could not find the function public.sale_actor_names(p_sales) in the schema cache' }), true);
  for (const error of [null, { code: 'PGRST202', message: 'Could not find sale_workflow_context' }, { code: '42501', message: 'permission denied for sale_actor_names' }, new Error('Network unavailable')]) assert.equal(isMissingSaleActorNames(error), false);
});
