-- Normalize default category slugs and labels to the latest naming.
-- Safe to run multiple times.
-- Handles cases where both old and new category rows already exist for the same user.

UPDATE public.expenses
SET category = 'keperluan'
WHERE category = 'dapur';

UPDATE public.expenses
SET category = 'lifestyle'
WHERE category = 'fashion';

UPDATE public.expenses
SET category = 'sedekah'
WHERE category = 'donasi';

UPDATE public.recurring_templates
SET category = 'keperluan'
WHERE category = 'dapur';

UPDATE public.recurring_templates
SET category = 'lifestyle'
WHERE category = 'fashion';

UPDATE public.recurring_templates
SET category = 'sedekah'
WHERE category = 'donasi';

DELETE FROM public.categories
WHERE slug IN ('dapur', 'fashion', 'donasi');

UPDATE public.categories
SET label = 'Keperluan',
    emoji = '�️'
WHERE slug = 'keperluan';

UPDATE public.categories
SET label = 'Lifestyle',
    emoji = '👟'
WHERE slug = 'lifestyle';

UPDATE public.categories
SET label = 'Sedekah',
    emoji = '🤲'
WHERE slug = 'sedekah';

UPDATE public.categories
SET emoji = '💻'
WHERE slug = 'digital';
