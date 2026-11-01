GIS Parcel Planner V5
Open index.html in Edge/Chrome with internet access.
Based on the uploaded Claude HTML with additional configurable parcel edge colors.
Important: engineering setbacks for concave parcels and auto layouts require validation. Satellite export may be limited by tile availability.

Buildable-area diagram (Export section): "تصدير مخطط المساحة بعد الارتدادات PNG" draws the parcel polygon minus each edge's setback strip (mitre corners, same rule as the sheet's setback line), works for concave / multi-part results, shows a preview, then downloads a 3x PNG.
Uses polygon-clipping 0.15.7 (jsDelivr); if it cannot load, the convex-only setback line is used and the preview says so.
Set "أقصى نسبة بناء نظامية" to show the regulatory ratio; left empty, the diagram shows the geometric ratio and labels it as such.

Transaction sheet (نموذج المعاملة) layout update:
- Layout follows the reference design: logo slot top right, parcel-number pill, location line, 10 cards, requirements table; left: context map, zoomed map, floating data card, photo + ready-made barcode card.
- Logo: section 10 > "صورة اللوجو". Empty = dashed placeholder "مكان اللوجو".
- Barcode/QR card: section 10 > "صورة الباركود / QR الجاهزة". Placed as-is at full frame width under the site photo. Empty = placeholder.
- Street name: section 10 > "اسم الشارع". Fallback order: field > front-edge name (setbacks table) > street column in the imported GIS file > placeholder "اسم الشارع".
- Plan name / district / municipality / parcel no. fall back to matching columns of the imported GIS attribute table.
- Neighbouring parcels in the maps come only from the same imported layer (nothing is invented). Front edge = edge(s) with role "أمامي".
- Logo and barcode images are kept in browser storage and in the project JSON file.
- Parcel number: read from the imported attribute table. Choose the column in section 01 > "حقل رقم القطعة" (auto-detect by default).
  Kept exactly as stored (leading zeros intact). Manual override: section 10 > "رقم القطعة"; it is cleared when another parcel is selected.
  Missing number = "غير محدد" (no default number).
- Maps in the transaction sheet show edge lengths outside each edge, setback values (blue) with dimension arrows inside the setback band,
  leader lines where the band is too narrow, and the parcel number (black, white halo) at the polygon's interior centre. Labels avoid each other.
