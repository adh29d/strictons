-- ============================================================================
-- Static seed data — runs automatically on `supabase db reset`.
-- Reference data only; auth-linked dev fixtures live in scripts/seed.ts.
-- ============================================================================

-- ---- mood_options (the brief 9.6 starter list) ----------------------------
-- Slugs are stable IDs; reference_image_cloudinary_ids will be populated by
-- the Strictons admin once Cloudinary is wired up in Phase 5. Empty array
-- here is intentional and not a placeholder bug.

insert into public.mood_options (slug, label, description, design_treatment_notes)
values
  (
    'warm-and-inviting',
    'Warm and inviting',
    'Soft natural light, hospitality cues, food and people, gentle warm tones. For cafés, restaurants, family-friendly venues, accommodation-adjacent businesses.',
    'Warm colour palette (terracotta, cream, soft amber). Photography emphasises human moments and food as sensory experience. Serif or rounded sans typography. Generous, comfortable spacing.'
  ),
  (
    'premium-and-minimal',
    'Premium and minimal',
    'Generous white space, restrained typography, single hero image, high-end product or experience focus. For day spas, fine dining, jewellery, galleries, premium tour operators.',
    'Monochrome or single-accent palette. Hairline rules, light-weight serifs. Photography is editorial — single subject, deep negative space. Density low.'
  ),
  (
    'energetic-and-playful',
    'Energetic and playful',
    'Bold type, bright colours, sans-serif or hand-lettered, action photography. For adventure activities, kids attractions, BattleKart-style experiences, family fun parks.',
    'Saturated primary colours. Heavy display sans or hand-lettered headlines. Dynamic crops, motion blur acceptable. Density high; layouts feel busy on purpose.'
  ),
  (
    'rustic-and-authentic',
    'Rustic and authentic',
    'Earth tones, textured backgrounds, craft-focused photography, often with a heritage or artisan story. For distilleries, farms, makers, regional produce.',
    'Earth palette (clay, moss, oak). Slab serif or weathered sans. Photography prioritises hands, materials, process. Subtle paper or grain textures behind type.'
  ),
  (
    'coastal-and-breezy',
    'Coastal and breezy',
    'Cool blues and sandy neutrals, sky and water, light and airy, relaxed typography. For beach businesses, boat operators, swimwear, surf schools.',
    'Cool palette (sea-blue, sand, white). Light-weight humanist sans. Photography emphasises horizon, light, water. Type kept open and airy.'
  ),
  (
    'botanical-and-natural',
    'Botanical and natural',
    'Greens, organic shapes, plant photography, often illustrative or hand-drawn elements. For gardens, eco-experiences, wellness, herbal or natural retail.',
    'Green-led palette with accent botanical illustration. Soft serif or organic sans. Photography emphasises plant detail. Subtle hand-drawn flourishes acceptable.'
  ),
  (
    'vibrant-and-cultural',
    'Vibrant and cultural',
    'Saturated colours, strong patterns, cultural cues from cuisine or craft, layered composition. For ethnic restaurants, cultural experiences, markets, festivals.',
    'Saturated multi-hue palette. Display type with cultural reference. Photography feels close-in and abundant. Layered composition; pattern fills permitted.'
  ),
  (
    'sleek-and-modern',
    'Sleek and modern',
    'Geometric, high-contrast, contemporary sans-serif, architectural photography. For tech-adjacent businesses, modern boutiques, design-forward retail.',
    'Black/white plus single accent. Geometric sans. Photography architectural — line, edge, form. Layouts grid-driven, no decoration.'
  ),
  (
    'adventurous-and-bold',
    'Adventurous and bold',
    'High-energy outdoor photography, dramatic skies, rugged textures, active-voice copy. For outdoor adventure, extreme sports, remote experiences, 4WD tours.',
    'High-contrast outdoor palette (deep blues, ochres, charcoal). Heavy condensed sans. Photography prioritises scale, weather, motion. Active-voice copy in display.'
  ),
  (
    'refined-and-classic',
    'Refined and classic',
    'Serif typography, balanced symmetric layouts, muted palettes, traditional cues. For heritage venues, classic dining, antiques, formal experiences.',
    'Muted palette (ivory, charcoal, deep burgundy or navy). Traditional serifs (Garamond / Caslon family). Symmetric layouts. Photography subdued and respectful.'
  );
