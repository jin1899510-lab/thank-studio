
export type ImageCategory = 'People' | 'Food' | 'Design' | 'Profile' | 'FoodStudio' | 'Other';

export type CompositionType = 'original' | 'flat-lay' | 'side-view' | 'eye-level' | 'cinematic' | 'close-up';
export type DedicatedFilterType = 
  | 'vibrant' | 'warm' | 'fresh' | 'moody' | 'natural-light' | 'outfocus' | 'sharpness' 
  | 'richness' | 'spice' | 'dessert' | 'profile' | 'food-studio' | 'none'
  | 'food-meat' | 'food-bakery' | 'food-organic' | 'food-glossy';

export type ZoomLevel = 'out-2' | 'out-1' | 'none' | 'in-1' | 'in-2';
export type ResolutionType = '1000' | '1500' | '2000';

export interface TextOverlay {
  text: string;
  font: string;
  color: string;
  size: number;
  yPosition: number; // 0 to 100
}

export interface TransformationOptions {
  composition: CompositionType;
  zoom: ZoomLevel;
  filter: DedicatedFilterType;
  resolution: ResolutionType;
}

export interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
  processedUrl?: string;
  history?: string[]; 
  status: 'idle' | 'analyzing' | 'processing' | 'completed' | 'error';
  category?: ImageCategory;
  error?: string;
  originalName: string;
  textOverlay?: TextOverlay;
  currentZoom?: ZoomLevel; 
}

export interface TransformationStats {
  total: number;
  completed: number;
  failed: number;
  processing: number;
}
