# Strictons — Project Brief

## 1. What Strictons is

Strictons is a guest experience company that produces beautifully designed, hotel-branded guides tailored to each property, its local area, and its guest profile. Every guest receives a physical guide on check-in, with their room keycards held inside the back cover. A digital version of the same guide is accessible via QR codes throughout the printed copy and is also sent in pre-arrival correspondence.

The guides are designed to do two things at once: lower arrival anxiety by orienting guests in an unfamiliar environment and answering the common questions they have on arrival, and then raise curiosity by inspiring them to engage with hotel amenities and explore the surrounding community. The goal is for guests to feel oriented, confident in their hotel choice, cared for, and curious to explore.

## 2. How the model works

### For hotels
Guides are provided to hotels at zero cost. The hotel's commitment is time and distribution:

- A design meeting of up to 90 minutes to brief Strictons on what they want their guide to look like.
- Reviewing a pre-populated candidate list of local businesses Strictons has researched. The hotel can remove or add businesses.
- Approving the final guide design.
- Committing to distribute a guide to every guest for a minimum of 12 months — physically on check-in, and digitally via pre-arrival correspondence where possible (some properties are walk-in only).
- One round of printing changes is offered after 6 months.

The hotel retains content approval over their portion of the guide, but must respond within a contractually defined timeframe.

### For local businesses
Once a hotel approves the candidate list, Strictons contacts each candidate business on behalf of the hotel and invites them to a presentation (framed as a coffee or morning tea). More businesses are invited than there are slots available — this builds in a fair, transparent first-come-first-served allocation based on who signs the contract and pays the deposit first.

Pricing is based strictly on physical guide ad size, because the physical ad is the more reliable first impression. Every guest opens the physical guide to retrieve their keycards and is likely to flip through it; not every guest clicks the digital guide link in pre-arrival emails.

| Ad size | Price |
|---|---|
| Quarter page | $900 |
| Half page | $1,600 |
| Full page | $3,000 |
| Premium positioning (e.g. inside front cover, next to back cover) | Surcharge added |

Businesses pay a 50% deposit on signing. They get two rounds of revisions on their ad design. If after two rounds they reject the final design, they don't pay the remaining 50% and are removed from the project — but the initial 50% deposit is non-refundable. After signing, businesses receive a portal link to submit all the information used to build their digital listing and design their physical ad. Strictons designs the ads in-house, but a business can supply a pre-designed ad if they prefer.

### Candidate list curation
The candidate list is researched and curated by Strictons against quality requirements set per hotel — including star rating, years in service, relevance to that hotel's guest profile, and distance from the property. The internal portal supports three ways of building this list:

- **Google Places integration** — search businesses by location and quality criteria, and add directly to the candidate list
- **CSV upload** — bulk pre-fill a hotel's candidate list from a prepared spreadsheet
- **Manual add** — add individual businesses by hand for cases the other two methods don't cover

## 3. Brand and domain architecture

There are two distinct brand presences:

- **strictons.com** — Marketing site and partner portal. This is where hotels and businesses interact with Strictons.
- **mystay.au** — The consumer-facing digital guide. Chosen because the term "mystay" is relatable for guests scanning QR codes, and the short URL allows clean QR code design. Strictons owns this domain.

The mystay.au architecture is a single Next.js application serving all hotels via subpaths (e.g. `mystay.au/hotel-name`).

### 3.1 Custom domain support

mystay.au launches as the only active domain. However, the architecture is built from day one to support custom hotel domains (e.g. `guide.beachcomberhotel.com.au`) pointing at the same digital guide content.

This is a deliberate "build the architecture, defer the feature" decision. The reasoning:

- A premium hotel will eventually ask to put their own domain on the guide for brand consistency and trust signals. The first request is likely within the first 6 months of operation.
- Retrofitting domain-awareness through every internal link, canonical URL, sitemap entry, OG tag, and analytics event is expensive and bug-prone after the fact. Building it correctly the first time is cheap.
- However, exposing custom domains as a self-service feature at launch creates real operational overhead (DNS misconfigurations, SSL provisioning, support burden) for a feature that few hotels will use initially.
- Keeping mystay.au as the default also protects Strictons' own brand recognition with end-consumers, since guests visiting multiple Strictons hotels start to recognise mystay.au as a quality signal.

The architectural requirements:

- **Hostname-or-subpath routing.** Next.js middleware resolves which hotel to serve based on either the URL subpath (`mystay.au/{hotel-slug}`) OR the hostname (`guide.beachcomberhotel.com.au`). At launch, only the subpath path resolves anything. The hostname path is dormant but functional.
- **`custom_domain` field on the hotel record from day one**, even though it remains null for every hotel at launch.
- **Domain-aware link generation throughout.** Internal links, canonical URLs, sitemaps, OG image URLs, and absolute URLs all look up the hotel's serving domain rather than hardcoding mystay.au.
- **Domain-aware analytics.** Every tracked event records which domain the guest accessed the guide through (see section 7.2 — this is captured as part of the standard event dimensions).

When a hotel requests their own domain, the process is manual on the Strictons side — a runbook executed in the admin portal. The hotel provides the subdomain they want, points a CNAME at Vercel, Strictons attaches the domain in the Vercel project and updates the `custom_domain` field on the hotel record. SSL is provisioned automatically by Vercel. Total turnaround should be 24 hours once DNS propagates.

Self-service custom domain configuration is explicitly **not** built at launch. It can be added later if volume justifies it.

## 4. Digital guide structure (mystay.au)

The hotel page contains category sections including:

- Welcome / orientation
- Amenities
- Eat and drink (hotel restaurants/bars + featured local food and drink businesses)
- Things to do (broad — includes adrenaline activities, boutique shops, galleries, zoos, and similar)
- Room service
- Events
- Map (showing the hotel and all featured businesses)

"Eat and drink" and "Things to do" are the two categories that contain featured local businesses. Each business has its own page with opening hours, social links, booking links, gallery, and any unique offers extended to hotel guests.

## 5. Physical guide structure

- Welcome note at the front
- Amenities listed
- Hotel restaurants and businesses
- Selected local businesses
- Local area map in the middle, showing the hotel and all featured businesses
- Keycard pocket inside the back cover
- QR codes placed throughout, linking to the corresponding sections of the digital guide

## 6. What needs to be built

Three distinct surfaces, all built on the same stack:

- Next.js, deployed via Vercel
- GitHub for source control
- Supabase for database and auth
- Magic link authentication, with 7-day "remember this device" sessions, delivered via SendGrid from welcome@strictons.com (already configured)
- Cloudinary for image storage, transformation, and delivery
- Supabase Storage for non-image files (contracts, signed agreements, brand guideline PDFs)

The marketing site and the portals (internal admin, hotel partner, business partner) are separate Next.js apps within a single monorepo, sharing common UI components, types, and Supabase clients. mystay.au is its own Next.js app, also within the same monorepo.

### 6.1 strictons.com — marketing site
Public-facing marketing site explaining the product to prospective hotels and businesses. Standard marketing site requirements apply: clear value propositions for both audiences, case studies, contact / lead capture.

### 6.2 strictons.com — internal admin portal
Used by Strictons staff to run the operation.

**Hotel management**
- Add new hotels
- Set design meeting date and time
- Build the candidate business list per hotel via three methods: Google Places search-and-add, CSV bulk upload, and manual entry
- Add or update the hotel's contact email
- Once a hotel signs the contract, manually trigger sending the portal access link to the hotel's email
- View and manage all hotels in flight

**Business management**
- Add new businesses
- Track contract status, deposit status, and ad design status
- Manage the link between businesses and the hotel guide(s) they appear in

**Other**
- Internal communications with both hotels and businesses
- Visibility into portal activity (which hotels have responded, which businesses have submitted info, etc.)

### 6.3 strictons.com — hotel partner portal
What hotels see after they receive their access link.

- Magic link sign-in via the email Strictons configured
- View the candidate business list — add, remove, approve
- View their upcoming design meeting and reschedule if needed
- Add other users from their team to the portal by email (each gets their own magic link sign-in)
- Contact Strictons staff through the portal
- Access recorded design meetings
- Request changes for the next print run (the one round of changes available after 6 months)
- Update their digital guide content — text variables (phone, website, descriptions, etc.) and images. Layout cannot be changed.
- Cannot edit physical guide content outside the scheduled change window

**Important controls**
- An admin role per hotel that can add and remove other users (since magic links have no password to revoke, removal must be deliberate and immediate)
- "Remember this device" sessions valid for 7 days, after which re-authentication via magic link is required
- Audit log of who changed what

### 6.4 strictons.com — business partner portal
What featured businesses see after they sign and pay their deposit.

- Magic link sign-in
- Submit all business information (used both for the digital listing and as input to ad design)
- Update digital guide content (the listing on mystay.au) — text variables, images, opening hours, social links, booking links, offers
- Cannot update or modify their physical ad outside the contracted revision rounds
- View ad design proofs and submit revision requests within the two-round limit
- Contact Strictons staff through the portal

### 6.5 mystay.au — guest-facing digital guide
- Single Next.js app serving all hotels at `mystay.au/{hotel-slug}` at launch
- Architecture supports custom hotel domains from day one but they are not exposed as a self-service feature at launch (see section 3.1)
- Next.js middleware routes incoming requests by either subpath (`mystay.au/{hotel-slug}`) or hostname (custom domains, dormant at launch)
- All internal links, canonical URLs, sitemaps, and OG tags are domain-aware from day one
- Renders hotel pages with all category sections
- Renders individual business pages
- Renders the area map with hotel and featured businesses
- Performance is critical — guests will often access this on mobile, often on slow hotel WiFi, often as a first impression
- Must be designed to handle pre-arrival access (no auth required for guests)

### 6.6 Email infrastructure

All transactional email is sent via **SendGrid** from `welcome@strictons.com`, which is already configured. This includes:

- Magic link authentication emails for all three portal audiences (hotel staff, business staff, Strictons internal users)
- Approval reminders during the 2-week hotel approval windows
- Notifications when ad proofs are ready for business review
- Notifications to Strictons staff when briefs are submitted
- Renewal reports at month 10 of each contract

**Implementation notes:**
- Supabase Auth's default magic link mechanism is replaced with a custom flow that generates the token via Supabase but sends the email via SendGrid, so all email is templated and branded consistently from welcome@strictons.com.
- Email templates live in version control (one source of truth) and are rendered server-side at send time. Use a templating approach like React Email or MJML.
- All sends are logged with delivery status from SendGrid webhooks for support and audit purposes.
- Bounce and spam-complaint handling is wired up — repeated bounces on a hotel or business contact email surface as a flag in the admin portal.

### 6.7 Image infrastructure

**Cloudinary** is the canonical image store for all guest-facing and brief-portal images. **Supabase Storage** is used for non-image files (signed contracts, brand guideline PDFs uploaded by businesses, and other documents that don't need transformation).

**Why Cloudinary over Supabase Storage for images:**
- Strictons captures high-resolution masters (up to 12 MP for full-page ad imagery) and needs to deliver many smaller derivatives — admin portal thumbnails, brief portal previews, mystay.au mobile-optimised renders. Cloudinary generates these on-demand from URL transformations rather than requiring multiple stored copies.
- Automatic format negotiation (WebP, AVIF, JPEG) at the CDN edge improves mystay.au mobile performance materially.
- Built-in upload validation for pixel dimensions, file size, and EXIF inspection — directly supports the section 9.9 image resolution thresholds without writing custom validation code.
- Smart cropping and on-the-fly transformations remove the need to manage multiple derivative files and cache invalidation.

**Architecture:**
- Cloudinary holds the canonical image. The Supabase database stores the Cloudinary public ID and any metadata needed (alt text, photographer credit, business or hotel association, brief context).
- Next.js apps read the public ID from Supabase and construct Cloudinary URLs at render time with the transformations they need.
- Uploads happen through a signed-upload flow — the client requests a signed upload preset from a Strictons API route, then uploads directly to Cloudinary. The Strictons backend records the result in Supabase.
- Folder structure within Cloudinary mirrors the data model: `hotels/{hotel_id}/...`, `businesses/{business_id}/ads/{ad_size}/...`, `businesses/{business_id}/listing/...`, etc.

**Cost trajectory:** Cloudinary's free tier (25 monthly credits) covers early-stage volume comfortably. Paid tiers begin at approximately US$99/month when free is outgrown. Worth monitoring usage in the admin portal once volume picks up.

## 7. Tracking and analytics

This is the lever that drives advertiser renewals. The schema is designed in from day one rather than retrofitted, and **all events are tracked** — every interaction on mystay.au is captured and attributable to a hotel and, where relevant, to a specific business listing.

Physical guide impressions are not directly trackable — the narrative for advertisers is "every guest received a printed guide containing your ad" as the impression baseline, plus the trackable digital metrics described below.

### 7.1 Event types captured

- **QR code scans** from the physical guide — every QR code in the print run has a unique tracked ID (welcome page, map, each business listing, etc.)
- **Page views** at hotel level and per business listing
- **Outbound clicks** — booking links, social links, websites, phone tap-to-call, directions
- **Unique guest offer code redemptions** at participating businesses

### 7.2 Event dimensions

Every event is tagged with the following dimensions at capture time. Anything not captured here cannot be reconstructed later.

**Identity and context**
- `event_id` — unique identifier
- `event_type` — page_view, qr_scan, outbound_click, offer_redemption, phone_tap, directions_tap, social_click, booking_link_click
- `timestamp` — UTC
- `session_id` — anonymous, persists for the visit only

**Where it happened**
- `hotel_id` — which hotel's guide was being used
- `business_id` — which business the event relates to (null for hotel-level events)
- `page_type` — hotel_home, hotel_category, business_listing, map, amenity, etc.
- `category` — eat_and_drink, things_to_do, amenities, etc. where applicable
- `serving_domain` — which domain the guest accessed the guide through (mystay.au by default; custom hotel domain where applicable). See section 3.1.

**How they got there**
- `referrer_type` — qr_scan, pre_arrival_email, direct, internal_navigation
- `qr_code_id` — which specific QR code in the physical guide was scanned
- `utm_source`, `utm_medium`, `utm_campaign` — for pre-arrival email tracking

**Device and location**
- `device_type` — mobile, tablet, desktop
- `os`, `browser` — for diagnostics
- `country`, `region` — derived from IP, never stored at higher precision than region

**Business-specific (when applicable)**
- `ad_size` — quarter, half, full (denormalised onto events for fast advertiser reporting)
- `ad_position` — standard, premium_inside_front, premium_back, etc.
- `outbound_destination` — for clicks, what type of link was tapped (booking, social_instagram, social_facebook, website, phone, directions)

**Offer redemption-specific**
- `offer_code` — the unique code redeemed
- `redemption_method` — how the redemption was confirmed (business portal entry, geo-confirmed, etc.)

What is explicitly **not** captured: full IP addresses, precise geolocation, names, email addresses, or anything else that identifies an individual guest. Sessions are anonymous. This keeps Strictons aligned with the Australian Privacy Principles and simplifies the retention conversation.

### 7.3 Retention

- **Raw events: 18 months.** Long enough to support year-over-year comparisons (a renewal conversation in month 11 needs prior-cycle data, so 13 months minimum, with 18 giving comfortable headroom). Short enough to keep the events table manageable and to give a defensible "data held only as long as necessary" answer under privacy law.
- **Daily rollups: indefinite.** Small, cheap to store, and become the historical record once raw events age out.
- **Monthly rollups: indefinite.** Used for long-range trend reporting and renewal conversations.

After 18 months, raw events are deleted automatically. Rollups remain. A five-year-old advertiser still has access to their monthly performance trend; they just don't have click-level forensics from three years ago.

### 7.4 Aggregation rollups

Three rollup tables, each computed on a schedule via Supabase pg_cron:

**Hourly rollup (`events_hourly`)**
- Granularity: `(hotel_id, business_id, event_type, hour)`
- Metrics: count, unique_session_count
- Powers near-real-time dashboards ("today's numbers")
- Retention: 90 days, after which the daily rollup is sufficient
- Job: runs at minute 5 of each hour for the previous hour

**Daily rollup (`events_daily`)**
- Granularity: `(hotel_id, business_id, event_type, date)`
- Metrics: count, unique_session_count, plus breakdowns by `referrer_type`, `device_type`, `ad_size`
- The workhorse for advertiser reporting
- Retention: indefinite
- Job: runs at 01:00 UTC for the previous day

**Monthly rollup (`events_monthly`)**
- Granularity: `(hotel_id, business_id, event_type, year_month)`
- Metrics: same as daily, plus month-over-month delta
- Used for renewal conversations and long-range trend graphs
- Retention: indefinite
- Job: runs at 01:30 UTC on the 1st of each month for the previous month

The three tiers exist because the business portal needs to show "today" (hourly), "this month" (daily aggregated up), and "trend over the past year" (monthly). Hitting the daily rollup for a 12-month trend means ~365 rows per business — fast. Hitting raw events for the same query could be tens of thousands of rows per business — slow and expensive at scale.

### 7.5 Implementation rules

- **Idempotent rollup jobs** — each job deletes any existing rows for the period it's computing and re-inserts, so a failed job can simply be re-run without creating duplicates.
- **Index the events table on `(hotel_id, business_id, timestamp)`** as the primary access pattern, with secondary indexes on `(business_id, timestamp)` and `(qr_code_id, timestamp)`. Don't over-index — event tables are insert-heavy and every index slows inserts.
- **Capture server-side where possible.** QR scans hit a redirect URL before landing on mystay.au, so the event is recorded server-side. Outbound clicks are wrapped in a tracking redirect, also server-side. Page views fire from the client. Server-side events are more reliable because they aren't blocked by ad blockers or privacy extensions.
- **Never query raw events from the business portal.** Always query the rollups. The raw events table is for Strictons internal analysis and audit only.

### 7.6 Reporting surfaces

- **Business portal dashboard** — each advertiser sees their own numbers: today's activity, this month's activity, and a 12-month trend graph. Powered by hourly + daily + monthly rollups respectively.
- **Strictons admin portal** — aggregate analytics across all hotels, useful for internal performance review, identifying high-performing placements, and informing pricing.
- **Renewal reports** — generated automatically at month 10 of each contract, summarising the advertiser's full-cycle performance to support the renewal conversation.

## 8. Contractual mechanics that need building support

These are policy decisions reflected in product behaviour:

- **Hotel approval timeframe** — 2 weeks for both the candidate list approval and final guide approval. The portal sends automated reminders during this window, and tracks whether the deadline has been hit.
- **Business revision tracking** — the system enforces the two-round limit and clearly tracks which round each business is on
- **Non-refundable 50% deposit** — unambiguous in the business contract, with a documented design brief process upfront so expectations are set before revisions begin
- **Premium ad position allocation** — first-come-first-served. When a business signs, they select their ad size and, if available, a premium position. Deposit is paid at point of selection and the position is locked in. The portal reflects live availability of premium positions.
- **Quality clause for businesses** — every business in the guide has been reviewed and proposed by Strictons, then approved by the hotel, so initial quality is high. The business contract includes a quality clause: if a business's standards fall during the contract term, they can be **removed from the digital guide on mystay.au**. They cannot be removed from the printed guide once it has gone to print, since the print run is fixed for the 12-month period.
- **12-month distribution commitment** — based on trust. Hotels are expected to want to distribute their beautiful guides for the full term and to reach out to Strictons for a restock if they run low. The hotel contract includes a clause stating that if a hotel fails to meet the distribution commitment, they may be liable to participating businesses on a pro-rata basis (calculated against the ad fee paid for the unfulfilled portion of the term). This is a backstop, not a primary monitoring mechanism.
- **Conflict resolution** — if a hotel wants to remove a featured business mid-contract, the policy needs to be defined upfront and reflected in both contracts. The same digital-only removal mechanism applies.

## 9. The business design brief

The design brief is the document that protects the non-refundable 50% deposit. If a business later rejects an ad through two rounds of revisions, the brief is what proves Strictons designed to spec. Without it, "I don't like it" becomes a subjective dispute. With it, the conversation becomes "which part of the agreed brief did the design fail to deliver?"

The brief is a guided form in the business portal — not a free-form document. Each section is a step. The business can save and resume. They cannot proceed to the design phase until every required field is complete and the sign-off step is ticked. Strictons staff are notified when a brief is submitted, can review it, and can flag clarifications before kicking off design. Once design begins, the brief is locked — changes require a formal change request which may push the business outside the standard revision rounds.

The brief structure **branches by ad size**, because the visual language of each size is genuinely different and the information needed differs accordingly.

### 9.1 Branching logic

After the business selects and pays for their ad size, the portal serves the relevant brief track:

- **Quarter page → information-led brief.** The ad's job is "remind the guest this place exists, tell them where it is, give them a way to act." About 10 fields.
- **Half page → flexible brief with treatment selection.** The business chooses one of three treatments first, and the brief adapts. About 15 fields plus treatment choice.
- **Full page → brand-led brief.** The ad's job is to make the guest stop, dwell, and feel something — not to function as a directory listing. About 10 fields, weighted toward brand and emotion rather than practical information.

### 9.2 Common fields (all ad sizes)

These appear at the top of every brief regardless of size:

**Business identity and assets**
- Business name as it should appear in the ad (some businesses trade under one name and advertise under another)
- Logo files in vector format, with raster fallback if vector unavailable
- Brand colours with specific hex values (not "our blue" — actual values)
- Brand fonts if applicable, with fallback direction if not
- Existing brand guidelines document, if available (uploadable)

**Practical constraints**
- Confirmation of ad size purchased (auto-populated from contract)
- Confirmation of ad position — standard or which premium position (auto-populated)
- Any legal or regulatory text required (e.g. liquor license numbers, "Drink responsibly" for licensed venues, terms and conditions on offers)

**Sign-off**
- Explicit confirmation that the brief is complete and accurate
- Explicit acknowledgement that the two-revision-round limit and non-refundable deposit terms apply from this point forward
- Date of sign-off recorded

### 9.3 Quarter-page brief — information-led

Goal: the guest can find this business when they need it. Tightly designed name + photo + 2-line description + contact stack + QR.

- One landscape or square hero photo (minimum resolution enforced)
- A two-sentence description, hard-capped at ~25 words
- Phone number
- Website URL
- Street address as it should appear
- Social handles (Instagram, Facebook, TikTok, etc.)
- Optional: any guest offer with exact wording locked in

### 9.4 Half-page brief — flexible with treatment selection

The business first selects one of three treatments, with examples shown:

**Treatment A — photo-led with overlay.** Best for businesses with strong visual appeal (activity operators, scenic venues, photogenic experiences). One stunning hero photo, big bold call-to-action text overlaid, minimal supporting copy.

**Treatment B — photo with caption block.** Best for businesses whose offer needs explaining (multi-purpose venues, experiences with several components). Photo on top, separate caption block underneath with name, description, contacts, QR.

**Treatment C — logo-and-message.** Best for established brands with strong visual identity. Branded logo treatment, short evocative headline, photo as supporting context.

The fields requested then adapt to the chosen treatment. Common across all three:

- One or two hero photos (count depends on treatment), minimum resolution enforced
- Headline / primary message — the one thing the guest should take away
- Mood / vibe direction selected from the defined list (see 9.6) — not free text, to keep direction specific
- Supporting copy length appropriate to treatment
- Call to action — what should the guest do (book, visit, scan)
- Phone, website, address, social handles
- Optional: guest offer with exact wording

### 9.5 Full-page brief — brand-led

Goal: stop the guest, hold their attention, plant curiosity. The brief explicitly tells the business: *this is a brand and curiosity moment, not a directory listing — your phone number and address belong on your website, not on this ad.*

- One exceptional hero image (or two, if conceptually justified) — minimum resolution enforced, with a note that full-page imagery quality is non-negotiable and Strictons may request a re-shoot or stock alternative if submitted images don't meet the standard
- A short headline with emotional weight (concrete and evocative, not generic — "Sunrise & Sunset Joyflights" not "Scenic flights available")
- A supporting line — typically a price hook, an experience descriptor, or an offer ("From only $325", "Get 10% off with code BEACHIES10")
- Logo treatment direction
- Optional: a guest-specific offer code (recommended for full-page advertisers, since it doubles the trackability of the placement)
- Practical info — website only, optionally a single line of address if essential to the experience
- Mood / vibe direction selected from the defined list (see 9.6)

### 9.6 The mood / vibe options list

Both the half-page and full-page briefs ask the business to select a mood from a controlled list rather than describe one in free text. The list itself is one of the most consequential creative decisions in the entire product, because **whatever options Strictons offers becomes the visual vocabulary of every guide forever**. If "edgy and urban" isn't on the list, no business will ever produce an edgy urban ad — they have no way to ask for one. The list is a soft creative ceiling.

The list also has to balance two opposing pressures. Wide enough that diverse businesses can each find a fit (a Thai massage studio, a kids' adventure park, an art gallery, a craft distillery, and a reptile zoo all need a home in it). Narrow enough that the guide as a whole holds together visually. Too much variety and the guide stops feeling like a curated artefact and starts feeling like a magazine ad section.

#### How the field works

- Each option is a two-word label — one word for register, one for register — so the meaning is disambiguated. "Warm and inviting" rather than just "warm."
- Each option is backed by a **visual reference card** of three to four example images that show what the mood looks like in practice. The business doesn't pick from words alone — they pick from words paired with examples. This is what stops the "modern and clean means different things to different people" problem dead, because both the business and the designer are looking at the same reference image.
- Each option also has a short paragraph describing the design treatment it implies — colour direction, photography style, typographic feeling, layout density. This is for the designer, not the business, but is visible to both.
- The business may select **one or two** moods. Two allows for hybrid direction (e.g. "premium and minimal" + "coastal and breezy" for a beachfront day spa). More than two becomes incoherent and is not allowed.

#### Recommended starter list

A list of around 6–10 options is right. Fewer than 6 boxes businesses in. More than 10 starts to overlap and businesses pick by gut, defeating the purpose. The following is a starter draft to be reviewed and refined with the designer who built the Beachcomber guide:

- **Warm and inviting** — soft natural light, hospitality cues, food and people, gentle warm tones. For cafés, restaurants, family-friendly venues, accommodation-adjacent businesses.
- **Premium and minimal** — generous white space, restrained typography, single hero image, high-end product or experience focus. For day spas, fine dining, jewellery, galleries, premium tour operators.
- **Energetic and playful** — bold type, bright colours, sans-serif or hand-lettered, action photography. For adventure activities, kids' attractions, BattleKart-style experiences, family fun parks.
- **Rustic and authentic** — earth tones, textured backgrounds, craft-focused photography, often with a heritage or artisan story. For distilleries, farms, makers, regional produce.
- **Coastal and breezy** — cool blues and sandy neutrals, sky and water, light and airy, relaxed typography. For beach businesses, boat operators, swimwear, surf schools.
- **Botanical and natural** — greens, organic shapes, plant photography, often illustrative or hand-drawn elements. For gardens, eco-experiences, wellness, herbal or natural retail.
- **Vibrant and cultural** — saturated colours, strong patterns, cultural cues from cuisine or craft, layered composition. For ethnic restaurants, cultural experiences, markets, festivals.
- **Sleek and modern** — geometric, high-contrast, contemporary sans-serif, architectural photography. For tech-adjacent businesses, modern boutiques, design-forward retail.
- **Adventurous and bold** — high-energy outdoor photography, dramatic skies, rugged textures, active-voice copy. For outdoor adventure, extreme sports, remote experiences, 4WD tours.
- **Refined and classic** — serif typography, balanced symmetric layouts, muted palettes, traditional cues. For heritage venues, classic dining, antiques, formal experiences.

This list will be reviewed and refined before launch, and revisited quarterly against actual usage data.

#### Implementation notes

- **Store mood options in the database, not in the form code.** A `mood_options` table allows Strictons to add, retire, or rename moods without a code deploy. The reference images for each mood live in object storage and are linked to the mood row.
- **Track every mood selection.** Log which moods each business picks. Over the first year, the data shows which options are over-represented, under-represented, or never chosen. An option that's never picked is taking up cognitive space in the form and should be retired. An option picked by 60% of businesses is probably too broad and should be split into two more specific moods.
- **Surface the data in the Strictons admin portal** as a quarterly mood-distribution dashboard. This is also useful editorial intelligence — if 70% of businesses in a particular hotel's guide pick "coastal and breezy," that's a signal about the location's identity that informs how the hotel-side content of the guide is designed.

### 9.7 Reference and inspiration (all sizes)

Across all three tracks, the brief asks for:

- One or two reference ads the business likes, with notes on what specifically appeals about each
- Anything to actively avoid — competitor styles, clichés, specific colours or imagery types

These two questions are where briefs typically go wrong, because "modern and clean" means something different to everyone. Forcing specificity here is where the brief earns its keep.

### 9.8 Self-supplied ads

Businesses may supply a pre-designed ad rather than have Strictons design one. When they elect this option, the portal serves a different track:

- File format requirements (print-ready PDF/X-4, CMYK, 300 DPI minimum)
- Bleed, trim, and safe area specifications per ad size
- Colour profile requirements
- Embedded fonts requirement
- Strictons sign-off step — every self-supplied ad is reviewed by a Strictons designer before going to print, with the right to reject ads that fall below the visual standard of the rest of the guide. This protects the guide as a whole — a mediocre ad inserted into a high-quality guide stands out unflatteringly and harms the perception of every other advertiser.

If a self-supplied ad is rejected on quality grounds, the business can either revise (counts toward their two rounds) or commission Strictons to design from scratch.

### 9.9 Image resolution requirements

Every photo uploaded to the brief portal must meet a minimum resolution threshold based on the ad size it will appear in. The thresholds are derived from the standard print resolution of 300 DPI (dots per inch) at the final printed size of each ad placement.

#### Thresholds

- **Quarter page: minimum 1 megapixel** (~1000 × 1000 pixels). The photo placement within a quarter-page ad is small (roughly 30 × 30 mm in the layout). 1 MP gives 300 DPI at that size with comfortable headroom for crop adjustments.
- **Half page: minimum 3 megapixels** (~2000 × 1500 pixels). The photo can fill up to ~110 × 90 mm, especially in the photo-led overlay treatment. 3 MP gives 300 DPI with headroom for treatment-specific crops.
- **Full page: minimum 12 megapixels** (~3000 × 4000 pixels). Full-page imagery extends to the bleed edge of the page, so the image area is ~121 × 203 mm. 12 MP is the threshold below which a full-page hero starts to look soft, and a soft hero undermines the entire spread. There are no second chances on a full page.

These map roughly to: 1 MP = an old smartphone or screenshot, 3 MP = a competent phone or compact camera, 12 MP = a modern phone at full resolution or a DSLR/mirrorless camera. The 12 MP threshold for full pages is deliberately set above what casual phone photos at default sharing settings produce, because full pages are the brand moment of the guide.

#### Logos

Logos are handled separately from photos:

- **Vector format strongly preferred** (SVG, EPS, AI, or PDF). Vector logos resize cleanly to any size without quality loss.
- **Raster fallback** for businesses without vector files: minimum 1000 × 1000 pixels with transparent background where possible.

The brief portal makes this distinction explicit with separate upload slots — "Upload your logo (vector preferred)" with a labelled raster fallback option.

#### Portal validation behaviour

Most validation is handled at upload time by Cloudinary's built-in checks (see section 6.7), with Strictons-specific rules layered on top:

- **Reject below-threshold images at upload time** with a clear, specific error: *"This image is 800 × 600 pixels (0.5 megapixels). Full-page ads require a minimum of 12 megapixels (typically 3000 × 4000 pixels or larger). Please supply a higher-resolution image."*
- **Show the user what they need on the upload field**, not buried in help text. "Need at least 3000 × 4000 pixels" displayed inline. On mobile, a hint to switch the camera to highest-resolution capture mode.
- **Cross-check beyond pixel count** to catch upscaled images, using metadata Cloudinary returns at upload:
  - **File size sanity check** — a genuine 12 MP photo is typically 3–8 MB. A 12 MP file under 500 KB is likely an upscaled low-res image. Flag for designer review rather than auto-reject (high-quality compression can occasionally produce smaller files).
  - **EXIF data check** — if present, the original capture resolution is recorded. This catches upscaling at the source.
  - **Visual sharpness check** (optional, future enhancement) — a Laplacian variance check can detect very blurry images. Worth implementing if quality issues become a recurring pattern.

#### Strictons override

A Strictons designer can manually accept an under-threshold image with a required note in the audit log explaining the override decision. The threshold is a default protection, not an absolute rule. This handles edge cases where a business has the perfect photo at, say, 8 MP for a full-page ad and there's genuinely no better option.

#### Fallback paths when a business doesn't have suitable imagery

Three options, in order of preference:

1. **Reject and request better photos.** Default behaviour. Best for guide quality. The business contract makes clear that supplying suitable imagery is the business's responsibility and that Strictons reserves the right to require improved imagery for premium ad placements.
2. **Strictons-sourced stock photography** from a pre-vetted set, offered when the business has paid for a full page but genuinely lacks suitable imagery. Adds licensing cost; offered at Strictons' discretion.
3. **Strictons-coordinated photo session** as a paid upsell. Adds revenue and time to the project. Offered when the business wants control over the imagery and is willing to pay for a proper shoot.

## 10. Constraints and viability rules

- If a project doesn't attract enough advertisers to be viable, it doesn't go ahead. Strictons covers all printing costs, so unit economics depend on ad fill rate per hotel.
- More businesses are invited to the presentation than there are slots, which creates fair first-come-first-served competition and reduces fill-rate risk.
- Hotels approve the final business list before any business is invited, ensuring quality and editorial alignment.
- All invited businesses are pre-vetted (Strictons-proposed and hotel-approved), so anyone signing the contract is, by definition, a quality business at the time of signing. The quality clause covers ongoing standards.

## 11. Open questions to resolve before build

- Final review and refinement of the starter mood/vibe list (section 9.6) with the designer who built the Beachcomber guide before launch
