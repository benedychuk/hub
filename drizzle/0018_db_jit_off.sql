-- Швидкодія: вимикаємо JIT-компіляцію запитів для бази Hub. На запитах дашборда PostgreSQL витрачав ~2,5 с на компіляцію
-- (оцінка вартості вища за jit_above_cost), а саме виконання — ~0,1 с. Дані й результати не змінюються.
-- Якщо роль не має права змінювати налаштування бази (або JIT недоступний), міграція нічого не робить і не падає.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET jit = off', current_database());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'jit off skipped: %', SQLERRM;
END $$;
