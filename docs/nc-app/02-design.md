# Naked Compound app design

This is the visual source of truth for the native iOS app and its protein experience. The owner's 15 Nov 2026 Apple-inspired Liquid Glass direction supersedes earlier Dribbble styling where they conflict. The attached references may inform warmth, grouping and polish, but do not define the app's materials, colors or composition. Product scope, privacy and architecture remain in `00-overview.md` and `01-architecture.md`.

## 1. Design references and principles

- Apple [Materials HIG](https://developer.apple.com/design/human-interface-guidelines/materials).
- Apple [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass).
- Naked Compound repository assets and documented brand standards are the source of truth for its mark, established colors and editorial voice.

Use Liquid Glass as a functional material for navigation, toolbars and transient controls. Keep primary content, nutrition values, product verdicts and explanatory text on clear, legible content surfaces. Glass belongs above content and should preserve context; don't turn every card into a glass panel or add ornamental blur. Keep layouts calm, content-first, spacious and adaptive in light and dark appearances.

The reference images inform warmth, clear grouping, rounded geometry and generous spacing. Do not copy screen compositions, mascots, logos, charts or features. The protein dashboard prioritizes consumed protein, daily target, remaining protein, today's meal entries and Add food. Show portion quantity and raw/cooked state together. Grams are the primary metric.

## 2. Tokens

Reuse the audited Naked Compound logo, brand ink/text colors, terracotta action color and available repository typography. Do not introduce a competing brand palette. Before native implementation, inspect actual assets and confirm font files and licenses; use the system font when a branded font is unavailable. Never bundle a font merely because an older mockup named it.

Proposed semantic tokens (platform-adaptive values are chosen during SwiftUI implementation):

| Token | Role |
|---|---|
| `canvas` | Quiet grouped background, adapting to appearance |
| `surface` | Opaque or near-opaque reading surface for primary content |
| `separator` | Subtle boundaries with increased-contrast support |
| `label` / `secondaryLabel` | Primary and supporting text using system semantic colors |
| `brandAccent` / `brandAccentText` | Existing NC terracotta for actions and contrast-safe accent text |
| `glassBar` | System Liquid Glass material for navigation and toolbars only |
| `focus` | Visible keyboard/switch focus ring |
| `proteinProgress` | Brand-aligned progress indicator, always paired with exact text |

New tokens are semantic roles, not new brand colors. Prefer system materials, semantic colors and system typography over hard-coded glass opacity, gradients, blur recipes or custom font bundles. Use a 4 pt spacing base, comfortable grouping, and control targets of at least 44 pt. Corner radii follow the platform component and avoid excessive rounding.

## 3. Typography and accessibility

Use the system text styles and Dynamic Type. Numbers use tabular figures where available. Maintain readable body and supporting text, contrast in both appearances, and do not communicate state by color alone. Support VoiceOver, keyboard focus, Reduce Motion, Reduce Transparency and Increase Contrast. Essential content remains understandable when materials become opaque. Avoid truncating grams, quantities, preparation states or product claims at accessibility sizes.

## 4. Checkpoint and screens

The approved design checkpoint is the three-screen local-first protein flow: Today dashboard, food search, and food detail/portion-entry sheet. Preview data must be explicitly labeled illustrative and remain in-memory. This repository contains the design specification; native implementation is a future phase. Do not expand to all native app screens until the owner approves the visual checkpoint.

For the future native app, use platform navigation and system Liquid Glass for tab/navigation controls. The Today screen shows consumed/target/remaining protein, meal entries with grams and preparation, and a prominent Add food action. Search exposes food name and preparation clearly. The portion sheet keeps the selected raw/cooked state visible, supports a quantity in grams, and summarizes the protein contribution before adding.

Other v1 destinations remain Home, Search, Scan, Ask and Protein as defined by product scope, implemented with native conventions rather than copied reference layouts. Do not add calorie, step-count or AI-chat features to the protein tool.

## 5. States and data honesty

Every screen needs useful empty, loading, error and offline states in addition to populated data. Do not show zero as a substitute for missing data. Label synthetic checkpoint content “Preview data · illustrative only.” Food values remain tied to their source and preparation state; never convert raw to cooked automatically. Unavailable protein remains visibly unknown. Preserve current account, privacy and local-first requirements.

## 6. Native implementation notes

`apps/nc-ios` has not reached its implementation phase. Use native SwiftUI materials and APIs when that phase begins; a web `backdrop-filter` is not native Liquid Glass. Build previews for light/dark and accessibility text sizes, and validate on a macOS simulator/device. This Windows environment cannot claim native build or device verification.
