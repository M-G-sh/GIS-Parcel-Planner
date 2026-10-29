GIS Parcel Planner V5
Open index.html in Edge/Chrome with internet access.
Based on the uploaded Claude HTML with additional configurable parcel edge colors.
Important: engineering setbacks for concave parcels and auto layouts require validation. Satellite export may be limited by tile availability.

Buildable-area diagram (Export section): "تصدير مخطط المساحة بعد الارتدادات PNG" draws the parcel polygon minus each edge's setback strip (mitre corners, same rule as the sheet's setback line), works for concave / multi-part results, shows a preview, then downloads a 3x PNG.
Uses polygon-clipping 0.15.7 (jsDelivr); if it cannot load, the convex-only setback line is used and the preview says so.
Set "أقصى نسبة بناء نظامية" to show the regulatory ratio; left empty, the diagram shows the geometric ratio and labels it as such.
