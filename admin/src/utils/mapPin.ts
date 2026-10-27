/**
 * Leaflet marker pins, shared by the geospatial field map and the record detail maps.
 * Styled with exact OKLCH status palette, light black border, and light black inner circle.
 */
import L from 'leaflet';

export const PIN_COLORS = {
  green: 'oklch(72.3% 0.219 149.579)',
  orange: 'oklch(66.6% 0.179 58.318)',
  red: 'oklch(57.7% 0.245 27.325)',
  lightBlack: 'oklch(37.3% 0.034 259.733)',
};

function pinSvg(bodyColor: string, centerColor: string, id: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="pinShadow${id}" x="0" y="0" width="32" height="42" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#0f172a" flood-opacity="0.35"/>
    </filter>
  </defs>
  <!-- Teardrop pin body with light black border -->
  <path d="M16 2.5C9.65 2.5 4.5 7.65 4.5 14C4.5 22.8 16 37 16 37C16 37 27.5 22.8 27.5 14C27.5 7.65 22.35 2.5 16 2.5Z" 
        fill="${bodyColor}" 
        stroke="${PIN_COLORS.lightBlack}" 
        stroke-width="1.5" 
        stroke-linejoin="round"
        filter="url(#pinShadow${id})"/>
  <!-- Replaced white circle to light black circle -->
  <circle cx="16" cy="14" r="6.2" fill="${PIN_COLORS.lightBlack}" />
  <!-- Center circle dot -->
  <circle cx="16" cy="14" r="4.2" fill="${centerColor}" />
</svg>`)}`;
}

const markerIcon = (url: string) =>
  L.icon({
    iconUrl: url,
    iconSize: [32, 42],
    iconAnchor: [16, 37],
    popupAnchor: [0, -34],
  });

/** Default / unassigned site pin — Red with light black border and circle. */
export const primaryMarkerIcon = markerIcon(pinSvg(PIN_COLORS.red, '#fecaca', 'Pri'));

/** Completed inspection work — Green with light black border and circle. */
export const completedMarkerIcon = markerIcon(pinSvg(PIN_COLORS.green, '#bbf7d0', 'Comp'));

/** Pending inspection task — Orange with light black border and circle. */
export const pendingMarkerIcon = markerIcon(pinSvg(PIN_COLORS.orange, '#fed7aa', 'Pend'));

/** Where a photo was actually captured — Blue with light black border and circle. */
export const fieldMarkerIcon = markerIcon(pinSvg('#0ea5e9', '#e0f2fe', 'Field'));

/** Target / focused record pin — Royal Blue with light black border and circle. */
export const targetBlueMarkerIcon = markerIcon(pinSvg('#2563eb', '#dbeafe', 'BlueTarget'));

