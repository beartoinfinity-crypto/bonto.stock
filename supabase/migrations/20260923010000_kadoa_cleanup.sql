-- Cleanup one-shot latency test rows and ensure natural-key constraint is gone.
DELETE FROM public.politician_trades WHERE source = 'kadoa' AND symbol LIKE 'TEST%' AND politician = 'Latency Test';

ALTER TABLE public.politician_trades DROP CONSTRAINT IF EXISTS politician_trades_natural_key;
ALTER TABLE public.politician_trades DROP CONSTRAINT IF EXISTS politician_trades_symbol_politician_transaction_date_transaction_type_amount_from_amount_to_key;
