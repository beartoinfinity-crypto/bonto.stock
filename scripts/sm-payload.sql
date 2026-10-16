select 'col_sizes' as k,
  sum(length(t.insider::text))::text as insider,
  sum(length(t.institutional::text))::text as inst,
  sum(length(t.congress::text))::text as congress,
  sum(length(t.squeeze::text))::text as squeeze,
  count(*)::text as n
from smart_money_scan_rows t where universe = 'index';
