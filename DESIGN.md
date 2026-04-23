# Design System: Nektar
**Project ID:** nektar-local

## 1. Visual Theme & Atmosphere

Nektar uses a dense, studio-console atmosphere rather than a soft marketing-site aesthetic. The interface feels like a serious editing workstation: dark shell surfaces, high-contrast controls, compact labels, and a bright timeline that reads like a workbench. The mood is utilitarian, focused, and immediate.

The visual hierarchy deliberately separates three zones:

- A dark application shell for preview, recording, and transport controls.
- A lighter timeline surface for precise clip manipulation.
- Small, high-signal inspector and dialog surfaces for editing details without leaving the workflow.

The overall feel should stay technical and purposeful. Nothing should look ornamental unless it helps the user understand the editor state faster.

## 2. Color Palette & Roles

| Color | Hex | Functional Role |
| --- | --- | --- |
| Deep Charcoal Shell | `#1A1A1A` | Primary application background and major dark surfaces. |
| Near-Black Header | `#111111` | Top bars, recorder shells, preview frames, and inset panels. |
| Shadow Black | `#0D0D0D` | Dark gradient base and the deepest background tone. |
| Pure White | `#FFFFFF` | Primary text on dark surfaces, bright buttons, and high-contrast surfaces. |
| Paper Timeline | `#F5F5F5` | The timeline canvas and other light work surfaces. |
| Soft Border White | `#FFFFFF1A` | Subtle borders on dark panels and modal shells. |
| Whisper Border White | `#FFFFFF0D` | Very soft separators and fine frame lines. |
| Action Blue | `#2563EB` | Primary action buttons, active states, and focus emphasis. |
| Action Blue Hover | `#1D4ED8` | Hover and pressed state for the main call to action. |
| Muted Gray | `#6B7280` | Secondary labels, timestamps, and supportive metadata. |
| Surface Gray | `#E5E7EB` | Inputs, dividers, and light panel borders. |
| Success Green | `#10B981` | Audio and recording-positive states. |
| Alert Red | `#EF4444` | Destructive actions, warnings, and failure feedback. |
| LUT Purple | `#7C3AED` | LUT markers and color-processing accents. |

Color should always communicate function first. Blue is for action and selection, gray is for structure and hierarchy, and accent colors only appear when they clarify a media state such as recording or LUT processing.

## 3. Typography Rules

Nektar’s typography is compact, legible, and utility-driven.

- Primary UI family: `Inter`-led sans serif stack.
- Supporting display families available in the app: `Roboto`, `Open Sans`, `Lato`, `Montserrat`, `Space Grotesk`, and `Outfit`.
- Monospace family for timecode-like values and technical metadata: `Source Code Pro` or the system monospace fallback.

The type system should follow these rules:

- Headings are short, bold, and tightly tracked.
- Section labels are commonly uppercase with wide letter spacing.
- Body copy stays small but readable, especially in inspectors and dialogs.
- Time, clip lengths, and export values should use tabular or monospace styling so numbers do not visually jump.
- The main shell favors `font-sans`; code-like values and precision readouts favor `font-mono`.

Recommended usage:

- Page and panel titles: `text-lg` to `text-2xl`, bold.
- Section labels: `text-[10px]` to `text-[11px]`, bold, uppercase, wide tracking.
- Body text: `text-xs` to `text-sm`, medium weight.
- Numeric readouts: monospace, bold, tabular when available.

The typography should feel efficient rather than editorial. It should support scanning, not slow reading.

## 4. Component Stylings

### Buttons

- Primary buttons use a saturated blue fill (`#2563EB`) with white text and a soft shadow.
- Hover states deepen to `#1D4ED8` and may scale very slightly for feedback.
- Secondary buttons are flatter, quieter, and usually use translucent white or neutral backgrounds.
- Destructive actions use red (`#EF4444`) and should be visually separated from routine actions.
- Button shapes are compact and usually rounded with `rounded-md`, `rounded-lg`, or `rounded-xl` depending on context.

### Cards And Containers

- Major shells use dark fills such as `#1A1A1A` or `#111111`.
- Surfaces are framed with thin borders in `#FFFFFF1A` or `#FFFFFF0D` when on dark backgrounds.
- Light utility areas, such as the timeline, use a paper-like white or off-white surface (`#F5F5F5`).
- Rounded corners are prominent but not playful; `rounded-xl` and `rounded-2xl` are the dominant shapes.
- Shadows are strong enough to lift panels from the background but not glossy or decorative.
- The preview frame and recorder panels should feel like enclosed work surfaces, not free-floating cards.

### Inputs And Forms

- Inputs in light panels use white or gray backgrounds with `#E5E7EB` borders and small text.
- Focus states are crisp and blue, matching the primary action color.
- Labels are compact, uppercase, and often muted so the control itself stays visually dominant.
- Range sliders, select fields, and toggles should remain dense and functional.
- Forms should prefer inline editing over separate configuration steps whenever possible.

### Editor-Specific Surfaces

- Timeline clips are rectangular, tightly packed, and clearly segmented by track.
- Selected clips should read clearly without turning the entire lane into a bright highlight.
- The preview frame stays dark and neutral so media content remains the focus.
- Inspector sections should be stacked vertically with clear internal spacing and thin dividers.
- Recorder surfaces should feel operational and live, with obvious state changes for armed, paused, and recording states.
- Export dialogs should feel like finish-line confirmation panels: clean, legible, and high confidence.

## 5. Layout Principles

The layout is a full-viewport editing shell with a fixed top bar and a two-tone working area beneath it.

- The dark shell occupies the preview, recorder, and control region.
- The timeline sits in a dedicated lower section with a contrasting bright surface.
- The main editing area favors asymmetry: a large work surface on one side and compact utility panels on the other.
- Panels dock closely to the content they control so users do not lose context.
- Spacing is tight and deliberate; empty space is used to separate functions, not to create decoration.
- The interface should preserve the feeling that the timeline is always the center of gravity.

Responsive behavior should protect the editing hierarchy rather than flatten it:

- Keep the timeline readable and usable at every width.
- Allow side panels to compress before the timeline loses clarity.
- Preserve the compact label system even on larger screens.
- Prefer scrolling within panels over making the entire page feel loose or sparse.

The layout should remain efficient, technical, and stable. If a change makes the interface feel more like a general-purpose website than an editing tool, it is drifting away from the intended design language.
