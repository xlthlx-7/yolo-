
export enum LightingCondition {
  SUNNY = 'Sunny, harsh shadows',
  OVERCAST = 'Overcast, soft lighting',
  SUNSET = 'Sunset, golden hour',
  NIGHT = 'Night, artificial street lighting'
}

export enum WeatherCondition {
  CLEAR = 'Clear, high visibility',
  FOGGY = 'Foggy, heavy smog, atmospheric haze, low visibility',
  DUSTY = 'Dusty, sandstorm, particulate matter in air, yellow tint',
  RAINY = 'Rainy, wet surfaces, puddles, falling droplets',
  CLOUDY = 'Cloudy, overcast sky'
}

export enum BackgroundType {
  URBAN = 'Urban street, asphalt',
  CONSTRUCTION = 'Construction site, cranes, raw materials, dirt, unfinished structures',
  GRASS = 'Green grass field',
  DIRT = 'Dirt ground, dry earth',
  CONCRETE = 'Concrete pavement',
  SNOW = 'Snowy ground',
  SAND = 'Sandy desert'
}

export const ALTITUDE_OPTIONS = [
  'Low (10m)',
  'Medium (30m)',
  'High (50m)',
  'Very High (100m)'
];

export const ANGLE_OPTIONS = [
  'Top-down (90°)',
  'Steep (75°)',
  'High Angle (60°)',
  'Standard (45°)',
  'Low Angle (30°)',
  'Grazing (15°)'
];

export interface GenerationConfig {
  count: number;
  width: number;
  height: number;
  lighting: string;
  background: string;
  altitude: string;
  angle: string;
  weather: string;
}

export interface BoundingBox {
  x_center: number;
  y_center: number;
  width: number;
  height: number;
}

export interface GeneratedData {
  id: string;
  imageUrl: string; // Base64
  bbox?: BoundingBox;
  status: 'pending' | 'generating' | 'detecting' | 'completed' | 'failed';
  error?: string;
  metadata: {
    lighting: string;
    background: string;
    altitude: string;
    angle: string;
    weather: string;
  }
}

// Gemini specific types
export interface Box2D {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}
