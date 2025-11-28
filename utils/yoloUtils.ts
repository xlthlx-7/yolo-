import { BoundingBox, Box2D } from '../types';

/**
 * Converts normalized [ymin, xmin, ymax, xmax] (0-1000 scale from Gemini) 
 * to YOLO format [x_center, y_center, width, height] (0-1 normalized).
 */
export const convertGeminiBoxToYolo = (box: Box2D, imgWidth: number, imgHeight: number): BoundingBox => {
  // Gemini often returns 0-1000 scale, sometimes 0-1. We detect based on value magnitude.
  const scale = box.ymax > 1 ? 1000 : 1;

  const ymin = box.ymin / scale;
  const xmin = box.xmin / scale;
  const ymax = box.ymax / scale;
  const xmax = box.xmax / scale;

  const boxWidth = xmax - xmin;
  const boxHeight = ymax - ymin;
  const xCenter = xmin + (boxWidth / 2);
  const yCenter = ymin + (boxHeight / 2);

  // Clamp values between 0 and 1 just in case
  return {
    x_center: Math.max(0, Math.min(1, xCenter)),
    y_center: Math.max(0, Math.min(1, yCenter)),
    width: Math.max(0, Math.min(1, boxWidth)),
    height: Math.max(0, Math.min(1, boxHeight))
  };
};

/**
 * Resizes a base64 image to specific dimensions using HTML Canvas
 */
export const resizeImage = (base64Str: string, targetWidth: number, targetHeight: number): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Draw image covering the canvas (aspect ratio might change, or use cover)
        // For YOLO training, usually we want to stretch or pad. Here we stretch to exact pixels requested.
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } else {
        resolve(base64Str); // Fallback
      }
    };
  });
};

/**
 * Converts a file object to base64 string
 */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Formats a YOLO line: <class_id> <x_center> <y_center> <width> <height>
 */
export const formatYoloLine = (classId: number, bbox: BoundingBox): string => {
  return `${classId} ${bbox.x_center.toFixed(6)} ${bbox.y_center.toFixed(6)} ${bbox.width.toFixed(6)} ${bbox.height.toFixed(6)}`;
};

/**
 * Calculates the closest supported aspect ratio for Gemini 2.5 Flash Image model
 */
export const getGeminiAspectRatio = (width: number, height: number): "1:1" | "3:4" | "4:3" | "9:16" | "16:9" => {
  const targetRatio = width / height;
  const ratios: { key: "1:1" | "3:4" | "4:3" | "9:16" | "16:9", value: number }[] = [
    { key: "1:1", value: 1.0 },
    { key: "3:4", value: 0.75 },
    { key: "4:3", value: 1.333 },
    { key: "9:16", value: 0.5625 },
    { key: "16:9", value: 1.777 }
  ];

  // Find the ratio with minimal difference
  return ratios.reduce((prev, curr) => {
    return (Math.abs(curr.value - targetRatio) < Math.abs(prev.value - targetRatio) ? curr : prev);
  }).key;
};
