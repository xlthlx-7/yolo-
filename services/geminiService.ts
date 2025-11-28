
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { GenerationConfig, Box2D } from "../types";

// Helper to strip the data:image/png;base64, prefix
const cleanBase64 = (b64: string) => b64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

/**
 * Step 1: Generate a drone view variation of the input image
 */
export const generateDroneView = async (
  apiKey: string,
  referenceImage: string,
  config: GenerationConfig,
  objectDescription: string,
  aspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" = "1:1"
): Promise<string> => {
  if (!apiKey) throw new Error("API Key is missing");

  const ai = new GoogleGenAI({ apiKey });
  
  // Construct a prompt that forces the perspective shift
  const prompt = `
    Generate a photorealistic, high-quality image of the provided object (${objectDescription}) but viewed from a ${config.angle} drone perspective.
    
    Context & Environment:
    - Altitude: ${config.altitude}
    - Background: ${config.background}
    - Lighting: ${config.lighting}
    - Weather/Atmosphere: ${config.weather}
    - The object should be the main focus but integrated naturally into the environment.
    - Preserve the visual identity (colors, shape) of the reference object as much as possible.
    - The output must be a single, clear image.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: prompt
          },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64(referenceImage)
            }
          }
        ]
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio, 
        }
      }
    });

    // Extract image
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData && part.inlineData.data) {
        return `data:image/jpeg;base64,${part.inlineData.data}`;
      }
    }
    
    throw new Error("No image data returned from model.");

  } catch (error) {
    console.error("Generation failed:", error);
    throw error;
  }
};

/**
 * Step 2: Detect the bounding box of the object in the GENERATED image
 */
export const detectObjectBBox = async (
  apiKey: string,
  generatedImage: string,
  objectDescription: string
): Promise<Box2D> => {
  if (!apiKey) throw new Error("API Key is missing");

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
    Analyze this image and find the bounding box of the ${objectDescription}.
    Return the bounding box coordinates [ymin, xmin, ymax, xmax] where values are scaled 0 to 1000.
    The box should be tight around the object.
  `;

  // Define schema for structured JSON output
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      ymin: { type: Type.INTEGER },
      xmin: { type: Type.INTEGER },
      ymax: { type: Type.INTEGER },
      xmax: { type: Type.INTEGER },
    },
    required: ["ymin", "xmin", "ymax", "xmax"],
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash', // Flash is fast and good enough for bbox
      contents: {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64(generatedImage)
            }
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error("No text response for detection");

    const result = JSON.parse(text) as Box2D;
    return result;

  } catch (error) {
    console.error("Detection failed:", error);
    throw error;
  }
};
