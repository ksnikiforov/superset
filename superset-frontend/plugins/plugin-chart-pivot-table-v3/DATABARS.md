# Databar & Waterfall Chart Design Specification

This document defines four distinct chart designs.
All descriptions are **design-only** and can be used to recreate the visuals without seeing the original charts.

---

## Type 1: Horizontal Filled Databars with Inline Value Labels

### Overall Structure

- Orientation: Horizontal
- One bar per row
- Bars are left-aligned to a shared vertical baseline
- Bars extend horizontally from a central vertical axis

### Bar Appearance

- Shape: Solid rectangle
- Corners: Square
- Default color: Medium-to-dark gray
- Height: Medium, consistent across rows
- No border, gradient, or pattern

### Scale & Alignment

- Shared maximum width scale
- No visible axis, ticks, or gridlines

### Labels

- Numeric value shown at the **right end of each bar**
- Slight horizontal offset from bar end
- Vertically centered on the bar
- Color: Dark neutral
- Units included

---

## Type 2: Thin Lollipop-Style Percentage Databars

### Overall Structure

- One bar per row
- Bars extend horizontally from a central vertical axis

### Baseline

- Color: Medium-to-dark gray
- Thickness: Slightly thicker than gridlines
- Full column height

### Bar Appearance

- Shape: Thin horizontal line
- Thickness: Very thin (stroke-like)
- Positive bars:
  - Extend right
  - Default color - same as circle, but can be changed
- Negative bars:
  - Extend left
  - Default color - same as circle, but can be changed

### Endpoint Marker

- Small filled circle at bar end
- Color: Black
- Size slightly larger than bar thickness

### Scale

- Symmetric around baseline

### Labels

- Positioned near endpoint dot
- Offset outward from the dot
- Vertically aligned with bar
- Dark neutral text

### Identifiers

- Line-only bars
- Circular endpoint markers
- Minimalist appearance

---

## Type 3: Vertical-Centered Stepped Waterfall Chart

### Overall Layout

- One bar per row
- Bars extend horizontally from a central vertical axis
- Represents cumulative changes (waterfall logic)
  - just in case, needs a fallback for when values don't add up

### Central Axis

- Single vertical line spanning full chart height
- Color: medium to Dark gray, but can be changed
- Medium thickness
- Serves as zero reference and visual spine

### Bar Appearance

- Shape: Horizontal rectangle
- Corners: Square
- Height: Medium and consistent
- Fill: medium to Dark gray
- Border: Thin darker gray outline
- No color differentiation for sign

### Waterfall Mechanics

- Bars are sequentially cumulative
- Each bar starts where the previous bar ends
- Positive steps extend right
- Negative steps extend left
- No explicit connector lines

    Subtotals & Totals

- Same height as regular bars
- Visually emphasized via:
  - Slightly darker fill or thicker border
- Start from the central axis, not prior step

### Labels

- Positioned outside bar ends
- Right for right-extending bars, left for left-extending
- Vertically centered
- Dark neutral text
- Subtotals and totals may use bold text

### Separators

- Thin horizontal divider lines between groups
- Group headers may be bold text only

### Identifiers

- Vertical spine
- Stepwise cumulative positioning
- Neutral color palette
- No axes or gridlines beyond central axis

---

Notes:

1) for diverging bars from zero - when no negative values - start from left. When no positive values - start from right.
2) For all databars/waterfalls user can override default positive and default negative color, OR use a measure to determine color
3) Databar selector is attached to measure pannel, and is located bellow conditional formatting
4) Databars are scaled, including size that the text takes. For the same measure, if many columns use it, the scaling should be the same. For Totals scaling is also the same. Scaling is using the MAX and MIN values of visible cells. Row grand totals contribute to the scale when they are shown; when grand totals are disabled, they are excluded. Column grand totals for the measure are included, unless they are disabled.
5) In the selector, there are "scaling groups", allowing databar to "Scale like" another measure from selected measures (using a dropdown measure selector from current visual measures). When two measures share the same scaling, thier databars are visually comparable, meaning the width of 1 unit on one databar, will be the same as the width, making them comparable.
