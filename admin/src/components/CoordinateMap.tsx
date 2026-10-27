/**
 * Compact read-only site map for record detail pages.
 *
 * Renders the record's coordinates as a pin and, when a second point is given,
 * the spot the photo was actually captured — the pair is what "Location
 * Verification" is really asking about, so seeing both beats comparing two
 * strings. Scroll-zoom is off so the map never hijacks the page scroll.
 */
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { fieldMarkerIcon, primaryMarkerIcon } from '../utils/mapPin';
import { Icon } from './ui';

export interface CoordinateMapProps {
  readonly latitude: number;
  readonly longitude: number;
  readonly height?: number;
  /** Capture position to pin alongside the site, when the record has one. */
  readonly capture?: { latitude: number; longitude: number } | null;
  readonly editable?: boolean;
  readonly onCoordinatesChange?: (coords: string) => void;
}

function MapClickPicker({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function CoordinateMap({
  latitude,
  longitude,
  height = 240,
  capture = null,
  editable = false,
  onCoordinatesChange,
}: CoordinateMapProps) {
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  return (
    <div className="coord-map">
      <MapContainer
        center={[latitude, longitude]}
        zoom={16}
        scrollWheelZoom={editable}
        dragging={true}
        className="coord-map-canvas"
        style={{ height }}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {editable && onCoordinatesChange && (
          <MapClickPicker
            onSelect={(lat, lng) => onCoordinatesChange(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)}
          />
        )}
        <Marker
          position={[latitude, longitude]}
          icon={primaryMarkerIcon}
          draggable={editable}
          eventHandlers={
            editable && onCoordinatesChange
              ? {
                  dragend(e) {
                    const marker = e.target;
                    const pos = marker.getLatLng();
                    onCoordinatesChange(`${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`);
                  },
                }
              : undefined
          }
        />
        {capture && <Marker position={[capture.latitude, capture.longitude]} icon={fieldMarkerIcon} />}
      </MapContainer>

      <div className="coord-map-foot">
        <span className="coord-map-legend">
          <span className="coord-map-key coord-map-key-site" />
          {editable ? 'Drag pin or click map to reposition' : 'Site'}
          {capture && (
            <>
              <span className="coord-map-key coord-map-key-capture" />
              Photo capture
            </>
          )}
        </span>
        <a className="coord-map-open" href={googleMapsUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="open_in_new" size={13} />
          Google Maps
        </a>
      </div>
    </div>
  );
}
